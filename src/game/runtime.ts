import { BOT_APPEARANCE, DEFAULT_APPEARANCE, normalizeAppearance, type DetailedAppearance } from './appearance';
import { GameAudio } from './audio';
import type { AudioSettings } from './audioSettings';
import { getReloadProgress } from './reload';
import { clampAimPointer, moveAimPointer, resolveAimAngle, resolveWeaponAim, type AimMode } from './aim';
import { Renderer } from './renderer';
import { CONFIG, cloneWorld, createWorld, getWeaponOrigin, releasePlayerInput, stepSimulation } from './simulation';
import { FixedStepClock } from './timing';
import { ActionInput } from './input';
import { normalizeControls, type ControlsSettings } from './controls';
import { DEFAULT_ZOOM_LEVEL, nextZoomLevel, type ZoomLevel } from './camera';
import { type GameAssets, type GameEvent, type HudState, type InputCommand, type Vec2, type WorldState } from './types';

interface RuntimeCallbacks { onHud: (hud: HudState) => void; onPause: () => void; onPerformance?: (fps: number | null) => void; onZoom?: (zoom: ZoomLevel) => void }
export interface RuntimeDiagnostics {
  snapshot: () => WorldState;
  toScreen: (x: number, y: number) => { x: number; y: number };
  metrics: () => { fps: number | null; frames: number; running: boolean; tick: number };
  appearances: () => { player: DetailedAppearance; target: DetailedAppearance };
  camera: () => ReturnType<Renderer['getCameraDiagnostics']>;
  input: () => ReturnType<ActionInput['snapshot']>;
  aim: () => { mode: AimMode; firing: boolean; angle: number; visualAngle: number; pointer: Vec2; locked: boolean; reticle: ReturnType<Renderer['getAimDiagnostics']> };
}
declare global { interface Window { __BURNHOP__?: RuntimeDiagnostics } }

/** Owns browser resources, not rules. React creates exactly one instance per practice session. */
export class GameRuntime {
  private renderer: Renderer;
  private audio = new GameAudio();
  private clock = new FixedStepClock();
  private world: WorldState;
  private previous: WorldState;
  private appearance: DetailedAppearance = { ...DEFAULT_APPEARANCE };
  private input = new ActionInput();
  private mouseGestures = new Set<number>();
  private controlsKey = '';
  private zoomLevel: ZoomLevel = DEFAULT_ZOOM_LEVEL;
  private get firing(): boolean { return this.input.active('fire'); }
  private get aimMode(): AimMode { return this.input.aimMode; }
  private latestAimAngle = 0;
  private pointer = { x: 0, y: 0 };
  private paused = true;
  private disposed = false;
  private raf = 0;
  private lastTime = 0;
  private lastHudTime = 0;
  private debug = false;
  private reducedMotion = false;
  private resizeObserver: ResizeObserver;
  private frameSamples: { time: number; duration: number }[] = [];
  private fps: number | null = null;
  private lastPerformanceTime = 0;
  private frames = 0;
  private diagnostic: RuntimeDiagnostics;

  constructor(private canvas: HTMLCanvasElement, private assets: GameAssets, private callbacks: RuntimeCallbacks) {
    this.world = createWorld(assets.arena);
    this.previous = cloneWorld(this.world);
    this.renderer = new Renderer(canvas, assets);
    this.resizeObserver = new ResizeObserver(() => {
      this.renderer.resize();
      if (document.pointerLockElement === this.canvas) this.setPointer(clampAimPointer(this.pointer, this.renderer.getPointerBounds()));
      if (this.paused) this.draw([], 0, 1);
    });
    this.resizeObserver.observe(canvas);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('mousedown', this.mouseDown);
    window.addEventListener('mousedown', this.mouseGestureStart, true);
    window.addEventListener('mouseup', this.mouseUp, true);
    window.addEventListener('click', this.mouseGestureEnd, true);
    window.addEventListener('auxclick', this.mouseGestureEnd, true);
    window.addEventListener('contextmenu', this.mouseGestureMenu, true);
    window.addEventListener('pointercancel', this.pointerCancel);
    canvas.addEventListener('contextmenu', this.contextMenu);
    window.addEventListener('blur', this.focusLost);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    document.addEventListener('pointerlockchange', this.pointerLockChanged);
    this.diagnostic = {
      snapshot: () => cloneWorld(this.world),
      toScreen: (x, y) => this.renderer.worldToScreen(x, y),
      metrics: () => ({ fps: this.fps, frames: this.frames, running: !this.paused && !this.disposed, tick: this.world.tick }),
      appearances: () => ({ player: { ...this.appearance }, target: { ...BOT_APPEARANCE } }),
      camera: () => this.renderer.getCameraDiagnostics(),
      input: () => this.input.snapshot(),
      aim: () => ({ mode: this.aimMode, firing: this.firing, angle: this.world.player.aimAngle, visualAngle: this.renderer.getRenderedAimAngle(),
        pointer: { ...this.pointer }, locked: document.pointerLockElement === this.canvas, reticle: this.renderer.getAimDiagnostics() }),
    };
    if (import.meta.env.DEV) window.__BURNHOP__ = this.diagnostic;
    this.pointer = this.renderer.worldToScreen(this.world.target.x + this.world.target.width / 2, this.world.target.y + this.world.target.height / 2);
    this.renderer.setPointer(this.pointer.x, this.pointer.y);
    this.draw([], 0, 1);
    this.resetPerformance();
    this.publishHud();
    this.callbacks.onZoom?.(this.zoomLevel);
  }

  start(): void { this.resume(); }
  pause(): void {
    if (this.disposed) return;
    this.paused = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearInput();
    this.clock.reset();
    releasePlayerInput(this.world);
    this.audio.pause();
    this.resetPerformance();
    this.draw([], 0, 1);
  }
  resume(): void {
    if (this.disposed || !this.paused) return;
    this.clearInput();
    this.paused = false;
    this.lastTime = performance.now();
    this.lastHudTime = 0;
    this.resetPerformance();
    void this.audio.unlock();
    this.raf = requestAnimationFrame(this.frame);
  }
  reset(): void {
    this.audio.pause();
    this.audio.updateReload(-1);
    this.world = createWorld(this.assets.arena);
    this.previous = cloneWorld(this.world);
    this.clearInput();
    this.clock.reset();
    this.latestAimAngle = this.world.player.aimAngle;
    this.lastTime = performance.now();
    this.resetPerformance();
    // Reset disposable camera/effects while keeping the session's selected view preset.
    this.renderer.destroy();
    this.renderer = new Renderer(this.canvas, this.assets);
    this.renderer.setZoom(this.zoomLevel);
    this.callbacks.onZoom?.(this.zoomLevel);
    // Establish the new spawn camera before projecting its initial pointer.
    this.draw([], 0, 1);
    this.pointer = this.renderer.worldToScreen(this.world.target.x + this.world.target.width / 2, this.world.target.y + this.world.target.height / 2);
    if (document.pointerLockElement === this.canvas) this.pointer = clampAimPointer(this.pointer, this.renderer.getPointerBounds());
    this.renderer.setPointer(this.pointer.x, this.pointer.y);
    this.draw([], 0, 1);
    this.publishHud();
    if (!this.paused) void this.audio.unlock();
  }
  setAppearance(value: DetailedAppearance): void { this.appearance = normalizeAppearance(value); if (this.paused) this.draw([], 0, 1); }
  setMuted(muted: boolean): void { this.audio.setMuted(muted); }
  setAudioVolumes(volumes: AudioSettings): void { this.audio.setVolumes(volumes); }
  setReducedMotion(value: boolean): void { this.reducedMotion = value; }
  setControls(value: ControlsSettings): void {
    const controls = normalizeControls(value), key = JSON.stringify(controls);
    if (key === this.controlsKey) return;
    this.controlsKey = key;
    this.input.configure(controls);
    this.clearInput();
    this.refreshInputAim();
    if (this.paused) this.draw([], 0, 1);
  }

  private clearInput(): void {
    this.input.clear();
    releasePlayerInput(this.world);
    this.audio.setThrust(false);
  }
  private setPointer(pointer: Vec2): void {
    this.pointer = pointer;
    this.renderer.setPointer(pointer.x, pointer.y);
    this.refreshInputAim();
  }
  private refreshInputAim(): void {
    // Retain the newest input even when several moves enter the dead zone between two frames.
    const pivot = this.renderer.getAimDiagnostics()?.pivot ?? getWeaponOrigin(this.world.player);
    this.latestAimAngle = resolveAimAngle(this.pointer, this.renderer.worldToScreen(pivot.x, pivot.y), this.latestAimAngle, this.aimMode);
  }
  private keyDown = (event: KeyboardEvent): void => {
    if (this.paused || this.disposed || event.defaultPrevented) return;
    // Escape is the fixed exit even if an unbound Tab moved focus into the HUD.
    if (event.code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) { this.pause(); this.callbacks.onPause(); }
      return;
    }
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, [contenteditable="true"]')) return;
    if (this.input.isBound(event.code) || (event.code === 'F3' && import.meta.env.DEV)) event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'F3' && import.meta.env.DEV) { this.debug = !this.debug; return; }
    this.pressInput(event.code);
  };
  private keyUp = (event: KeyboardEvent): void => { this.input.release(event.code); this.refreshInputAim(); };
  private pressInput(binding: string): void {
    const actions = this.input.press(binding);
    if (actions.includes('pause')) { this.pause(); this.callbacks.onPause(); return; }
    if (actions.includes('zoom')) {
      this.zoomLevel = nextZoomLevel(this.zoomLevel);
      this.renderer.setZoom(this.zoomLevel);
      this.callbacks.onZoom?.(this.zoomLevel);
    }
    this.refreshInputAim();
  }
  private pointerMove = (event: MouseEvent): void => {
    if (this.disposed) return;
    if (document.pointerLockElement === this.canvas) {
      if (!this.paused) this.setPointer(moveAimPointer(this.pointer, { x: event.movementX, y: event.movementY }, this.renderer.getPointerBounds()));
    } else this.setPointer({ x: event.clientX, y: event.clientY });
  };
  private mouseDown = (event: MouseEvent): void => {
    if (event.button < 0 || event.button > 4 || this.paused || this.disposed) return;
    event.preventDefault();
    this.mouseGestures.add(event.button);
    // Locked MouseEvents carry frozen client coordinates; only motion changes the virtual pointer.
    if (document.pointerLockElement !== this.canvas) this.setPointer({ x: event.clientX, y: event.clientY });
    this.pressInput(`Mouse${event.button}`);
    void this.audio.unlock();
  };
  private mouseUp = (event: MouseEvent): void => {
    // A mouse binding can pause on down. Its up/click still belongs to gameplay,
    // rather than the newly revealed menu or the browser's Back/Forward action.
    if (this.mouseGestures.has(event.button)) event.preventDefault();
    this.input.release(`Mouse${event.button}`);
    this.refreshInputAim();
  };
  private mouseGestureStart = (event: MouseEvent): void => { this.mouseGestures.delete(event.button); };
  private mouseGestureEnd = (event: MouseEvent): void => {
    if (!this.mouseGestures.has(event.button) || event.detail === 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.mouseGestures.delete(event.button);
  };
  private mouseGestureMenu = (event: MouseEvent): void => {
    if (this.mouseGestures.has(event.button)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private pointerCancel = (): void => { this.clearInput(); };
  private contextMenu = (event: MouseEvent): void => { if (!this.paused && !this.disposed) event.preventDefault(); };
  private focusLost = (): void => { if (!this.paused) { this.pause(); this.callbacks.onPause(); } };
  private visibilityChanged = (): void => { if (document.hidden) this.focusLost(); };
  private pointerLockChanged = (): void => {
    this.clearInput();
    if (document.pointerLockElement === this.canvas) this.setPointer(clampAimPointer(this.pointer, this.renderer.getPointerBounds()));
  };

  private frame = (time: number): void => {
    if (this.paused || this.disposed) return;
    const elapsed = Math.max(0, time - this.lastTime);
    this.lastTime = time;
    this.recordFrame(time, elapsed);
    this.frames++;
    const events: GameEvent[] = [];
    const alpha = this.clock.advance(elapsed / 1000, () => {
      this.previous = cloneWorld(this.world);
      const player = this.world.player;
      const command: InputCommand = {
        tick: this.world.tick, actorId: player.id,
        ...this.input.consumeTick(),
        aimAngle: resolveWeaponAim(this.pointer, player,
          point => this.renderer.worldToScreen(point.x, point.y), this.latestAimAngle, this.aimMode).angle,
      };
      const tickEvents = stepSimulation(this.world, command, this.assets.arena);
      this.input.reconcile(this.world.player, tickEvents);
      // Contacts and reload cues follow simulation progress, including pause/resume.
      this.audio.play(tickEvents);
      this.audio.updateMovement(this.world.player);
      this.audio.updateReload(getReloadProgress(this.world.player.weapon.reloadTicks, CONFIG.reloadTicks));
      this.audio.setThrust(this.world.player.thrusting);
      events.push(...tickEvents);
    });
    this.draw(events, Math.min(elapsed / 1000, 0.1), alpha);
    if (time - this.lastHudTime >= 50 || events.length) { this.publishHud(); this.lastHudTime = time; }
    this.raf = requestAnimationFrame(this.frame);
  };
  private draw(events: GameEvent[], dt: number, alpha: number): void {
    this.renderer.render(this.previous, this.world, alpha, this.appearance, events, dt, this.debug, this.reducedMotion, this.aimMode,
      { pointer: this.pointer, previousAngle: this.latestAimAngle });
    this.latestAimAngle = this.renderer.getRenderedAimAngle();
  }
  private resetPerformance(): void {
    this.frameSamples = [];
    this.fps = null;
    this.lastPerformanceTime = performance.now();
    this.callbacks.onPerformance?.(null);
  }
  private recordFrame(time: number, elapsed: number): void {
    if (elapsed > 0) this.frameSamples.push({ time, duration: elapsed });
    const windowStart = time - 500;
    this.frameSamples = this.frameSamples.filter(sample => sample.time > windowStart);
    let duration = 0, frames = 0;
    for (const sample of this.frameSamples) {
      const overlap = Math.min(sample.duration, sample.time - windowStart);
      duration += overlap;
      frames += overlap / sample.duration;
    }
    this.fps = duration > 0 ? frames * 1000 / duration : null;
    if (time - this.lastPerformanceTime >= 250) {
      this.callbacks.onPerformance?.(this.fps);
      this.lastPerformanceTime = time;
    }
  }
  private publishHud(): void {
    const p = this.world.player;
    this.callbacks.onHud({ health: p.health, fuel: p.fuel, ammo: p.weapon.ammo,
      reloadProgress: getReloadProgress(p.weapon.reloadTicks, CONFIG.reloadTicks),
      shotsFired: this.world.shotsFired, hits: this.world.hits, kills: this.world.kills, targetHealth: this.world.target.health });
  }
  destroy(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('pointermove', this.pointerMove);
    this.canvas.removeEventListener('mousedown', this.mouseDown);
    window.removeEventListener('mousedown', this.mouseGestureStart, true);
    window.removeEventListener('mouseup', this.mouseUp, true);
    window.removeEventListener('click', this.mouseGestureEnd, true);
    window.removeEventListener('auxclick', this.mouseGestureEnd, true);
    window.removeEventListener('contextmenu', this.mouseGestureMenu, true);
    this.mouseGestures.clear();
    window.removeEventListener('pointercancel', this.pointerCancel);
    this.canvas.removeEventListener('contextmenu', this.contextMenu);
    window.removeEventListener('blur', this.focusLost);
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    document.removeEventListener('pointerlockchange', this.pointerLockChanged);
    this.renderer.destroy();
    this.audio.destroy();
    if (window.__BURNHOP__ === this.diagnostic) delete window.__BURNHOP__;
  }
}
