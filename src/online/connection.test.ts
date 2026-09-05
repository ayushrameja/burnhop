import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { COMPATIBILITY_ID } from '../multiplayer/model';
import { MatchWire } from '../multiplayer/wire';

const sdk = vi.hoisted(() => ({ create: vi.fn(), joinById: vi.fn(), reconnect: vi.fn() }));
vi.mock('@colyseus/sdk', () => ({ Client: class { create = sdk.create; joinById = sdk.joinById; reconnect = sdk.reconnect; } }));
import { OnlineConnection } from './connection';

function signal<T extends unknown[]>() {
  const listeners: Array<(...args: T) => void> = [];
  return Object.assign((listener: (...args: T) => void) => listeners.push(listener), {
    invoke: (...args: T) => listeners.forEach(listener => listener(...args)),
  });
}
function fakeRoom() {
  const state = new MatchWire(); state.code = '0123456789ABCDEF0123';
  return { state, roomId: state.code, sessionId: 'session-a', reconnectionToken: `${state.code}:secret`, reconnection: {},
    onStateChange: signal<[MatchWire]>(), onDrop: signal<[]>(), onReconnect: signal<[]>(), onLeave: signal<[number, string?]>(),
    onError: signal<[number, string?]>(), onMessage: vi.fn(), send: vi.fn(), ping: vi.fn(), leave: vi.fn(async () => 1000) };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubEnv('VITE_COLYSEUS_URL', '');
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('online session lifecycle', () => {
  it('keeps practice available without inventing a backend endpoint', async () => {
    const connection = new OnlineConnection();
    await connection.create('Pilot', DEFAULT_APPEARANCE);
    expect(sdk.create).not.toHaveBeenCalled();
    expect(connection.getSnapshot()).toMatchObject({ status: 'error', sessionId: '', error: expect.stringContaining('not configured') });
    connection.dispose();
  });
  it('preserves the refresh token on disposal and clears it only on explicit Leave', async () => {
    const room = fakeRoom(); sdk.create.mockResolvedValue(room);
    const first = new OnlineConnection({ endpoint: 'ws://localhost:2567' });
    await first.create('Pilot', DEFAULT_APPEARANCE);
    const lastInput = first.nextInputId(); first.dispose();
    expect(room.leave).toHaveBeenCalledWith(false);
    const nextRoom = fakeRoom(); sdk.reconnect.mockResolvedValue(nextRoom);
    const recovered = new OnlineConnection({ endpoint: 'ws://localhost:2567' });
    expect(await recovered.recover()).toBe(true);
    expect(sdk.reconnect).toHaveBeenCalledWith(room.reconnectionToken, MatchWire);
    expect(recovered.nextInputId()).toBeGreaterThan(lastInput);
    await recovered.leave();
    expect(nextRoom.leave).toHaveBeenCalledWith(true);
    expect(sessionStorage.getItem('burnhop-online-session-v1')).toBeNull();
    recovered.dispose();
  });
  it('returns to room entry after a final disconnect or expired reconnection', async () => {
    const room = fakeRoom(); sdk.create.mockResolvedValue(room);
    const connection = new OnlineConnection({ endpoint: 'ws://localhost:2567' });
    await connection.create('Pilot', DEFAULT_APPEARANCE);
    room.onDrop.invoke(); expect(connection.getSnapshot().status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(30_001);
    expect(connection.getSnapshot()).toMatchObject({ status: 'error', sessionId: '', players: [], phase: 'lobby' });
    connection.dispose();
  });
  it('normalizes invite codes and explains a locked playing match before socket admission', async () => {
    const fetch = vi.fn(async (_url: string, _options?: unknown) => ({ ok: true, json: async () => ({ phase: 'playing', locked: true, compatibility: COMPATIBILITY_ID }) }));
    vi.stubGlobal('fetch', fetch);
    const connection = new OnlineConnection({ endpoint: 'ws://localhost:2567' });
    await connection.join('0123456789abcdef0123', 'Pilot', DEFAULT_APPEARANCE);
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:2567/room/0123456789ABCDEF0123');
    expect(sdk.joinById).not.toHaveBeenCalled();
    expect(connection.getSnapshot().error).toContain('Match in progress');
    connection.dispose();
  });
});
