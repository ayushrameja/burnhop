import { Predict, type InputHandle, type Reconciler, type Room } from '@colyseus/sdk';
import { clampAimPointer, moveAimPointer, resolveAimAngle, resolveWeaponAim, type AimMode } from '../game/aim';
import type { GameAssets } from '../game/assets';
import { GameAudio } from '../game/audio';
import type { AudioSettings } from '../game/audioSettings';
import type { DetailedAppearance } from '../game/appearance';
import { DEFAULT_ZOOM_LEVEL, nextZoomLevel, type ZoomLevel } from '../game/camera';
import { normalizeControls, type ControlsSettings } from '../game/controls';
import { ActionInput } from '../game/input';
import { Renderer, type OnlineRenderActor } from '../game/renderer';
import { getReloadProgress } from '../game/reload';
import { CONFIG, compileArena, getWeaponOrigin } from '../game/simulation';
import type { HudState, Vec2 } from '../game/types';
import { MATCH_CONFIG, neutralInput, type ActorEvent, type MatchPlayer, type MatchPhase, type NetworkInput } from '../multiplayer/model';
import { InputWire, MatchWire, PlayerWire, playerFromWire, syncPlayerWire } from '../multiplayer/wire';
import { OnlineConnection } from './connection';
import { OnlineEffects } from './effects';
import { stepWireActor } from './prediction';

interface RuntimeCallbacks { onHud: (hud: HudState) => void; onPause: () => void; onPerformance?: (fps: number | null) => void; onZoom?: (zoom: ZoomLevel) => void }
const REMOTE_FIELDS = ['x', 'y', 'height', 'crouchAmount', 'vx', 'vy'] as const;
export interface OnlineDiagnostics {
  snapshot: () => { status: ReturnType<OnlineConnection['getSnapshot']>['status']; phase: MatchPhase; running: boolean; paused: boolean;
    local: MatchPlayer | null; authority: MatchPlayer | null; actors: MatchPlayer[]; pending: number; awaitingResync: boolean; replayBufferSize: number;
    correction: Vec2; aim: { angle: number; mode: AimMode; pointer: Vec2; locked: boolean } };
  toScreen: (x: number, y: number) => Vec2;
}
declare global { interface Window { __BURNHOP_ONLINE__?: OnlineDiagnostics } }

/** Canvas lifetime is independent of room lifetime. Pausing only neutralizes local intent. */
export class OnlineRuntime {
  private renderer: Renderer;
  private audio = new GameAudio();
  private input = new ActionInput();
  private compiled;
  private predict: Predict<MatchWire> | null = null;
  private handle: InputHandle<InputWire> | null = null;
  private controller: Reconciler<PlayerWire, NetworkInput> | null = null;
  private awaitingResync = false;
  private activeRoom: Room<MatchWire> | null = null;
  private localWire: PlayerWire | null = null;
  private remoteLives = new Map<string, { wire: PlayerWire; life: number }>();
  private localLife = -1;
  private localHealth = 0;
  private phase: MatchPhase = 'lobby';
  private effects = new OnlineEffects();
  private pendingEvents: ActorEvent[] = [];
  private paused = true;
  private disposed = false;
  private running = false;
  private raf = 0;
  private lastTime = 0;
  private lastHudTime = 0;
  private lastPerformanceTime = 0;
  private fps: number | null = null;
  private pointer: Vec2 = { x: 0, y: 0 };
  private aimAngle = 0;
  private zoomLevel: ZoomLevel = DEFAULT_ZOOM_LEVEL;
  private controlsKey = '';
  private reducedMotion = false;
  private resizeObserver: ResizeObserver;
  private unsubscribers: Array<() => void>;
  private mouseGestures = new Set<number>();
  private diagnostic: OnlineDiagnostics;

  constructor(private canvas: HTMLCanvasElement, private assets: GameAssets, private connection: OnlineConnection,
    private callbacks: RuntimeCallbacks) {
    this.compiled = compileArena(assets.arena);
    this.renderer = new Renderer(canvas, assets);
    this.diagnostic = {
      snapshot: () => {
        const local = this.controller ? playerFromWire(this.controller.state) : null;
        const authority = this.localWire ? playerFromWire(this.localWire) : null;
        return { status: this.connection.getSnapshot().status, phase: this.phase, running: this.running, paused: this.paused,
          local, authority, actors: this.activeRoom?.state?.players ? [...this.activeRoom.state.players.values()].map(playerFromWire) : [],
          pending: this.handle?.pendingCount ?? 0, awaitingResync: this.awaitingResync, replayBufferSize: this.handle?.replayBufferSize ?? 0,
          correction: { x: local && authority ? local.x - authority.x : 0, y: local && authority ? local.y - authority.y : 0 },
          aim: { angle: this.aimAngle, mode: this.input.aimMode, pointer: { ...this.pointer }, locked: document.pointerLockElement === this.canvas } };
      },
      toScreen: (x, y) => this.renderer.worldToScreen(x, y),
    };
    if (import.meta.env.DEV) window.__BURNHOP_ONLINE__ = this.diagnostic;
    const bounds = this.renderer.getPointerBounds();
    this.pointer = { x: bounds.left + (bounds.right - bounds.left) * 0.65, y: (bounds.top + bounds.bottom) / 2 };
    this.renderer.setPointer(this.pointer.x, this.pointer.y);
    this.resizeObserver = new ResizeObserver(() => { this.renderer.resize(); this.setPointer(clampAimPointer(this.pointer, this.renderer.getPointerBounds())); });
    this.resizeObserver.observe(canvas);
    this.unsubscribers = [connection.onEvents(events => {
      this.pendingEvents.push(...this.effects.authoritative(events, connection.getSnapshot().sessionId));
    }), connection.onReset(player => this.resetPrediction(player))];
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('mousedown', this.mouseDown);
    window.addEventListener('mousedown', this.mouseGestureStart, true);
    window.addEventListener('mouseup', this.mouseUp, true);
    window.addEventListener('click', this.mouseGestureEnd, true);
    window.addEventListener('auxclick', this.mouseGestureEnd, true);
    window.addEventListener('contextmenu', this.mouseGestureMenu, true);
    canvas.addEventListener('contextmenu', this.contextMenu);
    window.addEventListener('blur', this.focusLost);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    document.addEventListener('pointerlockchange', this.pointerLockChanged);
    this.callbacks.onZoom?.(this.zoomLevel);
  }
  start(): void {
    if (this.running || this.disposed) return;
    this.running = true; this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }
  pause(): void {
    if (this.disposed) return;
    const wasActive = !this.paused;
    this.paused = true; this.input.clear(); this.audio.pause();
    // A hidden tab may never get another animation frame, so release held intent now.
    if (wasActive && this.handle && this.connection.getSnapshot().status === 'connected' && this.ensureReplayCapacity()) {
      Object.assign(this.handle.data, neutralInput(this.aimAngle, this.connection.nextInputId()));
      this.handle.send();
    }
  }
  resume(): void {
    if (this.disposed || this.connection.getSnapshot().status !== 'connected'
      || this.connection.getSnapshot().phase !== 'playing' || document.pointerLockElement !== this.canvas) return;
    this.input.clear(); this.paused = false; this.start(); void this.audio.unlock();
  }
  setAppearance(_appearance: DetailedAppearance): void { /* Equipped appearance is frozen by the room admission. */ }
  setMuted(muted: boolean): void { this.audio.setMuted(muted); }
  setAudioVolumes(volumes: AudioSettings): void { this.audio.setVolumes(volumes); }
  setReducedMotion(value: boolean): void { this.reducedMotion = value; }
  setControls(value: ControlsSettings): void {
    const controls = normalizeControls(value), key = JSON.stringify(controls);
    if (key === this.controlsKey) return;
    this.controlsKey = key; this.input.configure(controls); this.refreshAim();
  }
  private resetPrediction(player?: MatchPlayer): void {
    this.awaitingResync = false;
    this.input.clear(); this.controller?.reset();
    if (player && this.controller) syncPlayerWire(this.controller.state, player);
    this.pendingEvents = []; this.effects.reset(); this.audio.pause();
    if (this.connection.getSnapshot().status !== 'connected') {
      this.pause(); this.callbacks.onPause();
    } else if (!this.paused) void this.audio.unlock();
  }
  private ensurePrediction(): boolean {
    const room = this.connection.getRoom();
    if (!room?.state?.players) return false;
    if (room !== this.activeRoom) {
      this.predict?.dispose(); this.activeRoom = room; this.controller = null; this.localWire = null; this.remoteLives.clear();
      this.predict = Predict.get(room, { mode: 'lerp', delay: MATCH_CONFIG.interpolationDelayMs });
      this.handle = room.input({ type: InputWire, mode: 'reliable' });
      if (this.handle.tickRate !== MATCH_CONFIG.tickRate) throw new Error('The server uses a different simulation rate. Refresh both clients.');
    }
    const me = room.state.players.get(room.sessionId);
    if (!me) return false;
    if (me !== this.localWire) {
      this.controller?.dispose(); this.localWire = me; this.localLife = me.lifeId; this.localHealth = me.health;
      this.controller = this.predict!.reconciler(me, {
        input: this.handle!, smoothMs: 65, snap: 128,
        // Omit fields intentionally: every scalar, including all timers and weapon state, is restored.
        step: (ctx, mirror, command) => {
          if (this.phase !== 'playing') return;
          const events = stepWireActor(mirror, command, this.compiled);
          if (!ctx.isReplay) {
            this.pendingEvents.push(...this.effects.predicted(events));
            this.input.reconcile(playerFromWire(mirror), events);
          }
        },
      });
    }
    if (this.localLife !== me.lifeId || (this.localHealth > 0 && me.health <= 0) || this.phase !== room.state.phase) {
      if (this.localLife !== me.lifeId || this.phase !== room.state.phase) this.renderer.resetOnlinePresentation();
      this.localLife = me.lifeId; this.input.clear(); this.controller!.reset(); this.pendingEvents = []; this.effects.reset();
      this.audio.pause(); if (!this.paused) void this.audio.unlock();
    }
    this.localHealth = me.health; this.phase = room.state.phase;
    for (const [id, previous] of this.remoteLives) {
      if (!room.state.players.has(id)) { this.predict!.detach(previous.wire); this.remoteLives.delete(id); }
    }
    for (const [id, player] of room.state.players) {
      if (id === room.sessionId) continue;
      const previous = this.remoteLives.get(id);
      if (previous?.wire === player && previous.life === player.lifeId) continue;
      if (previous) this.predict!.detach(previous.wire);
      this.predict!.attach(player, { mode: 'lerp', fields: REMOTE_FIELDS, snap: 128 });
      this.predict!.attach(player, { aimAngle: { mode: 'lerp', angle: true } });
      this.remoteLives.set(id, { wire: player, life: player.lifeId });
    }
    return true;
  }
  private ensureReplayCapacity(): boolean {
    if (!this.handle || this.awaitingResync) return false;
    if (this.handle.pendingCount < this.handle.replayBufferSize - 4) return true;
    // Downlink stalls can exhaust replay history while the server's input queue is healthy.
    this.awaitingResync = true; this.input.clear(); this.connection.resync();
    return false;
  }
  private stageInput(): void {
    if (!this.handle || !this.ensureReplayCapacity()) return;
    const actor = this.controller ? playerFromWire(this.controller.state) : null;
    const active = !this.paused && this.phase === 'playing' && actor && actor.health > 0;
    const command = neutralInput(this.aimAngle, this.connection.nextInputId());
    if (active) {
      const intent = this.input.consumeTick();
      Object.assign(command, { moveX: intent.moveX, jumpPressed: intent.jumpPressed, jumpHeld: intent.jumpHeld,
        jetPressed: intent.jetpack?.pressed ?? false, jetHeld: intent.jetpack?.held ?? false,
        jetSeparate: intent.jetpack?.source === 'separate', crouchHeld: intent.crouchHeld ?? false,
        fireHeld: intent.fireHeld, reloadPressed: intent.reloadPressed,
        aimAngle: resolveWeaponAim(this.pointer, actor, point => this.renderer.worldToScreen(point.x, point.y), this.aimAngle, this.input.aimMode).angle });
    }
    Object.assign(this.handle.data, command); this.handle.send();
  }
  private frame = (time: number): void => {
    if (this.disposed || !this.running) return;
    const elapsed = Math.max(0, time - this.lastTime); this.lastTime = time;
    try {
      if (this.ensurePrediction()) {
        const connected = this.connection.getSnapshot().status === 'connected';
        const steps = this.predict!.tick(time);
        if (connected && !this.awaitingResync) for (let i = 0; i < steps; i++) this.stageInput();
        const actors: OnlineRenderActor[] = [];
        for (const [id, wire] of this.activeRoom!.state.players) {
          const local = id === this.activeRoom!.sessionId;
          const actor = playerFromWire(local && this.controller ? this.controller.state : wire);
          // Health/lives/respawn stay authoritative, even while movement is predicted.
          actor.health = wire.health; actor.lifeId = wire.lifeId; actor.protectionTicks = wire.protectionTicks;
          for (const field of REMOTE_FIELDS) actor[field] = this.predict!.value(wire, field);
          actor.aimAngle = local ? actor.aimAngle : this.predict!.value(wire, 'aimAngle');
          actors.push({ player: actor, appearance: actor.appearance, nickname: actor.nickname,
            connected: wire.connected, protected: wire.protectionTicks > 0, lifeId: wire.lifeId });
        }
        const local = actors.find(actor => actor.player.id === this.activeRoom!.sessionId);
        const events = this.pendingEvents.splice(0).filter(event => {
          const source = this.activeRoom!.state.players.get(event.actorId);
          const target = event.targetId ? this.activeRoom!.state.players.get(event.targetId) : undefined;
          return (!source || event.lifeId >= source.lifeId)
            && (!target || event.targetLifeId === undefined || event.targetLifeId >= target.lifeId);
        });
        if (local) {
          for (const actor of actors) this.audio.updateActor(actor.player.id, actor.player,
            getReloadProgress(actor.player.weapon.reloadTicks, CONFIG.reloadTicks), actor.player.health > 0 && actor.player.thrusting,
            events.filter(event => event.actorId === actor.player.id), local.player, actor === local);
          this.audio.retainActors(new Set(actors.map(actor => actor.player.id)));
          this.renderer.renderOnline(actors, local.player.id, this.activeRoom!.state.tick, events,
            Math.min(elapsed / 1000, 0.1), this.reducedMotion, this.input.aimMode,
            this.paused ? undefined : { pointer: this.pointer, previousAngle: this.aimAngle });
          if (!this.paused) this.aimAngle = this.renderer.getRenderedAimAngle();
          if (time - this.lastHudTime > 50) {
            const p = local.player;
            this.callbacks.onHud({ health: p.health, fuel: p.fuel, ammo: p.weapon.ammo,
              reloadProgress: getReloadProgress(p.weapon.reloadTicks, CONFIG.reloadTicks), shotsFired: 0, hits: 0,
              kills: this.localWire?.kills ?? 0, targetHealth: 0 });
            this.lastHudTime = time;
          }
        }
      }
    } catch (error) {
      this.connection.reportError(error instanceof Error ? error.message : 'Online simulation could not start.');
      this.pause(); this.callbacks.onPause(); this.running = false; return;
    }
    if (elapsed > 0) this.fps = this.fps === null ? 1000 / elapsed : this.fps * 0.92 + (1000 / elapsed) * 0.08;
    if (time - this.lastPerformanceTime > 250) { this.callbacks.onPerformance?.(this.fps); this.lastPerformanceTime = time; }
    this.raf = requestAnimationFrame(this.frame);
  };
  private setPointer(point: Vec2): void { this.pointer = point; this.renderer.setPointer(point.x, point.y); this.refreshAim(); }
  private refreshAim(): void {
    if (!this.controller) return;
    const player = playerFromWire(this.controller.state);
    const pivot = this.renderer.getAimDiagnostics()?.pivot ?? getWeaponOrigin(player);
    this.aimAngle = resolveAimAngle(this.pointer, this.renderer.worldToScreen(pivot.x, pivot.y), this.aimAngle, this.input.aimMode);
  }
  private press(binding: string): void {
    const actions = this.input.press(binding);
    if (actions.includes('pause')) { this.pause(); this.callbacks.onPause(); return; }
    if (actions.includes('zoom')) { this.zoomLevel = nextZoomLevel(this.zoomLevel); this.renderer.setZoom(this.zoomLevel); this.callbacks.onZoom?.(this.zoomLevel); }
    this.refreshAim();
  }
  private keyDown = (event: KeyboardEvent): void => {
    if (this.paused || this.disposed || event.defaultPrevented) return;
    if (event.code === 'Escape') { event.preventDefault(); this.pause(); this.callbacks.onPause(); return; }
    if (event.target instanceof Element && event.target.closest('button,input,select,textarea,[contenteditable="true"]')) return;
    if (this.input.isBound(event.code)) event.preventDefault();
    if (!event.repeat) this.press(event.code);
  };
  private keyUp = (event: KeyboardEvent): void => { this.input.release(event.code); this.refreshAim(); };
  private pointerMove = (event: MouseEvent): void => {
    if (this.disposed) return;
    if (document.pointerLockElement === this.canvas) {
      if (!this.paused) this.setPointer(moveAimPointer(this.pointer, { x: event.movementX, y: event.movementY }, this.renderer.getPointerBounds()));
    } else if (!this.paused) this.setPointer({ x: event.clientX, y: event.clientY });
  };
  private mouseDown = (event: MouseEvent): void => {
    if (event.button < 0 || event.button > 4 || this.paused || this.disposed) return;
    event.preventDefault(); this.mouseGestures.add(event.button); this.press(`Mouse${event.button}`); void this.audio.unlock();
  };
  private mouseUp = (event: MouseEvent): void => {
    if (this.mouseGestures.has(event.button)) event.preventDefault();
    this.input.release(`Mouse${event.button}`); this.refreshAim();
  };
  private mouseGestureStart = (event: MouseEvent): void => { this.mouseGestures.delete(event.button); };
  private mouseGestureEnd = (event: MouseEvent): void => {
    if (!this.mouseGestures.has(event.button) || event.detail === 0) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.mouseGestures.delete(event.button);
  };
  private mouseGestureMenu = (event: MouseEvent): void => { if (this.mouseGestures.has(event.button)) { event.preventDefault(); event.stopImmediatePropagation(); } };
  private contextMenu = (event: MouseEvent): void => { if (!this.paused) event.preventDefault(); };
  private focusLost = (): void => { if (!this.paused) { this.pause(); this.callbacks.onPause(); } };
  private visibilityChanged = (): void => { if (document.hidden) this.focusLost(); };
  private pointerLockChanged = (): void => {
    this.input.clear();
    if (document.pointerLockElement !== this.canvas) this.focusLost();
    else this.setPointer(clampAimPointer(this.pointer, this.renderer.getPointerBounds()));
  };
  destroy(): void {
    if (this.disposed) return;
    this.pause(); this.disposed = true; this.running = false; cancelAnimationFrame(this.raf);
    this.predict?.dispose(); this.resizeObserver.disconnect(); for (const off of this.unsubscribers) off();
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('mousedown', this.mouseDown);
    window.removeEventListener('mousedown', this.mouseGestureStart, true); window.removeEventListener('mouseup', this.mouseUp, true);
    window.removeEventListener('click', this.mouseGestureEnd, true); window.removeEventListener('auxclick', this.mouseGestureEnd, true);
    window.removeEventListener('contextmenu', this.mouseGestureMenu, true); this.canvas.removeEventListener('contextmenu', this.contextMenu);
    window.removeEventListener('blur', this.focusLost); document.removeEventListener('visibilitychange', this.visibilityChanged);
    document.removeEventListener('pointerlockchange', this.pointerLockChanged); this.renderer.destroy(); this.audio.destroy();
    if (window.__BURNHOP_ONLINE__ === this.diagnostic) delete window.__BURNHOP_ONLINE__;
  }
}
