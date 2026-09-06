import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, type Room as ClientRoom } from '@colyseus/sdk';
import { COMPATIBILITY_ID, neutralInput } from '../multiplayer/model';
import { InputWire, MatchWire } from '../multiplayer/wire';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { BurnhopRoom } from './BurnhopRoom';
import { GAME_ORIGIN } from './security';
import { startBackend } from './app';

const waitUntil = async (predicate: () => unknown, timeout = 4000) => {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Timed out waiting for server/client state');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

describe('actual WebSocket backend', () => {
  let backend: Awaited<ReturnType<typeof startBackend>>;
  let endpoint: string;
  const rooms: Array<ClientRoom<any, MatchWire>> = [];
  const guest = (nickname: string) => ({ nickname, appearance: DEFAULT_APPEARANCE, compatibility: COMPATIBILITY_ID });
  const client = () => new Client(endpoint, { headers: { Origin: GAME_ORIGIN } });
  beforeAll(async () => { backend = await startBackend(0, '127.0.0.1'); endpoint = `http://127.0.0.1:${backend.port}`; });
  afterAll(async () => {
    await Promise.all(rooms.map(room => room.leave().catch(() => undefined)));
    await backend?.server.gracefullyShutdown(false);
  });

  it('exposes safe health, rejects hostile HTTP origins and oversized requests', async () => {
    expect((await (await fetch(`${endpoint}/health`)).json() as { compatibility: string }).compatibility).toBe(COMPATIBILITY_ID);
    const preflight = await fetch(`${endpoint}/matchmake/create/burnhop`, {
      method: 'OPTIONS', headers: { Origin: GAME_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(GAME_ORIGIN);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    const rejected = await fetch(`${endpoint}/matchmake/create/burnhop`, {
      method: 'POST', headers: { Origin: 'https://bad.vercel.app', 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(rejected.status).toBe(403);
    const oversized = await fetch(`${endpoint}/matchmake/create/burnhop`, {
      method: 'POST', headers: { Origin: GAME_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ junk: 'x'.repeat(5000) }),
    });
    expect(oversized.status).toBe(413);
    const hidden = await fetch(`${endpoint}/matchmake/joinOrCreate/burnhop`, {
      method: 'POST', headers: { Origin: GAME_ORIGIN, 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(hidden.status).toBe(404);
  });

  it('rejects incompatible builds before allocation', async () => {
    await expect(client().create('burnhop', { ...guest('Old client'), compatibility: 'old' }, MatchWire)).rejects.toThrow(/update/i);
    expect(BurnhopRoom.active).toBeUndefined();
  });

  it('supports one private eight-player room, readiness/countdown locks and session-owned input', async () => {
    const host = await client().create('burnhop', guest('Host'), MatchWire); rooms.push(host);
    host.onMessage('events', () => undefined); host.onMessage('resync', () => undefined); host.onMessage('notice', () => undefined);
    await waitUntil(() => host.state.players.size === 1);
    expect(host.roomId).toMatch(/^[A-F0-9]{20}$/);
    expect(host.state.hostId).toBe(host.sessionId);
    expect(host.input({ type: InputWire }).tickRate).toBe(60);
    await expect(client().create('burnhop', guest('Other host'), MatchWire)).rejects.toThrow(/already has a room|wait/i);
    for (let index = 1; index < 8; index++) {
      const room = await client().joinById(host.roomId, guest(`Guest ${index}`), MatchWire); rooms.push(room);
      room.onMessage('events', () => undefined); room.onMessage('resync', () => undefined); room.onMessage('notice', () => undefined);
    }
    await waitUntil(() => host.state.players.size === 8);
    await expect(client().joinById(host.roomId, guest('Ninth'), MatchWire)).rejects.toThrow();
    for (const room of rooms) room.send('ready', { ready: true });
    await waitUntil(() => [...host.state.players.values()].every(player => player.ready));
    host.send('start', {});
    await waitUntil(() => host.state.phase === 'countdown');
    expect((await (await fetch(`${endpoint}/room/${host.roomId}`, { headers: { Origin: GAME_ORIGIN } })).json() as { phase: string }).phase).toBe('countdown');
    rooms[1].send('ready', { ready: false });
    await waitUntil(() => host.state.phase === 'lobby');
    rooms[1].send('ready', { ready: true });
    await waitUntil(() => host.state.players.get(rooms[1].sessionId)?.ready);
    host.send('start', {});
    await waitUntil(() => host.state.phase === 'playing', 5000);
    const beforeTick = BurnhopRoom.active!.match.tick;
    const handle = host.input({ type: InputWire });
    for (let i = 0; i < 12; i++) { Object.assign(handle.data, neutralInput(0, i)); handle.data.moveX = 1; handle.send(); }
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(BurnhopRoom.active!.match.tick - beforeTick).toBeLessThan(12);
    expect(BurnhopRoom.active!.inputs.get(host.sessionId).size).toBeGreaterThan(0);
    expect(Number.isFinite(host.state.players.get(host.sessionId)!.x)).toBe(true);
    const metrics = await (await fetch(`${endpoint}/metrics`)).json() as { connectedPlayers: number; simulation: { ticks: number } };
    expect(metrics.connectedPlayers).toBe(8); expect(metrics.simulation.ticks).toBeGreaterThan(180);
    expect(JSON.stringify(metrics)).not.toContain(host.roomId);
  }, 15_000);

  it('keeps a socket through a large TCP-style delivery burst and clears stale held input with its acknowledged resync', async () => {
    const host = rooms[0];
    const authority = BurnhopRoom.active!;
    const handle = host.input({ type: InputWire });
    await new Promise(resolve => setTimeout(resolve, 350)); // Let the previous queue drain.
    const previousResyncs = authority.metrics.snapshot().resynchronizations;
    const tick = authority.match.tick;
    let resetAck: number | undefined;
    const stop = host.onMessage<{ ack: number }>('resync', message => {
      resetAck = message.ack;
      expect(handle.lastProcessed).toBeGreaterThanOrEqual(message.ack);
    });
    // Actual TCP delivers these as a burst; no simulation step is allowed per message.
    for (let index = 0; index < 180; index++) {
      Object.assign(handle.data, neutralInput(0, 1000 + index), { moveX: 1, fireHeld: true, jetHeld: true, jetSeparate: true });
      handle.send();
    }
    await waitUntil(() => resetAck !== undefined);
    expect(authority.match.tick - tick).toBeLessThan(16);
    expect(authority.clients.length).toBe(8);
    expect(authority.metrics.snapshot().resynchronizations).toBeGreaterThan(previousResyncs);
    expect(authority.inputs.get(host.sessionId).size).toBe(0);
    const idle = authority.inputs.get(host.sessionId).next();
    expect(idle.moveX).toBe(0); expect(idle.fireHeld).toBe(false); expect(idle.jetHeld).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(authority.clients.length).toBe(8);
    expect(authority.metrics.snapshot().consecutiveInputBacklogTicks).toBe(0);
    stop();
  });

  it('serializes one contested pickup owner and preserves both weapon instances through a refresh reconnect', async () => {
    const authority = BurnhopRoom.active!, winner = rooms[2], loser = rooms[3], observer = rooms[0];
    const id = winner.sessionId, rivalId = loser.sessionId;
    const actor = authority.match.players[id], rival = authority.match.players[rivalId];
    const pickup = Object.values(authority.match.pickups).find(p => p.available && p.weapon.weaponId === 'uzi')!;
    expect(pickup).toBeDefined();
    const mainId = actor.weapon.instanceId, offhandId = pickup.weapon.instanceId;
    const mainAmmo = actor.weapon.ammo, mainCounter = actor.weapon.shotCounter;
    const offhandAmmo = pickup.weapon.ammo, offhandCounter = pickup.weapon.shotCounter;
    const events: Array<{ type: string; instanceId?: string; actorId: string }> = [];
    const stopEvents = observer.onMessage<typeof events>('events', batch => events.push(...batch));
    const frames = [winner, loser].map(room => room.input({ type: InputWire, mode: 'reliable' }));
    // Hold only this local test room's simulation until both genuine socket frames
    // arrive, so the test exercises a contested tick without scheduler-dependent order.
    const stepping = authority as unknown as { step(): void };
    const originalStep = stepping.step.bind(authority);
    let held = true;
    const stepSpy = vi.spyOn(stepping, 'step').mockImplementation(() => { if (!held) originalStep(); });
    try {
      for (const player of [actor, rival]) Object.assign(player, {
        x: pickup.x - player.width / 2, y: pickup.y + 18 - player.height,
        vx: 0, vy: 0, impulseX: 0, impulseY: 0, grounded: true,
      });
      for (const frame of frames) {
        Object.assign(frame.data, neutralInput(), { pairPressed: true }); frame.send();
      }
      await waitUntil(() => [id, rivalId].every(playerId => authority.inputs.get(playerId).size === 1));
      held = false;
      await waitUntil(() => [winner, loser, observer].every(room =>
        room.state.players.get(id)?.offhandInstanceId === offhandId && room.state.pickups.get(pickup.id)?.available === false));
      expect(actor.offhand?.instanceId).toBe(offhandId);
      expect(rival.offhand).toBeNull();
      expect(loser.state.players.get(rivalId)?.hasOffhand).toBe(false);
      await waitUntil(() => events.some(event => event.type === 'pickup' && event.instanceId === offhandId));
      expect(events.filter(event => event.type === 'pickup' && event.instanceId === offhandId)).toEqual([
        expect.objectContaining({ actorId: id }),
      ]);

      // Aim away from the arena; thirteen real input frames fire one pistol shot
      // and two staggered UZI shots, producing different non-default hand counters.
      await waitUntil(() => actor.equipTicks === 0);
      rival.x += 100;
      for (let tick = 0; tick < 13; tick++) {
        Object.assign(frames[0].data, neutralInput(-Math.PI / 2, tick), { fireHeld: true }); frames[0].send();
      }
      const expected = {
        instanceId: mainId, ammo: mainAmmo - 1, shotCounter: mainCounter + 1,
        hasOffhand: true, offhandInstanceId: offhandId, offhandAmmo: offhandAmmo - 2, offhandShotCounter: offhandCounter + 2,
        weaponId: 'pistol', offhandWeaponId: 'uzi', reserve: -1, offhandReserve: -1,
      };
      await waitUntil(() => [winner, observer].every(room => room.state.players.get(id)?.offhandShotCounter === expected.offhandShotCounter
        && room.state.players.get(id)?.shotCounter === expected.shotCounter) && authority.inputs.get(id).size === 0);
      expect(winner.state.players.get(id)).toMatchObject(expected);
      expect(observer.state.players.get(id)).toMatchObject(expected);

      const token = winner.reconnectionToken;
      winner.reconnection.enabled = false;
      rooms.splice(rooms.indexOf(winner), 1);
      winner.connection.close(1000, 'combat refresh');
      await waitUntil(() => authority.match.players[id]?.connected === false);
      const restored = await client().reconnect(token, MatchWire); rooms.push(restored);
      restored.onMessage('events', () => undefined); restored.onMessage('resync', () => undefined); restored.onMessage('notice', () => undefined);
      await waitUntil(() => restored.state.players.get(id)?.connected === true && observer.state.players.get(id)?.connected === true);
      expect(restored.sessionId).toBe(id);
      expect(restored.reconnectionToken).not.toBe(token);
      const resumedTick = authority.match.tick;
      await waitUntil(() => restored.state.tick >= resumedTick + 8 && observer.state.tick >= resumedTick + 8);
      // Recovery must not replay the old socket's held trigger during idle ticks.
      expect(restored.state.players.get(id)).toMatchObject(expected);
      expect(observer.state.players.get(id)).toMatchObject(expected);
      expect(restored.state.players.size).toBe(8);
      expect(Object.keys(authority.match.players)).toHaveLength(8);
      expect(authority.inputs.get(id).size).toBe(0);
      const owned = Object.values(authority.match.players).flatMap(player =>
        player.health > 0 ? [player.weapon.instanceId, ...(player.offhand ? [player.offhand.instanceId] : [])] : []);
      owned.push(...Object.values(authority.match.pickups).filter(item => item.available).map(item => item.weapon.instanceId));
      for (const instanceId of [mainId, offhandId]) expect(owned.filter(value => value === instanceId)).toHaveLength(1);
      const decodedOwners = [...restored.state.players.values()].flatMap(player =>
        [player.instanceId, ...(player.hasOffhand ? [player.offhandInstanceId] : [])]);
      for (const instanceId of [mainId, offhandId]) expect(decodedOwners.filter(value => value === instanceId)).toHaveLength(1);
    } finally {
      held = false; stepSpy.mockRestore(); stopEvents();
    }
  }, 8000);

  it('transfers host on explicit departure without stopping the authoritative match', async () => {
    const host = rooms.shift()!;
    const next = rooms[0];
    await host.leave();
    await waitUntil(() => next.state.hostId === next.sessionId);
    expect(next.state.players.size).toBe(7);
    expect(next.state.phase).toBe('playing');
  });

  it('reserves a dropped actor, transfers host and recovers through a saved refresh token', async () => {
    const dropped = rooms.shift()!;
    const id = dropped.sessionId;
    const token = dropped.reconnectionToken;
    dropped.reconnection.enabled = false; // A refresh destroys the old SDK instance.
    dropped.connection.close(1000, 'page refresh');
    await waitUntil(() => BurnhopRoom.active?.match.players[id]?.connected === false);
    expect(BurnhopRoom.active!.match.hostId).toBe(rooms[0].sessionId);
    expect(Object.keys(BurnhopRoom.active!.match.players)).toHaveLength(7);
    const actor = BurnhopRoom.active!.match.players[id];
    expect(actor.thrustLatched).toBe(false);
    const restored = await client().reconnect(token, MatchWire); rooms.push(restored);
    restored.onMessage('events', () => undefined); restored.onMessage('resync', () => undefined); restored.onMessage('notice', () => undefined);
    await waitUntil(() => restored.state.players.get(id)?.connected === true);
    expect(restored.sessionId).toBe(id);
    expect(restored.reconnectionToken).not.toBe(token);
    expect(restored.state.phase).toBe('playing');
    expect(BurnhopRoom.active!.inputs.get(id).size).toBe(0);
  });

  it('rejects a hostile WebSocket origin even when its HTTP request obtained a valid seat', async () => {
    const room = rooms[0];
    // Simulate a long event-loop hitch that crossed the five-minute deadline:
    // expiry must not wait for 18,000 physics catch-up steps to run.
    const authority = BurnhopRoom.active!;
    (authority as unknown as { phaseDeadline: number }).phaseDeadline = authority.clock.elapsedTime - 500;
    await waitUntil(() => room.state.phase === 'results');
    expect(authority.match.remainingTicks).toBe(0);
    room.send('rematch', {});
    await waitUntil(() => room.state.phase === 'lobby');
    const response = await fetch(`${endpoint}/matchmake/joinById/${room.roomId}`, {
      method: 'POST', headers: { Origin: GAME_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(guest('Wrong origin')),
    });
    expect(response.status).toBe(200);
    const reservation = await response.json();
    const hostile = new Client(endpoint, { headers: { Origin: 'https://hostile.example' } });
    await expect(hostile.consumeSeatReservation(reservation as Parameters<Client['consumeSeatReservation']>[0], MatchWire)).rejects.toThrow();
    expect(Object.keys(BurnhopRoom.active!.match.players)).toHaveLength(7);
  });
});
