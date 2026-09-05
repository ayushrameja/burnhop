import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { performance } from 'node:perf_hooks';
import { compileArena, releaseActorInput } from '../game/simulation';
import { MATCH_CONFIG, COMPATIBILITY_ID, OUTPOST_ARENA, neutralInput, type MatchState, type NetworkInput } from '../multiplayer/model';
import { addPlayer, createMatch, removePlayer, returnToLobby, setConnected, setReady, startCountdown, stepMatch } from '../multiplayer/match';
import { InputWire, MatchWire, playerFromWire, syncMatchWire } from '../multiplayer/wire';
import { invitationCode, isAllowedOrigin, RateLimiter, sanitizeInput, validateJoinOptions } from './security';
import { SimulationMetrics } from './metrics';
import { idleInput, InputRateBudget } from './inputPolicy';

const arena = compileArena(OUTPOST_ARENA);
const controlLimiter = new RateLimiter(12, 4);

export class BurnhopRoom extends Room<{ state: MatchWire; input: InputWire }> {
  /** Process-local admission is deliberate: production runs exactly one PM2 fork. */
  static active: BurnhopRoom | undefined;
  state = new MatchWire();
  maxClients = MATCH_CONFIG.maxPlayers;
  // A hard protocol flood ceiling, separate from the sustained input budget.
  // 120 incorrectly rejected honest TCP delivery bursts after packet loss.
  maxMessagesPerSecond = 600;
  match!: MatchState;
  metrics = new SimulationMetrics();
  inputs = this.defineInput(InputWire, {
    bufferMaxSize: 32,
    sanitize: sanitizeInput,
    idle: ({ latest, sessionId }) => {
      const player = this.match?.players[sessionId];
      const missingTicks = (this.idleTicks.get(sessionId) ?? 0) + 1;
      this.idleTicks.set(sessionId, missingTicks);
      return idleInput(latest, player?.aimAngle ?? 0, missingTicks, player?.connected === true);
    },
  });
  rewind = this.allowRewindState({ maxRewindMs: MATCH_CONFIG.maxRewindMs });
  private lastLobbyActivity = Date.now();
  private previousPhase: MatchState['phase'] = 'lobby';
  private phaseDeadline = 0;
  private disposed = false;
  private idleTicks = new Map<string, number>();
  private inputBudgets = new Map<string, InputRateBudget>();
  private backlogTicks = new Map<string, number>();

  static async onAuth(_token: string, options: unknown, context: AuthContext) {
    if (!isAllowedOrigin(context.headers.get('origin'))) throw new ServerError(403, 'Open Burnhop from the game website.');
    try { return validateJoinOptions(options, COMPATIBILITY_ID); }
    catch (error) { throw new ServerError(400, (error as Error).message); }
  }

  async onCreate(options: unknown): Promise<void> {
    validateJoinOptions(options, COMPATIBILITY_ID);
    if (BurnhopRoom.active) throw new ServerError(503, 'The playtest server already has a room. Join its invitation or retry later.');
    BurnhopRoom.active = this;
    this.roomId = invitationCode();
    this.match = createMatch(this.roomId);
    this.state.compatibility = COMPATIBILITY_ID;
    this.autoDispose = true;
    this.setSeatReservationTime(15);
    this.setPatchRate(1000 / MATCH_CONFIG.stateRate);
    await this.setPrivate(true);
    this.rewind.attachAll(this.state.players, { fields: ['x', 'y', 'width', 'height'] });
    this.rewind.attachAll(this.state.players, { fields: ['lifeId', 'health', 'protectionTicks'], interpolate: 'step' });
    this.onMessage('ready', (client, message: unknown) => {
      if (!this.acceptControl(client)) return;
      if (!message || typeof message !== 'object' || typeof (message as { ready?: unknown }).ready !== 'boolean') return;
      if (setReady(this.match, client.sessionId, (message as { ready: boolean }).ready)) this.changed();
    });
    this.onMessage('start', client => {
      if (!this.acceptControl(client)) return;
      if (startCountdown(this.match, client.sessionId)) this.changed();
      else client.send('notice', { code: 'NOT_READY', message: 'At least two connected players must all be ready.' });
    });
    this.onMessage('rematch', client => {
      if (!this.acceptControl(client)) return;
      if (returnToLobby(this.match, client.sessionId, arena)) {
        for (const id of Object.keys(this.match.players)) {
          this.inputs.get(id).clear(); this.idleTicks.set(id, 7); this.backlogTicks.set(id, 0);
        }
        this.changed();
      }
    });
    this.onMessage('resync', client => { if (this.acceptControl(client)) this.resynchronize(client); });
    this.setFixedTimestep(() => this.step(), MATCH_CONFIG.tickRate);
    this.clock.setInterval(() => {
      if (this.match.phase === 'lobby' && Date.now() - this.lastLobbyActivity >= MATCH_CONFIG.idleLobbySeconds * 1000) {
        this.broadcast('notice', { code: 'LOBBY_EXPIRED', message: 'This inactive lobby expired. Create a new room.' });
        void this.disconnect();
      }
    }, 1000);
    this.changed();
  }

  onJoin(client: Client, options: unknown): void {
    const identity = validateJoinOptions(options, COMPATIBILITY_ID);
    if (this.match.phase !== 'lobby') throw new ServerError(409, 'Match in progress. Try again when the lobby reopens.');
    try { addPlayer(this.match, { id: client.sessionId, ...identity }, OUTPOST_ARENA); }
    catch (error) { throw new ServerError(409, (error as Error).message); }
    this.inputBudgets.set(client.sessionId, new InputRateBudget(this.clock.elapsedTime));
    this.changed();
  }

  onDrop(client: Client): void {
    this.inputs.get(client.sessionId).clear();
    this.idleTicks.set(client.sessionId, 7);
    this.backlogTicks.set(client.sessionId, 0);
    const player = this.match.players[client.sessionId];
    if (player) releaseActorInput(player);
    setConnected(this.match, client.sessionId, false);
    // A process shutdown can close a socket after room disposal has started.
    // That rejected reservation must not become an unhandled process error.
    void this.allowReconnection(client, MATCH_CONFIG.reconnectSeconds).catch(() => undefined);
    this.changed();
  }

  onReconnect(client: Client): void {
    this.inputs.get(client.sessionId).clear();
    this.idleTicks.set(client.sessionId, 7);
    this.backlogTicks.set(client.sessionId, 0);
    this.inputBudgets.set(client.sessionId, new InputRateBudget(this.clock.elapsedTime));
    const player = this.match.players[client.sessionId];
    if (player) releaseActorInput(player);
    setConnected(this.match, client.sessionId, true);
    this.changed();
  }

  onLeave(client: Client): void {
    removePlayer(this.match, client.sessionId);
    this.idleTicks.delete(client.sessionId);
    this.inputBudgets.delete(client.sessionId); this.backlogTicks.delete(client.sessionId);
    controlLimiter.delete(client.sessionId);
    this.changed();
  }

  onDispose(): void {
    this.disposed = true;
    if (BurnhopRoom.active === this) BurnhopRoom.active = undefined;
    for (const id of Object.keys(this.match?.players ?? {})) controlLimiter.delete(id);
  }

  private acceptControl(client: Client): boolean {
    if (controlLimiter.take(client.sessionId)) return true;
    client.send('notice', { code: 'RATE_LIMIT', message: 'Please wait a moment before trying again.' });
    return false;
  }

  private changed(): void {
    this.lastLobbyActivity = Date.now();
    this.synchronize();
  }

  private synchronize(): void {
    if (this.disposed) return;
    syncMatchWire(this.state, this.match);
    if (this.previousPhase !== this.match.phase) {
      this.previousPhase = this.match.phase;
      const duration = this.match.phase === 'countdown' ? MATCH_CONFIG.countdownTicks
        : this.match.phase === 'playing' ? MATCH_CONFIG.durationTicks : 0;
      this.phaseDeadline = duration ? this.clock.elapsedTime + duration * 1000 / MATCH_CONFIG.tickRate : 0;
      if (this.match.phase === 'lobby') void this.unlock();
      else void this.lock();
    }
  }

  private resynchronize(client: Client): void {
    this.inputs.get(client.sessionId).clear();
    // clear() intentionally retains the decoded .latest schema. Do not hold it
    // after a life/capture/history reset: wait for an actual fresh input frame.
    this.idleTicks.set(client.sessionId, 7);
    this.backlogTicks.set(client.sessionId, 0);
    const player = this.match.players[client.sessionId];
    if (!player) return;
    releaseActorInput(player);
    this.synchronize();
    this.metrics.resynchronized();
    client.send('resync', { tick: this.match.tick, ack: this.inputs.get(client.sessionId).consumedCount,
      player: playerFromWire(this.state.players.get(client.sessionId)!) }, { afterNextPatch: true });
  }

  private step(): void {
    const started = performance.now();
    // The framework bounds physics catch-up during a hitch. Match clocks follow
    // its monotonic elapsed clock, so dropped physics steps cannot extend a round.
    if (this.phaseDeadline) {
      const beforeStep = Math.max(1, Math.ceil((this.phaseDeadline - this.clock.elapsedTime) * MATCH_CONFIG.tickRate / 1000) + 1);
      if (this.match.phase === 'countdown') this.match.countdownTicks = beforeStep;
      if (this.match.phase === 'playing') this.match.remainingTicks = beforeStep;
    }
    const phase = this.match.phase;
    const lives = new Map(Object.values(this.match.players).map(player => [player.id, player.lifeId]));
    const commands: Record<string, NetworkInput> = Object.create(null);
    let backlog = 0;
    let longestBacklog = 0;
    for (const player of Object.values(this.match.players)) {
      const channel = this.inputs.get(player.id);
      backlog = Math.max(backlog, channel.size);
      const client = this.clients.get(player.id);
      // Overflow and clear both count discarded frames as consumed, making
      // consumedCount + size the monotonic decoded-frame total on this socket.
      if (player.connected && !this.inputBudgets.get(player.id)?.accept(channel.consumedCount + channel.size, this.clock.elapsedTime)) {
        channel.clear();
        client?.leave(4000, 'Input rate exceeded.');
        commands[player.id] = neutralInput(player.aimAngle);
        continue;
      }
      if (channel.size > 15 || (this.backlogTicks.get(player.id) ?? 0) >= 12) {
        if (client) this.resynchronize(client);
      }
      // Exactly one command per actor per simulation tick; bursts cannot accelerate time.
      commands[player.id] = player.connected ? channel.next() : neutralInput(player.aimAngle);
      if (player.connected && !channel.wasIdle) this.idleTicks.set(player.id, 0);
      const queuedTicks = channel.size > 8 ? (this.backlogTicks.get(player.id) ?? 0) + 1 : 0;
      this.backlogTicks.set(player.id, queuedTicks);
      longestBacklog = Math.max(longestBacklog, queuedTicks);
    }
    const events = stepMatch(this.match, commands, arena, (shooter, target) => {
      const wire = this.state.players.get(target.id);
      if (!wire) return null;
      const seen = this.rewind.lastSeenBy(shooter.id);
      return {
        x: seen.value(wire, 'x'), y: seen.value(wire, 'y'), width: seen.value(wire, 'width'), height: seen.value(wire, 'height'),
        lifeId: seen.value(wire, 'lifeId'), health: seen.value(wire, 'health'), protectionTicks: seen.value(wire, 'protectionTicks'),
      };
    });
    this.synchronize();
    for (const client of this.clients) {
      if ((phase !== 'playing' && this.match.phase === 'playing') || lives.get(client.sessionId) !== this.match.players[client.sessionId]?.lifeId) {
        this.resynchronize(client);
      }
    }
    if (events.length) this.broadcast('events', events);
    this.metrics.record(performance.now() - started, backlog, Date.now(), longestBacklog);
  }
}
