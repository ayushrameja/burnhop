/** Real Colyseus/WebSocket load test. Build with Vite's dedicated Node entry, then run:
 * node dist-tools/loadtest.mjs --endpoint http://127.0.0.1:2567 --seconds 900
 * Short runs are useful smoke tests, but can never pass the fifteen-minute release gate.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client, Predict, type InputHandle, type Reconciler, type Room } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE, type ClothingColorId } from '../src/game/appearance';
import { compileArena } from '../src/game/simulation';
import { COMPATIBILITY_ID, MATCH_CONFIG, OUTPOST_ARENA, neutralInput, type ActorEvent, type MatchPlayer, type NetworkInput } from '../src/multiplayer/model';
import { InputWire, MatchWire, syncPlayerWire, type PlayerWire } from '../src/multiplayer/wire';
import { stepWireActor } from '../src/online/prediction';

const PLAYER_COUNT = 8;
const GAME_ORIGIN = 'https://burnhop.lowhp.studio';
const TICK_BUDGET_MS = 1000 / 60;
const MEMORY_LIMIT_BYTES = 750_000_000; // The approved 750 MB gate, expressed in decimal bytes.
const arena = compileArena(OUTPOST_ARENA);

interface Metrics {
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  activeRooms: number;
  connectedPlayers: number;
  reservedPlayers: number;
  simulation: null | {
    ticks: number; sampledTicks: number; p50WorkMs: number; p99WorkMs: number;
    peakWorkMs: number; overBudgetTicks: number; maxInputBacklog: number;
    consecutiveInputBacklogTicks: number; resynchronizations: number;
    scheduleLagMs: number; lastTickAt: number;
    maxConsecutiveInputBacklogTicks: number; longestScheduleDeficitMs: number;
    scheduleWindowMs: number; observedTickRate: number;
    pendingSimulationMs: number; peakPendingSimulationMs: number;
    droppedSimulationMs: number; catchUpLimitHits: number;
  };
}
interface MetricsSample extends Metrics { elapsedSeconds: number; activeSeconds: number; phase: string }
interface Bot {
  index: number;
  room: Room<any, MatchWire>;
  handle: InputHandle<InputWire>;
  predict: Predict<MatchWire>;
  controller: Reconciler<PlayerWire, NetworkInput>;
  lifeId: number;
  phase: string;
  inputId: number;
  connected: boolean;
  nextControlAt: number;
  inputsSent: number;
  moveIntentFrames: number;
  fireIntentFrames: number;
  shotsConfirmed: number;
  hitsConfirmed: number;
  deaths: number;
  respawns: number;
  drops: number;
  reconnects: number;
  resyncs: number;
  historyResyncRequests: number;
  awaitingResync: boolean;
  nextHistoryResyncAt: number;
  maxPendingInputs: number;
  movementSamples: number;
  observations: number;
  aliveObservations: number;
  blockedInputFrames: number;
  lastMoveX: NetworkInput['moveX'];
  escapeDirection: NetworkInput['moveX'];
  escapeUntilInput: number;
  navigationRecoveries: number;
}
interface Options { endpoint: string; seconds: number; output: string; metricsIntervalMs: number }

function options(): Options {
  const values = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--endpoint', '--seconds', '--output', '--metrics-interval-ms'].includes(key) || !value) {
      throw new Error('Usage: loadtest --endpoint URL [--seconds 900] [--output load-results/file.json] [--metrics-interval-ms 5000]');
    }
    values.set(key, value);
  }
  if (!values.has('--endpoint')) throw new Error('Provide the existing backend URL with --endpoint.');
  const endpoint = new URL(values.get('--endpoint')!);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('The endpoint must be an HTTP(S) origin without credentials or a path.');
  }
  const seconds = Number(values.get('--seconds') ?? 900);
  const metricsIntervalMs = Number(values.get('--metrics-interval-ms') ?? 5000);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 7200) throw new Error('--seconds must be between 1 and 7200.');
  if (!Number.isFinite(metricsIntervalMs) || metricsIntervalMs < 1000 || metricsIntervalMs > 15_000) throw new Error('Metrics polling must be between 1000 and 15000 ms.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return { endpoint: endpoint.origin, seconds, metricsIntervalMs,
    output: resolve(values.get('--output') ?? `load-results/${stamp}.json`) };
}
async function waitUntil(predicate: () => unknown, timeoutMs: number, label: string): Promise<void> {
  const end = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > end) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Origin: GAME_ORIGIN }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}.`);
  return await response.json() as T;
}
function command(bot: Bot): NetworkInput {
  const frame = neutralInput(0, ++bot.inputId), me = bot.controller.state;
  if (!bot.connected || bot.room.state.phase !== 'playing' || me.health <= 0) {
    bot.blockedInputFrames = 0; bot.escapeUntilInput = 0;
    return frame;
  }
  let target: PlayerWire | undefined, closest = Infinity;
  for (const player of bot.room.state.players.values()) {
    if (player.id === bot.room.sessionId || player.health <= 0) continue;
    const distance = (player.x - me.x) ** 2 + (player.y - me.y) ** 2;
    if (distance < closest) { target = player; closest = distance; }
  }
  const phase = bot.inputId + bot.index * 19;
  const toward = target ? (target.x >= me.x ? 1 : -1) : (bot.index % 2 ? 1 : -1);
  frame.moveX = closest > 220 ** 2 ? toward : (Math.floor(phase / 75) % 2 ? 1 : -1);
  if (me.x < 80) frame.moveX = 1;
  if (me.x > OUTPOST_ARENA.width - 120) frame.moveX = -1;
  frame.jumpPressed = phase % 120 === 0;
  frame.jumpHeld = phase % 120 < 12;
  frame.jetSeparate = true;
  frame.jetPressed = phase % 180 === 20;
  frame.jetHeld = phase % 180 >= 20 && phase % 180 < 95;
  frame.crouchHeld = me.grounded && phase % 300 >= 265;
  // Chasing an opponent through solid terrain can otherwise pin a bot against
  // a wall indefinitely. Turn away and hop when prediction confirms no motion;
  // this exercises actual movement while leaving the authoritative activity gate intact.
  bot.blockedInputFrames = Math.hypot(me.vx, me.vy) < 10 ? bot.blockedInputFrames + 1 : 0;
  if (bot.blockedInputFrames >= 24) {
    bot.escapeDirection = (bot.lastMoveX || frame.moveX) > 0 ? -1 : 1;
    bot.escapeUntilInput = bot.inputId + 90;
    bot.blockedInputFrames = 0;
    bot.navigationRecoveries++;
  }
  const escapeRemaining = bot.escapeUntilInput - bot.inputId;
  if (escapeRemaining > 0) {
    frame.moveX = bot.escapeDirection;
    frame.jumpPressed = escapeRemaining === 90;
    frame.jumpHeld = escapeRemaining > 78;
    frame.jetPressed = escapeRemaining === 90;
    frame.jetHeld = escapeRemaining > 45;
    frame.crouchHeld = false;
  }
  bot.lastMoveX = frame.moveX;
  frame.fireHeld = true;
  frame.reloadPressed = me.ammo === 0 && me.reloadTicks === 0;
  if (target) {
    const x = bot.predict.value(target, 'x') + target.width / 2;
    const y = bot.predict.value(target, 'y') + target.height / 2;
    frame.aimAngle = Math.atan2(y - me.y - me.height / 2, x - me.x - me.width / 2);
  } else frame.aimAngle = toward > 0 ? 0 : Math.PI;
  return frame;
}
/** Same bounded-history policy as the browser: pause sends before the SDK replay ring wraps.
 * A resync message can precede its acknowledgement patch, so an unchanged near-full window
 * remains blocked and requests are additionally capped at one per second.
 */
function canSendInput(bot: Bot, now: number): boolean {
  bot.maxPendingInputs = Math.max(bot.maxPendingInputs, bot.handle.pendingCount);
  if (!bot.connected || bot.awaitingResync) return false;
  if (bot.handle.pendingCount < bot.handle.replayBufferSize - 4) return true;
  if (now >= bot.nextHistoryResyncAt) {
    bot.awaitingResync = true;
    bot.nextHistoryResyncAt = now + 1000;
    bot.historyResyncRequests++;
    // Clear staged intent without resetting reliable wire sequence/delta baselines.
    Object.assign(bot.handle.data, neutralInput(bot.controller.state.aimAngle, bot.inputId));
    bot.room.send('resync', {});
  }
  return false;
}

function metricSummary(samples: MetricsSample[]) {
  const active = samples.filter(sample => sample.phase === 'playing' && sample.simulation);
  const tail = active.filter(sample => sample.activeSeconds >= Math.max(60, (active.at(-1)?.activeSeconds ?? 0) - 300));
  const meanX = tail.reduce((sum, sample) => sum + sample.activeSeconds, 0) / (tail.length || 1);
  const meanY = tail.reduce((sum, sample) => sum + sample.rssBytes, 0) / (tail.length || 1);
  const numerator = tail.reduce((sum, sample) => sum + (sample.activeSeconds - meanX) * (sample.rssBytes - meanY), 0);
  const denominator = tail.reduce((sum, sample) => sum + (sample.activeSeconds - meanX) ** 2, 0);
  const memoryTrendMiBPerMinute = denominator ? numerator / denominator * 60 / 1024 / 1024 : 0;
  let delayedSince: number | null = null, longestScheduleBacklogSeconds = 0;
  for (const sample of active) {
    if ((sample.simulation?.scheduleLagMs ?? 0) > 100) {
      delayedSince ??= sample.elapsedSeconds;
      longestScheduleBacklogSeconds = Math.max(longestScheduleBacklogSeconds, sample.elapsedSeconds - delayedSince);
    } else delayedSince = null;
  }
  return {
    sampleCount: samples.length,
    maxRssBytes: Math.max(0, ...samples.map(sample => sample.rssBytes)),
    maxP99WorkMs: Math.max(0, ...active.map(sample => sample.simulation!.p99WorkMs)),
    maxPeakWorkMs: Math.max(0, ...active.map(sample => sample.simulation!.peakWorkMs)),
    maxScheduleLagMs: Math.max(0, ...active.map(sample => sample.simulation!.scheduleLagMs)),
    // Lifetime server counters retain bad intervals that recover between HTTP polls.
    longestScheduleBacklogSeconds: Math.max(longestScheduleBacklogSeconds,
      ...active.map(sample => (sample.simulation!.longestScheduleDeficitMs ?? 0) / 1000)),
    maxConsecutiveInputBacklogTicks: Math.max(0, ...active.map(sample =>
      sample.simulation!.maxConsecutiveInputBacklogTicks ?? sample.simulation!.consecutiveInputBacklogTicks)),
    minObservedTickRate: Math.min(60, ...active.map(sample => sample.simulation!.observedTickRate ?? 60)),
    droppedSimulationMs: Math.max(0, ...active.map(sample => sample.simulation!.droppedSimulationMs ?? 0)),
    catchUpLimitHits: Math.max(0, ...active.map(sample => sample.simulation!.catchUpLimitHits ?? 0)),
    memoryTrendMiBPerMinute,
    memoryTrendSampleCount: tail.length,
    maxInputBacklog: Math.max(0, ...active.map(sample => sample.simulation!.maxInputBacklog)),
    serverResynchronizations: active.at(-1)?.simulation?.resynchronizations ?? 0,
  };
}

async function main(): Promise<void> {
  const config = options(), bots: Bot[] = [], samples: MetricsSample[] = [], failures: string[] = [];
  const createdRooms: Room<any, MatchWire>[] = [];
  let pumping: ReturnType<typeof setInterval> | undefined;
  let aborted = false, stopping = false, fatal: Error | undefined;
  let activeSeconds = 0, roundsStarted = 0, maxClientLoopGapMs = 0, maxInputBudget = 0;
  let firstPlayAt = 0, startTime = performance.now(), previousPump = startTime;
  let lastPlayingTime: number | null = null;
  const stop = () => { aborted = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const health = await fetchJson<{ compatibility: string; tickRate: number; maxPlayers: number }>(`${config.endpoint}/health`);
    if (health.compatibility !== COMPATIBILITY_ID || health.tickRate !== 60 || health.maxPlayers !== PLAYER_COUNT) {
      throw new Error('Backend compatibility, tick rate, or eight-player capacity does not match this harness.');
    }
    const before = await fetchJson<Metrics>(`${config.endpoint}/metrics`);
    if (before.activeRooms !== 0) throw new Error('The instance already has a room. Finish its playtest before running the eight-client test.');
    for (let index = 0; index < PLAYER_COUNT; index++) {
      const client = new Client(config.endpoint, { headers: { Origin: GAME_ORIGIN } });
      const colors: ClothingColorId[] = ['olive', 'sand', 'slate', 'rust', 'navy', 'forest', 'charcoal', 'cream'];
      const guest = { nickname: `Load Bot ${index + 1}`, compatibility: COMPATIBILITY_ID,
        appearance: { ...DEFAULT_APPEARANCE, topColor: colors[index] } };
      const room = index === 0 ? await client.create('burnhop', guest, MatchWire)
        : await client.joinById(bots[0].room.roomId, guest, MatchWire);
      createdRooms.push(room);
      // Register handlers immediately so loading a room cannot lose lifecycle/error information.
      room.onMessage('notice', (notice: { code?: string; message?: string }) => {
        if (notice.code !== 'NOT_READY') failures.push(`Bot ${index + 1}: ${notice.code ?? 'NOTICE'} ${notice.message ?? ''}`);
      });
      await waitUntil(() => room.state.players?.has(room.sessionId), 10_000, 'the initial player snapshot');
      const handle = room.input({ type: InputWire, mode: 'reliable' });
      if (handle.tickRate !== MATCH_CONFIG.tickRate) throw new Error('The server did not negotiate 60 Hz inputs.');
      const predict = Predict.get(room, { mode: 'lerp', delay: MATCH_CONFIG.interpolationDelayMs });
      predict.attachAll('players', { fields: ['x', 'y', 'height'], mode: 'lerp', snap: 128 });
      const controller = predict.reconciler(room.state.players.get(room.sessionId)!, {
        input: handle, smoothMs: 65,
        step: (_context, mirror, frame) => { if (room.state.phase === 'playing') stepWireActor(mirror, frame, arena); },
      });
      const bot: Bot = { index, room, handle, predict, controller, lifeId: 0, phase: 'lobby', inputId: 0,
        connected: true, nextControlAt: 0, inputsSent: 0, moveIntentFrames: 0, fireIntentFrames: 0,
        shotsConfirmed: 0, hitsConfirmed: 0, deaths: 0, respawns: 0, drops: 0, reconnects: 0,
        resyncs: 0, historyResyncRequests: 0, awaitingResync: false, nextHistoryResyncAt: 0, maxPendingInputs: 0, movementSamples: 0, observations: 0, aliveObservations: 0,
        blockedInputFrames: 0, lastMoveX: 0, escapeDirection: 0, escapeUntilInput: 0, navigationRecoveries: 0 };
      bots.push(bot);
      room.onStateChange(state => {
        if (state.phase !== 'playing') return;
        const player = state.players.get(room.sessionId);
        if (!player) return;
        bot.observations++;
        // Respawn delays are a match rule, not inactive bot behavior. Retain all observations
        // for audit, but measure movement against the samples where this actor is alive.
        if (player.health > 0) {
          bot.aliveObservations++;
          // Velocity is direct authority; spawn teleport distances do not count as movement.
          if (Math.hypot(player.vx, player.vy) > 1) bot.movementSamples++;
        }
      });
      room.onMessage('events', (events: ActorEvent[]) => {
        for (const event of events) {
          if (event.actorId !== room.sessionId) continue;
          if (event.type === 'shot') bot.shotsConfirmed++;
          if (event.type === 'hit') bot.hitsConfirmed++;
          if (event.type === 'targetDeath') bot.deaths++;
          if (event.type === 'targetRespawn') bot.respawns++;
        }
      });
      room.onMessage('resync', (message: { player?: MatchPlayer }) => {
        bot.resyncs++; bot.awaitingResync = false; controller.reset();
        if (message.player) syncPlayerWire(controller.state, message.player);
      });
      room.onDrop(() => { bot.connected = false; bot.awaitingResync = false; bot.drops++; });
      room.onReconnect(() => { bot.connected = true; bot.awaitingResync = false; bot.reconnects++; controller.reset(); });
      room.onError((code, message) => { fatal = new Error(`Bot ${index + 1} socket error ${code}: ${message ?? ''}`); });
      room.onLeave((code, reason) => { bot.connected = false; if (!stopping) fatal = new Error(`Bot ${index + 1} left unexpectedly (${code}): ${reason ?? ''}`); });
    }
    await waitUntil(() => bots.every(bot => bot.room.state.players.size === PLAYER_COUNT), 10_000, 'eight distinct connected clients');
    console.log(JSON.stringify({ event: 'load-start', endpoint: config.endpoint, players: PLAYER_COUNT,
      requiredActiveSeconds: config.seconds, fullReleaseGateSeconds: 900, compatibility: COMPATIBILITY_ID }));
    startTime = performance.now(); previousPump = startTime;
    pumping = setInterval(() => {
      if (fatal || stopping || aborted) return;
      const now = performance.now();
      maxClientLoopGapMs = Math.max(maxClientLoopGapMs, now - previousPump); previousPump = now;
      try {
        const phase = bots[0].room.state.phase;
        const fullRoom = bots.every(bot => bot.connected) && bots[0].room.state.players.size === PLAYER_COUNT &&
          [...bots[0].room.state.players.values()].every(player => player.connected);
        if (phase === 'playing' && fullRoom) {
          if (!firstPlayAt) firstPlayAt = now;
          if (lastPlayingTime !== null) activeSeconds += (now - lastPlayingTime) / 1000;
          lastPlayingTime = now;
        } else lastPlayingTime = null;
        for (const bot of bots) {
          const me = bot.room.state.players.get(bot.room.sessionId);
          if (!me) throw new Error(`Bot ${bot.index + 1} disappeared from authoritative state.`);
          if (me.lifeId !== bot.lifeId || bot.phase !== bot.room.state.phase) {
            bot.controller.reset();
            if (bot.index === 0 && bot.phase !== 'playing' && bot.room.state.phase === 'playing') roundsStarted++;
            bot.lifeId = me.lifeId; bot.phase = bot.room.state.phase;
          }
          const historyReady = canSendInput(bot, now);
          const count = bot.predict.tick(now); maxInputBudget = Math.max(maxInputBudget, count);
          if (!bot.connected) continue;
          for (let tick = 0; historyReady && tick < count; tick++) {
            if (!canSendInput(bot, now)) break;
            const frame = command(bot); Object.assign(bot.handle.data, frame);
            if (bot.handle.send()) {
              bot.inputsSent++;
              if (frame.moveX) bot.moveIntentFrames++;
              if (frame.fireHeld) bot.fireIntentFrames++;
            }
          }
          if (now < bot.nextControlAt) continue;
          bot.nextControlAt = now + 1000;
          if (bot.phase === 'lobby') {
            if (!me.ready) bot.room.send('ready', { ready: true });
            if (bot.room.state.hostId === bot.room.sessionId && bot.room.state.players.size === PLAYER_COUNT &&
              [...bot.room.state.players.values()].every(player => player.connected && player.ready)) bot.room.send('start', {});
          } else if (bot.phase === 'results' && bot.room.state.hostId === bot.room.sessionId) bot.room.send('rematch', {});
        }
      } catch (error) { fatal = error instanceof Error ? error : new Error(String(error)); }
    }, 8);
    let nextMetricsAt = startTime, nextProgressAt = startTime;
    const deadline = startTime + (config.seconds * 1.3 + 120) * 1000;
    while (!fatal && !aborted && activeSeconds < config.seconds) {
      const now = performance.now();
      if (now > deadline) throw new Error('The requested active gameplay duration could not be reached before the watchdog deadline.');
      if (now >= nextMetricsAt) {
        const data = await fetchJson<Metrics>(`${config.endpoint}/metrics`);
        samples.push({ ...data, elapsedSeconds: (now - startTime) / 1000, activeSeconds, phase: bots[0].room.state.phase });
        nextMetricsAt = now + config.metricsIntervalMs;
        if (data.rssBytes >= MEMORY_LIMIT_BYTES) throw new Error('Backend process memory reached the 750 MB release limit.');
        if (now >= nextProgressAt) {
          console.log(JSON.stringify({ event: 'load-progress', activeSeconds: Math.round(activeSeconds), roundsStarted,
            connectedPlayers: data.connectedPlayers, p99WorkMs: data.simulation?.p99WorkMs,
            rssMiB: Math.round(data.rssBytes / 1024 / 1024), scheduleLagMs: data.simulation?.scheduleLagMs,
            confirmedShots: bots.reduce((sum, bot) => sum + bot.shotsConfirmed, 0) }));
          nextProgressAt = now + 30_000;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (fatal) throw fatal;
    if (aborted) throw new Error('Load test interrupted; the release gate is incomplete.');
    const data = await fetchJson<Metrics>(`${config.endpoint}/metrics`);
    samples.push({ ...data, elapsedSeconds: (performance.now() - startTime) / 1000, activeSeconds, phase: bots[0].room.state.phase });
  } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  finally {
    stopping = true;
    if (pumping) clearInterval(pumping);
    for (const bot of bots) bot.predict.dispose();
    await Promise.all(createdRooms.map(async room => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([room.leave().catch(() => undefined), new Promise(resolve => { timeout = setTimeout(resolve, 3000); })]);
      if (timeout) clearTimeout(timeout);
      room.connection.close();
    }));
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    const metrics = metricSummary(samples);
    const minimumShots = Math.max(1, Math.floor(activeSeconds / 6));
    const gates = {
      completedRequestedDuration: activeSeconds >= config.seconds,
      fifteenMinutes: activeSeconds >= 900,
      eightClients: bots.length === PLAYER_COUNT && bots.every(bot => bot.drops === 0) &&
        samples.filter(sample => sample.phase === 'playing').every(sample => sample.connectedPlayers === PLAYER_COUNT && sample.reservedPlayers === 0),
      activeMovementAndFiring: bots.length === PLAYER_COUNT && bots.every(bot => bot.shotsConfirmed >= minimumShots &&
        bot.moveIntentFrames > 0 && bot.aliveObservations > 0 && bot.movementSamples >= Math.max(1, bot.aliveObservations * 0.4)),
      simulationP99: metrics.sampleCount > 0 && metrics.maxP99WorkMs < TICK_BUDGET_MS,
      noSustainedBacklog: metrics.longestScheduleBacklogSeconds < 30 && metrics.maxConsecutiveInputBacklogTicks < 120,
      processMemoryBelow750MB: metrics.maxRssBytes > 0 && metrics.maxRssBytes < MEMORY_LIMIT_BYTES,
      stableProcessMemory: activeSeconds >= 900 && metrics.memoryTrendSampleCount >= 12 && metrics.memoryTrendMiBPerMinute <= 4,
      noErrors: failures.length === 0,
    };
    const passed = Object.values(gates).every(Boolean);
    const shortRunPassed = gates.completedRequestedDuration && gates.eightClients && gates.activeMovementAndFiring &&
      gates.simulationP99 && gates.noSustainedBacklog && gates.processMemoryBelow750MB && gates.noErrors;
    const summary = {
      generatedAt: new Date().toISOString(), endpoint: config.endpoint, compatibility: COMPATIBILITY_ID,
      requestedActiveSeconds: config.seconds, activeSeconds, elapsedSeconds: (performance.now() - startTime) / 1000,
      roundsStarted, players: PLAYER_COUNT, passed, shortRunPassed, gates, metrics,
      criteria: { p99WorkMsBelow: TICK_BUDGET_MS, rssBytesBelow: MEMORY_LIMIT_BYTES,
        sustainedScheduleBacklog: 'More than 100 ms behind for 30 consecutive seconds fails.',
        sustainedInputBacklog: 'More than eight buffered commands for 120 consecutive ticks fails.',
        activeMovement: 'Every bot must show nonzero authoritative velocity in at least 40% of its alive state samples, and confirm the minimum firing activity.',
        memoryStability: 'Final five-minute RSS regression must grow no faster than 4 MiB/min, after the first minute.' },
      client: { node: process.version, maxLoopGapMs: maxClientLoopGapMs, maxInputBudget },
      bots: bots.map(({ index, inputsSent, moveIntentFrames, fireIntentFrames, shotsConfirmed, hitsConfirmed, deaths, respawns,
        drops, reconnects, resyncs, historyResyncRequests, maxPendingInputs, movementSamples, observations, aliveObservations, navigationRecoveries, handle }) => ({ index, inputsSent, moveIntentFrames, fireIntentFrames,
        shotsConfirmed, hitsConfirmed, deaths, respawns, drops, reconnects, resyncs, historyResyncRequests, maxPendingInputs, replayBufferSize: handle.replayBufferSize, movementSamples, observations, aliveObservations, navigationRecoveries })),
      failures, samples,
      limitations: ['A scripted Frankfurt load test does not validate real Canada–India player latency.',
        'Network impairment must be applied to the actual socket path; this script does not emulate TCP packet loss.'],
    };
    await mkdir(dirname(config.output), { recursive: true });
    await writeFile(config.output, JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ event: 'load-complete', output: config.output, passed, shortRunPassed, gates, metrics, failures }));
    if (!shortRunPassed || (config.seconds >= 900 && !passed)) process.exitCode = 1;
  }
}

await main();
