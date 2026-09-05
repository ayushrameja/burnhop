import { Client, type Room } from '@colyseus/sdk';
import type { DetailedAppearance } from '../game/appearance';
import { COMPATIBILITY_ID, MATCH_CONFIG, type ActorEvent, type MatchPhase, type MatchPlayer } from '../multiplayer/model';
import { MatchWire, playerFromWire } from '../multiplayer/wire';

export interface OnlineSnapshot {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  error: string | null; sessionId: string; code: string; phase: MatchPhase;
  players: MatchPlayer[]; hostId: string; countdownTicks: number; remainingTicks: number;
  winnerIds: string[]; tick: number; latency: number | null;
}
interface SavedSession { endpoint: string; token: string; savedAt: number; compatibility: string }
const SESSION_KEY = 'burnhop-online-session-v1';
const INPUT_KEY = 'burnhop-online-input-id-v1';
const emptySnapshot = (): OnlineSnapshot => ({ status: 'idle', error: null, sessionId: '', code: '', phase: 'lobby',
  players: [], hostId: '', countdownTicks: 0, remainingTicks: 0, winnerIds: [], tick: 0, latency: null });

export function defaultOnlineEndpoint(): string {
  return import.meta.env.VITE_COLYSEUS_URL || '';
}

/** Owns the room session independently of canvas/capture and React screen lifetimes. */
export class OnlineConnection {
  readonly endpoint: string;
  private client: Client | null;
  private room: Room<MatchWire> | null = null;
  private snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(events: ActorEvent[]) => void>();
  private resetListeners = new Set<(player?: MatchPlayer) => void>();
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private inputId = 0;

  constructor(options: { endpoint?: string } = {}) {
    this.endpoint = options.endpoint ?? defaultOnlineEndpoint();
    this.client = this.endpoint ? new Client(this.endpoint) : null;
    try { this.inputId = Number(sessionStorage.getItem(INPUT_KEY)) || 0; } catch { /* Memory identity still works. */ }
  }
  getSnapshot = (): OnlineSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  onEvents(listener: (events: ActorEvent[]) => void): () => void { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  onReset(listener: (player?: MatchPlayer) => void): () => void { this.resetListeners.add(listener); return () => this.resetListeners.delete(listener); }
  getRoom(): Room<MatchWire> | null { return this.room; }
  nextInputId(): number {
    this.inputId = (this.inputId + 1) >>> 0;
    try { sessionStorage.setItem(INPUT_KEY, String(this.inputId)); } catch { /* Inputs keep their in-memory ordering. */ }
    return this.inputId;
  }
  clearError(): void { this.publish({ error: null }); }
  reportError(error: string): void { this.publish({ error }); }

  async create(nickname: string, appearance: DetailedAppearance): Promise<void> {
    await this.connect(() => this.client!.create<MatchWire>('burnhop', { compatibility: COMPATIBILITY_ID, nickname, appearance }, MatchWire));
  }
  async join(code: string, nickname: string, appearance: DetailedAppearance): Promise<void> {
    const roomId = code.trim().toUpperCase();
    if (!/^[A-F0-9]{20}$/.test(roomId)) { this.publish({ status: 'error', error: 'Enter the complete 20-character room code.' }); return; }
    await this.connect(async () => {
      const base = this.endpoint.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/$/, '');
      const response = await fetch(`${base}/room/${encodeURIComponent(roomId)}`, { signal: AbortSignal.timeout(8000) });
      const info = await response.json() as { error?: string; phase?: string; locked?: boolean; players?: number; maxPlayers?: number; compatibility?: string };
      if (!response.ok) throw new Error(info.error || 'Room not found. Check the invitation.');
      if (info.compatibility !== COMPATIBILITY_ID) throw new Error('Game update available. Refresh Burnhop before joining.');
      if (info.phase !== 'lobby') throw new Error('Match in progress. Ask your friend to return to the lobby after the round.');
      if (info.locked || (info.players ?? 0) >= (info.maxPlayers ?? MATCH_CONFIG.maxPlayers)) throw new Error('This room is full.');
      return this.client!.joinById<MatchWire>(roomId, { compatibility: COMPATIBILITY_ID, nickname, appearance }, MatchWire);
    });
  }
  async recover(): Promise<boolean> {
    let saved: SavedSession | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null'); } catch { /* Storage is optional. */ }
    if (!saved || saved.endpoint !== this.endpoint || saved.compatibility !== COMPATIBILITY_ID) return false;
    // A background tab can retain its socket while timers are throttled. Only the server
    // knows when disconnection began, and therefore when the 30-second reservation expires.
    await this.connect(() => this.client!.reconnect<MatchWire>(saved!.token, MatchWire), true);
    return this.snapshot.status === 'connected';
  }
  ready(ready: boolean): void { this.send('ready', { ready }); }
  startMatch(): void { this.send('start', {}); }
  rematch(): void { this.send('rematch', {}); }
  resync(): void { this.send('resync', {}); }
  private send(type: string, payload: unknown): void {
    if (this.snapshot.status !== 'connected') return;
    this.room?.send(type, payload);
  }
  async leave(): Promise<void> {
    this.generation++;
    this.clearTimers();
    const room = this.room;
    this.room = null;
    this.forgetSession();
    this.snapshot = emptySnapshot(); this.notify(); this.reset();
    if (room) { room.reconnection.enabled = false; await room.leave(true).catch(() => undefined); }
  }
  /** Unmount/refresh keeps the reserved session; only explicit Leave abandons it. */
  dispose(): void {
    this.saveSession(); this.generation++; this.clearTimers();
    const room = this.room; this.room = null;
    if (room) { room.reconnection.enabled = false; void room.leave(false).catch(() => undefined); }
    this.listeners.clear(); this.eventListeners.clear(); this.resetListeners.clear();
  }
  destroy(): void { this.dispose(); }

  private async connect(join: () => Promise<Room<MatchWire>>, recovering = false): Promise<void> {
    await this.leave();
    if (!this.client) { this.fail('Online play is not configured yet. Practice is available.'); return; }
    const generation = this.generation;
    this.publish({ status: recovering ? 'reconnecting' : 'connecting', error: null });
    try {
      const room = await join();
      if (generation !== this.generation) { await room.leave(true); return; }
      this.room = room;
      Object.assign(room.reconnection, { enabled: true, maxRetries: 30, minDelay: 300, maxDelay: 1500, minUptime: 0, maxEnqueuedMessages: 0 });
      room.onStateChange(() => this.readState(room));
      room.onMessage<ActorEvent[]>('events', events => { if (this.room === room) for (const listener of this.eventListeners) listener(events); });
      room.onMessage<{ message: string }>('notice', notice => { if (this.room === room) this.publish({ error: notice.message }); });
      room.onMessage<{ player?: MatchPlayer }>('resync', payload => { if (this.room === room) this.reset(payload?.player); });
      room.onDrop(() => {
        if (this.room !== room) return;
        this.publish({ status: 'reconnecting', error: 'Connection lost. Rejoining your reserved slot…' });
        this.reset();
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.room !== room || this.snapshot.status !== 'reconnecting') return;
          room.reconnection.enabled = false;
          void room.leave(false).catch(() => undefined);
          this.fail('The 30-second reconnect window expired. Join a new lobby to play again.');
        }, MATCH_CONFIG.reconnectSeconds * 1000);
      });
      room.onReconnect(() => {
        if (this.room !== room) return;
        clearTimeout(this.reconnectTimer);
        this.publish({ status: 'connected', error: null });
        this.saveSession(); this.reset();
      });
      room.onError((_code, message) => { if (this.room === room) this.publish({ error: message || 'The game server reported a connection error.' }); });
      room.onLeave((code, reason) => {
        if (this.room !== room) return;
        this.fail(reason || (code === 1000 ? 'You left the room.' : 'The room is no longer available. Create or join another room.'));
      });
      this.publish({ status: 'connected', sessionId: room.sessionId, code: room.roomId, error: null });
      this.readState(room); this.saveSession();
      this.heartbeat = setInterval(() => {
        if (this.snapshot.status !== 'connected') return;
        this.saveSession();
        room.ping(ms => { if (this.room === room) this.publish({ latency: Math.round(ms) }); });
      }, 2000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error instanceof Error ? error.message : 'Could not reach the game server. Check the room code and try again.');
    }
  }
  private readState(room: Room<MatchWire>): void {
    if (this.room !== room || !room.state?.players) return;
    const state = room.state;
    this.publish({ sessionId: room.sessionId, code: state.code || room.roomId, phase: state.phase,
      players: [...state.players.values()].map(playerFromWire).sort((a, b) => a.joinedOrder - b.joinedOrder),
      hostId: state.hostId, countdownTicks: state.countdownTicks, remainingTicks: state.remainingTicks,
      winnerIds: [...state.winnerIds], tick: state.tick });
  }
  private fail(error: string): void {
    this.clearTimers(); this.forgetSession(); this.room = null;
    this.snapshot = { ...emptySnapshot(), status: 'error', error }; this.notify(); this.reset();
  }
  private reset(player?: MatchPlayer): void { for (const listener of this.resetListeners) listener(player); }
  private publish(patch: Partial<OnlineSnapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; this.notify(); }
  private notify(): void { for (const listener of this.listeners) listener(); }
  private clearTimers(): void { clearTimeout(this.reconnectTimer); clearInterval(this.heartbeat); }
  private saveSession(): void {
    if (!this.room) return;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ endpoint: this.endpoint, token: this.room.reconnectionToken,
      savedAt: Date.now(), compatibility: COMPATIBILITY_ID } satisfies SavedSession)); } catch { /* Memory session still works. */ }
  }
  private forgetSession(): void { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage is optional. */ } }
}
