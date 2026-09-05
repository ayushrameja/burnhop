import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
