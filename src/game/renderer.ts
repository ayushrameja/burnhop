import {
  calculateCharacterPose,
  type CharacterPose,
} from './character';
import { drawDetailedCharacter } from './detailedCharacter';
import { BOT_APPEARANCE, type DetailedAppearance } from './appearance';
import { getAimDash, resolveWeaponAim, type AimMode } from './aim';
import { CAMERA_VIEWPORT, DEFAULT_ZOOM_LEVEL, ZOOM_SCALES, followCamera, getCameraTarget, type ZoomLevel } from './camera';
import { OUTPOST_PALETTE as NIGHT } from './palette';
import { CONFIG, getWeaponOrigin, compileArena } from './simulation';
import { CHARACTER_SCALE } from './stance';
import { getReloadProgress } from './reload';
import { OutpostScenery } from './outpostRenderer';
import { defaultGraphics, normalizeGraphics, type GraphicsSettings } from './graphics';
import { CharacterParts } from './characterParts';
import { DeathFragments } from './deathFragments';
import { drawWeaponArtwork } from './weaponArtwork';
import { MELEE_CONFIG, WEAPONS } from './weapons';
import { getHitRegions } from './combat';
import type { GameAssets } from './assets';
import type {
  GameEvent,
  PlayerState,
  Rect,
  Vec2,
  WorldState,
  WeaponId,
} from './types';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
};
type Tracer = {
  x: number;
  y: number;
  toX: number;
  toY: number;
  life: number;
  hit: boolean;
};
type FloatLabel = {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
};
export interface AimReticle {
  mode: AimMode;
  pivot: Vec2;
  start: Vec2;
  end: Vec2;
}
export interface LiveAimInput {
  pointer: Vec2;
  previousAngle: number;
}
export interface OnlineRenderActor {
  player: PlayerState;
  appearance: DetailedAppearance;
  nickname: string;
  connected: boolean;
  protected: boolean;
  lifeId: number;
}
export interface CombatPresentation {
  pickups:ReadonlyArray<{id:string;weaponId:WeaponId;x:number;y:number;available:boolean;label?:string}>;
  sniperDrop?:{x:number;y:number;seconds:number}|null;
  showHitRegions?:boolean;
  highlightedPickupId?:string;
}
export type PresentationEvent = GameEvent & { id?:string;actorId?: string; targetId?: string;killerId?:string;lifeId?:number };
type ActorAnimation = { phase: number; direction: number; walk: number; air: number; thrust: number; recoil: number;offhandRecoil:number; hit: number; lifeId: number };
type RenderedActorPose = { lifeId: number; pose: Readonly<CharacterPose> };
const MAX_RENDERED_POSES = 16;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const seed = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
function polygon(
  ctx: CanvasRenderingContext2D,
  points: number[],
  color: string,
) {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2)
    ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function line(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color: string,
  width = 1,
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

function compactEffects<T extends { life: number }>(items: T[], dt: number): void {
  let write = 0;
  for (const item of items) if ((item.life -= dt) > 0) items[write++] = item;
  items.length = write;
}

/** Canvas-only presentation. Coordinates and effects never feed back into simulation. */
export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 1280;
  private height = 720;
  private viewportScale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;
  private zoomLevel: ZoomLevel = DEFAULT_ZOOM_LEVEL;
  private zoom = ZOOM_SCALES[DEFAULT_ZOOM_LEVEL];
  private cameraAnchor: Vec2;
  public camera: Vec2 = { x: 0, y: 0 };
  private pointer: Vec2 | null = null;
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private labels: FloatLabel[] = [];
  private recoil = 0;
  private offhandRecoil=0;
  private hitConfirm = 0;
  private localHit = 0;
  private fragments=new DeathFragments();
  private deathEvents=new Set<string>();
  private time = 0;
  private phase = 0;
  private lastMoveDirection = 1;
  private walkAmount = 0;
  private airborneAmount = 0;
  private thrustAmount = 0;
  private reticle: AimReticle | null = null;
  private renderedAimAngle = 0;
  private frameMs = 16.7;
  private frameCount = 0;
  private initialized = false;
  private outpost: OutpostScenery | null = null;
  private graphics = defaultGraphics();
  private characterParts = new CharacterParts();
  private bounds = { left: 0, top: 0 };
  private exhaustTime = 0;
  private drawnActors = 0;
  private culledActors = 0;
  private presentActors = new Set<string>();
  private actorAnimations = new Map<string, ActorAnimation>();
  private actorPoses = new Map<string, RenderedActorPose>();
  constructor(
    private canvas: HTMLCanvasElement,
    private assets: GameAssets,
  ) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is unavailable in this browser.');
    this.ctx = context;
    if (assets.arena.theme === 'outpost') this.outpost = new OutpostScenery(assets.arena);
    this.outpost?.setDetail(this.graphics.scenery);
    this.resize();
    this.cameraAnchor = {
      x: assets.arena.playerSpawn.x + CONFIG.bodyWidth / 2,
      y: assets.arena.playerSpawn.y + CONFIG.bodyHeight / 2,
    };
    this.camera = getCameraTarget(this.cameraAnchor, assets.arena, this.zoom);
  }
  setGraphics(value: GraphicsSettings): void {
    const next = normalizeGraphics(value);
    const resized = next.renderScale !== this.graphics.renderScale;
    this.graphics = next; this.outpost?.setDetail(next.scenery);
    if (resized) this.resize();
  }
  getPerformanceDiagnostics() {
    return { graphics: { ...this.graphics }, canvas: { width: this.canvas.width, height: this.canvas.height },
      devicePixelRatio: window.devicePixelRatio || 1, zoom: this.zoomLevel,
      drawnActors: this.drawnActors, culledActors: this.culledActors, particles: this.particles.length,
      deathFragments:this.fragments.count,
      characterCacheBytes: this.characterParts.cacheBytes, terrain: this.outpost?.getDiagnostics() ?? null };
  }
  prewarmSpawn(point: Vec2): void {
    if (!this.outpost) return;
    const camera = getCameraTarget({ x: point.x + CONFIG.bodyWidth / 2, y: point.y + CONFIG.bodyHeight / 2 }, this.assets.arena, this.zoom);
    const scale = this.dpr * this.viewportScale * this.zoom;
    this.ctx.save();
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.outpost.warm(this.ctx, camera, { x: 1280 / this.zoom, y: 720 / this.zoom });
    this.ctx.restore();
  }
  setZoom(level: ZoomLevel): void {
    if (level === this.zoomLevel) return;
    this.zoomLevel = level;
    this.zoom = ZOOM_SCALES[level];
    // Input can project points before another frame: update both transforms together.
    this.camera = getCameraTarget(this.cameraAnchor, this.assets.arena, this.zoom);
  }
  getCameraDiagnostics() {
    return {
      zoomLevel: this.zoomLevel,
      scale: this.zoom,
      position: { ...this.camera },
      viewport: {
        width: CAMERA_VIEWPORT.width / this.zoom,
        height: CAMERA_VIEWPORT.height / this.zoom,
      },
    };
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.bounds = { left: rect.left, top: rect.top };
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2) * this.graphics.renderScale;
    const width = Math.max(1, Math.round(this.width * this.dpr)), height = Math.max(1, Math.round(this.height * this.dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.viewportScale = Math.min(this.width / 1280, this.height / 720);
    this.offsetX = (this.width - 1280 * this.viewportScale) / 2;
    this.offsetY = (this.height - 720 * this.viewportScale) / 2;
  }
  setPointer(clientX: number, clientY: number) {
    this.pointer = { x: clientX, y: clientY };
  }
  getAimDiagnostics(): AimReticle | null {
    return this.reticle
      ? {
          ...this.reticle,
          pivot: { ...this.reticle.pivot },
          start: { ...this.reticle.start },
          end: { ...this.reticle.end },
        }
      : null;
  }
  getRenderedAimAngle(): number {
    return this.renderedAimAngle;
  }
  getPointerBounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const rect = this.bounds;
    return {
      left: rect.left + this.offsetX,
      top: rect.top + this.offsetY,
      right: rect.left + this.offsetX + 1280 * this.viewportScale,
      bottom: rect.top + this.offsetY + 720 * this.viewportScale,
    };
  }
  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.bounds;
    return {
      x:
        (clientX - rect.left - this.offsetX) / this.viewportScale / this.zoom +
        this.camera.x,
      y:
        (clientY - rect.top - this.offsetY) / this.viewportScale / this.zoom +
        this.camera.y,
    };
  }
  worldToScreen(x: number, y: number): Vec2 {
    const rect = this.bounds;
    return {
      x:
        (x - this.camera.x) * this.zoom * this.viewportScale +
        this.offsetX +
        rect.left,
      y:
        (y - this.camera.y) * this.zoom * this.viewportScale +
        this.offsetY +
        rect.top,
    };
  }
  destroy() {
    this.outpost?.destroy();
    this.characterParts.destroy();
    this.particles = [];
    this.tracers = [];
    this.labels = [];
    this.reticle = null;
    this.actorAnimations.clear();
    this.actorPoses.clear();
    this.fragments.clear();this.deathEvents.clear();
  }
  resetOnlinePresentation(preserveDebris=false): void {
    this.initialized = false; this.recoil = 0; this.hitConfirm = 0; this.localHit = 0; this.phase = 0;
    this.walkAmount = 0; this.airborneAmount = 0; this.thrustAmount = 0;
    this.particles = []; this.tracers = []; this.labels = []; this.reticle = null; this.exhaustTime = 0;
    this.offhandRecoil=0;
    if(!preserveDebris){
      this.fragments.clear();this.deathEvents.clear();
      this.actorAnimations.clear();this.actorPoses.clear();
    }
  }
  renderOnline(actors: OnlineRenderActor[], localId: string, tick: number, events: PresentationEvent[], dt: number,
    reducedMotion = false, aimMode: AimMode = 'radial', liveAim?: LiveAimInput,combat?:CombatPresentation): void {
    const local = actors.find(actor => actor.player.id === localId) ?? actors[0];
    if (!local) {
      this.actorAnimations.clear();
      this.actorPoses.clear();
      return;
    }
    const world: WorldState = { tick, player: local.player, target: { id: '', x: 0, y: 0, width: 0, height: 0, health: 0, respawnTicks: 0, hitTicks: 0 },
      shotsFired: 0, hits: 0, kills: 0 };
    this.render(world, world, 1, local.appearance, events, dt, false, reducedMotion, aimMode, liveAim, actors,combat);
  }
  render(
    previous: WorldState,
    current: WorldState,
    alpha: number,
    appearance: DetailedAppearance,
    events: PresentationEvent[],
    dt: number,
    debug = false,
    reducedMotion = false,
    aimMode: AimMode = 'radial',
    liveAim?: LiveAimInput,
    onlineActors?: OnlineRenderActor[],
    combat?:CombatPresentation,
  ) {
    const ctx = this.ctx;
    const player = current.player;
    const arena = this.assets.arena;
    const elapsed=dt;
    dt = clamp(dt, 0, 0.06);
    this.time += dt;
    this.frameMs = mix(this.frameMs, dt * 1000, 0.04);
    this.frameCount++;
    const px = mix(previous.player.x, player.x, alpha);
    const feetY = mix(previous.player.y + previous.player.height, player.y + player.height, alpha);
    const height = mix(previous.player.height, player.height, alpha);
    const py = feetY - height;
    const crouchAmount = mix(previous.player.crouchAmount, player.crouchAmount, alpha);
    const displayedPlayer = { ...player, x: px, y: py, height, crouchAmount };
    this.cameraAnchor = { x: px + player.width / 2, y: feetY - CONFIG.bodyHeight / 2 };
    this.camera = this.initialized
      ? followCamera(this.camera, this.cameraAnchor, arena, this.zoom, dt)
      : getCameraTarget(this.cameraAnchor, arena, this.zoom);
    const desiredWalk =
      player.grounded && Math.abs(player.vx) > 8
        ? clamp(Math.abs(player.vx) / CONFIG.moveSpeed, 0, 1)
        : 0;
    if (!this.initialized) {
      this.initialized = true;
      this.walkAmount = desiredWalk;
      this.airborneAmount = player.grounded ? 0 : 1;
      this.thrustAmount = player.thrusting ? 1 : 0;
    }
    // Mouse direction uses this frame's camera and displayed position, even between simulation ticks.
    const { angle: aimAngle, pivot } = liveAim
      ? resolveWeaponAim(liveAim.pointer, displayedPlayer,
          point => this.worldToScreen(point.x, point.y), liveAim.previousAngle, aimMode)
      : { angle: player.aimAngle, pivot: getWeaponOrigin(displayedPlayer) };
    this.renderedAimAngle = aimAngle;
    this.recoil = Math.max(0, this.recoil - dt * 16);
    this.offhandRecoil=Math.max(0,this.offhandRecoil-dt*16);
    this.hitConfirm = Math.max(0, this.hitConfirm - dt);
    this.localHit = Math.max(0, this.localHit - dt);
    if (player.grounded) this.phase += Math.abs(player.vx) * dt * 0.045;
    if (player.vx !== 0) this.lastMoveDirection = Math.sign(player.vx);
    this.walkAmount = mix(this.walkAmount, desiredWalk, 1 - Math.exp(-dt * 14));
    this.airborneAmount = mix(
      this.airborneAmount,
      player.grounded ? 0 : 1,
      1 - Math.exp(-dt * 16),
    );
    this.thrustAmount = mix(
      this.thrustAmount,
      player.thrusting ? 1 : 0,
      1 - Math.exp(-dt * 18),
    );
    const pose: CharacterPose = {
      aimAngle,
      crouchAmount,
      locomotion: true,
      walkPhase: this.phase,
      moveSpeed: player.vx || this.lastMoveDirection,
      verticalSpeed: player.vy,
      walkAmount: this.walkAmount,
      airborneAmount: this.airborneAmount,
      thrustAmount: this.thrustAmount,
      moving: Math.abs(player.vx) > 8,
      airborne: !player.grounded,
      thrusting: player.thrusting,
      recoil: this.recoil,
      weaponId:player.weapon.weaponId,
      offhandWeaponId:player.offhand?.weaponId,
      offhandRecoil:this.offhandRecoil,
      reloadProgress: getReloadProgress(player.weapon.reloadTicks, WEAPONS[player.weapon.weaponId].reloadTicks),
      offhandReloadProgress:player.offhand?getReloadProgress(player.offhand.reloadTicks,WEAPONS[player.offhand.weaponId].reloadTicks):-1,
      meleeProgress:player.meleeWindupTicks>0?1-player.meleeWindupTicks/MELEE_CONFIG.windupTicks:undefined,
      time: this.time,
      reducedMotion,
    };
    for (const event of events) {
      const localEvent = !onlineActors || event.actorId === player.id;
      this.event(event, reducedMotion, localEvent);
      if (event.type === 'shot' && !localEvent && event.actorId) {
        const animation = this.actorAnimations.get(event.actorId);
        if (animation) {if(event.hand==='offhand')animation.offhandRecoil=1;else animation.recoil = 1;}
      }
      if (event.type === 'hit' && event.targetId) {
        if (event.targetId === player.id) this.localHit = 0.12;
        const animation = this.actorAnimations.get(event.targetId);
        if (animation) animation.hit = 0.12;
      }
      if(event.type==='targetDeath'){
        const deathKey=event.id??`${current.tick}:${event.actorId??'target'}:${event.lifeId??0}`;
        if(!this.deathEvents.has(deathKey)){
          this.deathEvents.add(deathKey);if(this.deathEvents.size>128)this.deathEvents.delete(this.deathEvents.values().next().value!);
          const victim=onlineActors?.find(actor=>actor.player.id===event.actorId);
          const body=victim?.player??(!onlineActors?current.target:player);
          const cached = event.actorId ? this.actorPoses.get(event.actorId) : undefined;
          const renderedPose = cached && event.lifeId !== undefined && cached.lifeId === event.lifeId ? cached.pose : undefined;
          this.fragments.spawn(event.deathPose??{...body,aimAngle:victim?.player.aimAngle??Math.PI,crouchAmount:victim?.player.crouchAmount??0,
            vx:victim?.player.vx??0,vy:victim?.player.vy??0,appearance:victim?.appearance??BOT_APPEARANCE},
            event.impactDirection??{x:Math.cos(player.aimAngle),y:Math.sin(player.aimAngle)},event.cosmeticSeed??current.tick,
            this.graphics.effects,reducedMotion,renderedPose);
        }
      }
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 230 * dt;
    }
    compactEffects(this.particles, 0);
    compactEffects(this.tracers, dt);
    compactEffects(this.labels, dt);
    this.fragments.update(elapsed,compileArena(arena).solids,arena.height);
    // Character and exhaust share one pose, including transitions and left-facing mirrors.
    pose.recoil = this.recoil;
    pose.offhandRecoil=this.offhandRecoil;
    if (onlineActors) pose.hit = this.localHit > 0;
    const exhaustRate = this.graphics.effects === 'low' ? 0 : this.graphics.effects === 'medium' ? 15 : 30;
    this.exhaustTime = player.thrusting && !reducedMotion ? this.exhaustTime + dt * exhaustRate : 0;
    const exhaustBursts = Math.min(3, Math.floor(this.exhaustTime + 1e-7));
    this.exhaustTime -= exhaustBursts;
    if (exhaustBursts > 0) {
      const geometry = calculateCharacterPose(pose);
      for (let burst = 0; burst < exhaustBursts; burst++) {
        const facing = Math.cos(aimAngle) >= 0 ? 1 : -1;
        geometry.nozzles.forEach((nozzle, index) =>
          this.particle(
            px + player.width / 2 + nozzle.x * facing * CHARACTER_SCALE,
            feetY + nozzle.y * CHARACTER_SCALE,
            player.vx * 0.15 + (seed(this.frameCount + index) - 0.5) * 24,
            75,
            0.25,
            3,
            '#e2bd82',
          ),
        );
      }
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = NIGHT.letterbox;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.viewportScale, this.viewportScale);
    ctx.beginPath();
    ctx.rect(0, 0, 1280, 720);
    ctx.clip();
    if (this.outpost) this.outpost.background(ctx, this.camera);
    else this.background();
    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
    if (this.outpost) this.outpost.draw(ctx, this.camera, { x: 1280 / this.zoom, y: 720 / this.zoom });
    else {
      this.environment();
      for (const platform of arena.platforms) this.platform(platform);
      this.ground();
      this.rangeProps(current);
    }
    if(combat)this.drawPickups(combat,reducedMotion);
    this.fragments.draw(ctx,this.camera,{x:1280/this.zoom,y:720/this.zoom},this.characterParts);
    // Contact shadows stay on the ground and disappear naturally as the pilot climbs.
    const shadowY = this.outpost ? feetY : arena.floorY;
    const groundDistance = this.outpost && !player.grounded ? 1000 : Math.max(0, shadowY - py - player.height);
    ctx.fillStyle = `rgba(41,55,34,${Math.max(0.02, 0.18 - groundDistance * 0.0004)})`;
    ctx.beginPath();
    ctx.ellipse(
      px + 18,
      shadowY + 3,
      Math.max(7, 22 - groundDistance * 0.025),
      4,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    if (!onlineActors && current.target.health > 0) {
      const t = current.target;
      ctx.fillStyle = '#37463533';
      ctx.beginPath();
      ctx.ellipse(
        t.x + t.width / 2,
        t.y + t.height + 2,
        23,
        5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      drawDetailedCharacter(
        ctx,
        t.x + t.width / 2,
        t.y + t.height,
        CHARACTER_SCALE,
        { aimAngle: Math.PI, crouchAmount: 0, target: true, hit: t.hitTicks > 0 },
        BOT_APPEARANCE,
        this.assets.images,
        this.characterParts,
      );
      this.targetHealth(t.x + t.width / 2, t.y - 30, t.health);
    } else if (!onlineActors) {
      const t = current.target;
      ctx.save();
      ctx.setLineDash([5, 5]);
      line(
        ctx,
        t.x + t.width / 2,
        t.y + 16,
        t.x + t.width / 2,
        t.y + 58,
        '#d9c9a1',
        2,
      );
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = this.outpost ? '#334536' : NIGHT.text;
      ctx.fillText(
        `RESET ${(t.respawnTicks / 60).toFixed(1)}s`,
        t.x + t.width / 2,
        t.y - 7,
      );
    }
    if (onlineActors) {
      this.drawnActors = player.health > 0 ? 1 : 0; this.culledActors = 0;
      this.presentActors.clear();
      for (const actor of onlineActors) this.presentActors.add(actor.player.id);
      for (const id of this.actorAnimations.keys()) if (!this.presentActors.has(id)) this.actorAnimations.delete(id);
      for (const id of this.actorPoses.keys()) if (!this.presentActors.has(id)) this.actorPoses.delete(id);
      for (const actor of onlineActors) if (actor.player.id !== player.id) this.drawOnlineActor(actor, dt, reducedMotion);
    }
    if (!onlineActors || player.health > 0) {
      drawDetailedCharacter(ctx, px + player.width / 2, feetY, CHARACTER_SCALE, pose,
        appearance, this.assets.images, this.characterParts);
      const local = onlineActors?.find(actor => actor.player.id === player.id);
      if (local) this.rememberActorPose(player.id, local.lifeId, pose);
    }
    if (onlineActors && player.health > 0) {
      const local = onlineActors.find(actor => actor.player.id === player.id);
      if (local) this.actorLabel(local, px + player.width / 2, py - 12, true);
    }
    this.effects();
    this.reticle = null;
    if (aimMode === 'radial' && (!onlineActors || player.health > 0)) {
      const dash = getAimDash(pivot, aimAngle);
      this.reticle = { mode: aimMode, pivot, ...dash };
      ctx.save();
      ctx.shadowColor = '#2e4635';
      ctx.shadowBlur = this.graphics.effects === 'high' ? 2 : 0;
      line(
        ctx,
        dash.start.x,
        dash.start.y,
        dash.end.x,
        dash.end.y,
        this.hitConfirm > 0 ? '#f4d28c' : '#eff0ce',
        2,
      );
      ctx.restore();
    }
    if(debug||combat?.showHitRegions){
      const bodies=onlineActors?onlineActors.filter(actor=>actor.player.health>0).map(actor=>actor.player):[displayedPlayer,current.target];
      for(const body of bodies)for(const {region,rect} of getHitRegions(body)){
        ctx.fillStyle=region==='head'?'#f1b76633':region==='body'?'#70cad333':'#ad99dd33';
        ctx.strokeStyle=region==='head'?'#e9b45f':region==='body'?'#53b8c5':'#a38fd0';ctx.lineWidth=.8;
        ctx.fillRect(rect.x,rect.y,rect.width,rect.height);ctx.strokeRect(rect.x,rect.y,rect.width,rect.height);
      }
    }
    if (debug) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#a92931';
      ctx.strokeRect(player.x, player.y, player.width, player.height);
      ctx.strokeRect(
        current.target.x,
        current.target.y,
        current.target.width,
        current.target.height,
      );
      ctx.strokeStyle = '#46789b';
      for (const p of arena.platforms)
        ctx.strokeRect(p.x, p.y, p.width, p.height);
      for (const terrain of arena.terrain ?? []) {
        ctx.beginPath(); ctx.moveTo(terrain.points[0].x, terrain.points[0].y);
        for (const p of terrain.points.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.closePath(); ctx.stroke();
      }
      line(
        ctx,
        pivot.x,
        pivot.y,
        pivot.x + Math.cos(aimAngle) * WEAPONS[player.weapon.weaponId].muzzleLength,
        pivot.y + Math.sin(aimAngle) * WEAPONS[player.weapon.weaponId].muzzleLength,
        '#a92931',
        1.5,
      );
    }
    ctx.restore();
    if (aimMode === 'pointer' && (!onlineActors || player.health > 0)) this.crosshair(pivot);
    // Very subtle night vignette grounds the scene without obscuring play.
    if (this.graphics.effects !== 'low') {
      const edge = ctx.createLinearGradient(0, 0, 0, 720);
      edge.addColorStop(0, '#040c111a');
      edge.addColorStop(0.16, '#040c1100');
      edge.addColorStop(0.86, '#040c1100');
      edge.addColorStop(1, '#040c1124');
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, 1280, 720);
    }
    if (debug) {
      rounded(ctx, 20, 180, 250, 115, 5, '#182c28e8');
      ctx.fillStyle = '#d8e0bb';
      ctx.textAlign = 'left';
      ctx.font = '12px monospace';
      const rows = [
        `SIM ${current.tick} · ${(1000 / Math.max(1, this.frameMs)).toFixed(0)} FPS / ${this.frameMs.toFixed(1)} ms`,
        `POS ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`,
        `VEL ${player.vx.toFixed(1)}, ${player.vy.toFixed(1)}`,
        `FUEL ${player.fuel.toFixed(1)}% · ${player.grounded ? 'GROUND' : 'AIR'}`,
        `FX ${this.particles.length} · COLLISION DEBUG`,
      ];
      rows.forEach((row, i) => ctx.fillText(row, 33, 202 + i * 19));
    }
    ctx.restore();
  }
  private drawPickups(combat:CombatPresentation,reducedMotion:boolean):void{
    const ctx=this.ctx;
    for(const pickup of combat.pickups){
      if(pickup.x<this.camera.x-70||pickup.x>this.camera.x+1280/this.zoom+70||pickup.y<this.camera.y-70||pickup.y>this.camera.y+720/this.zoom+70)continue;
      const highlighted=pickup.id===combat.highlightedPickupId;
      ctx.save();ctx.translate(pickup.x,pickup.y);
      ctx.strokeStyle=pickup.weaponId==='sniper'?'#f0c26a':highlighted?'#c5fff0':'#83bfc0';ctx.lineWidth=highlighted?2:1;
      ctx.globalAlpha=pickup.available?1:.3;ctx.fillStyle=pickup.available?'#263d3dcc':'#263d3d44';
      ctx.beginPath();ctx.ellipse(0,18,27,5,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      if(pickup.label){
        ctx.font='600 10px "Courier New", monospace';ctx.textAlign='center';
        const text=pickup.label.toUpperCase(),width=ctx.measureText(text).width+8;
        ctx.fillStyle='#172d2ee6';ctx.fillRect(-width/2,-47,width,15);
        ctx.fillStyle=highlighted?'#d2fff2':'#e3ece2';ctx.fillText(text,0,-36);
      }
      if(pickup.available){
        const bob=reducedMotion?0:Math.sin(this.time*2.5+pickup.x*.03)*2;
        ctx.translate(-5,-3+bob);ctx.scale(1.2,1.2);drawWeaponArtwork(ctx,pickup.weaponId);
        if(highlighted){ctx.strokeStyle='#d2fff2';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-27,-14);ctx.lineTo(-27,-20);ctx.lineTo(-21,-20);ctx.moveTo(43,-14);ctx.lineTo(43,-20);ctx.lineTo(37,-20);ctx.stroke();}
      }
      ctx.restore();
    }
    if(combat.sniperDrop){
      const drop=combat.sniperDrop,progress=clamp(drop.seconds/5,0,1),height=reducedMotion?45:45+progress*390;
      ctx.save();ctx.translate(drop.x,drop.y);ctx.strokeStyle='#e7c17899';ctx.lineWidth=1;ctx.setLineDash([4,6]);
      ctx.beginPath();ctx.moveTo(0,-height+18);ctx.lineTo(0,18);ctx.stroke();ctx.setLineDash([]);
      ctx.strokeStyle='#f0cb82';ctx.fillStyle='#f0cb8222';ctx.beginPath();ctx.ellipse(0,18,35,8,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.translate(0,-height);ctx.strokeStyle='#32473f';ctx.fillStyle='#ddc497';ctx.lineWidth=1.4;
      ctx.beginPath();ctx.moveTo(-30,-22);ctx.quadraticCurveTo(0,-63,30,-22);ctx.lineTo(15,-20);ctx.lineTo(0,-24);ctx.lineTo(-15,-20);ctx.closePath();ctx.fill();ctx.stroke();
      for(const x of [-27,0,27]){ctx.beginPath();ctx.moveTo(x,-22);ctx.lineTo(x*.28,0);ctx.stroke();}
      rounded(ctx,-15,-2,30,24,3,'#718777');ctx.strokeRect(-15,-2,30,24);
      ctx.fillStyle='#e3c185';ctx.fillRect(-2,-2,4,24);ctx.fillRect(-15,8,30,4);
      ctx.restore();
    }
  }
  private drawOnlineActor(actor: OnlineRenderActor, dt: number, reducedMotion: boolean): void {
    const p = actor.player;
    let animation = this.actorAnimations.get(p.id);
    if (!animation || animation.lifeId !== actor.lifeId) {
      if (animation?.lifeId !== actor.lifeId) this.actorPoses.delete(p.id);
      animation = { phase: 0, direction: 1, walk: 0, air: p.grounded ? 0 : 1, thrust: 0, recoil: 0,offhandRecoil:0, hit: 0, lifeId: actor.lifeId };
      this.actorAnimations.set(p.id, animation);
    }
    if (p.health <= 0) return;
    const desiredWalk = p.grounded ? clamp(Math.abs(p.vx) / CONFIG.moveSpeed, 0, 1) : 0;
    if (p.grounded) animation.phase += Math.abs(p.vx) * dt * 0.045;
    if (p.vx) animation.direction = Math.sign(p.vx);
    animation.walk = mix(animation.walk, desiredWalk, 1 - Math.exp(-dt * 14));
    animation.air = mix(animation.air, p.grounded ? 0 : 1, 1 - Math.exp(-dt * 16));
    animation.thrust = mix(animation.thrust, p.thrusting ? 1 : 0, 1 - Math.exp(-dt * 18));
    animation.recoil = Math.max(0, animation.recoil - dt * 16);
    animation.offhandRecoil=Math.max(0,animation.offhandRecoil-dt*16);
    animation.hit = Math.max(0, animation.hit - dt);
    // Preserve animation clocks offscreen; skip pose solving, vector paths and labels.
    if (p.x + p.width + 192 < this.camera.x || p.x - 192 > this.camera.x + 1280 / this.zoom
      || p.y + p.height + 64 < this.camera.y || p.y - 192 > this.camera.y + 720 / this.zoom) {
      this.culledActors++; return;
    }
    this.drawnActors++;
    const pose: CharacterPose = { aimAngle: p.aimAngle, crouchAmount: p.crouchAmount, locomotion: true,
      walkPhase: animation.phase, moveSpeed: p.vx || animation.direction, verticalSpeed: p.vy,
      walkAmount: animation.walk, airborneAmount: animation.air, thrustAmount: animation.thrust,
      moving: Math.abs(p.vx) > 8, airborne: !p.grounded, thrusting: p.thrusting, recoil: animation.recoil,
      weaponId:p.weapon.weaponId,offhandWeaponId:p.offhand?.weaponId,offhandRecoil:animation.offhandRecoil,
      reloadProgress: getReloadProgress(p.weapon.reloadTicks, WEAPONS[p.weapon.weaponId].reloadTicks),
      offhandReloadProgress:p.offhand?getReloadProgress(p.offhand.reloadTicks,WEAPONS[p.offhand.weaponId].reloadTicks):-1,
      meleeProgress:p.meleeWindupTicks>0?1-p.meleeWindupTicks/MELEE_CONFIG.windupTicks:undefined,
      time: this.time, reducedMotion, hit: animation.hit > 0 };
    const ctx = this.ctx;
    ctx.save(); ctx.globalAlpha = actor.connected ? 1 : 0.55;
    drawDetailedCharacter(ctx, p.x + p.width / 2, p.y + p.height, CHARACTER_SCALE, pose, actor.appearance, this.assets.images, this.characterParts);
    this.rememberActorPose(p.id, actor.lifeId, pose);
    this.actorLabel(actor, p.x + p.width / 2, p.y - 12, false);
    ctx.restore();
  }
  private rememberActorPose(actorId: string, lifeId: number, pose: CharacterPose): void {
    this.actorPoses.set(actorId, { lifeId, pose: Object.freeze({ ...pose }) });
    if (this.actorPoses.size > MAX_RENDERED_POSES) {
      this.actorPoses.delete(this.actorPoses.keys().next().value!);
    }
  }
  private actorLabel(actor: OnlineRenderActor, x: number, y: number, local: boolean): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center'; ctx.font = 'bold 10px sans-serif'; ctx.lineWidth = 3;
    ctx.strokeStyle = '#243c32'; ctx.fillStyle = local ? '#ffe4a1' : '#edf2db';
    const name = `${actor.nickname}${actor.connected ? '' : ' · reconnecting'}`;
    ctx.strokeText(name, x, y); ctx.fillText(name, x, y);
    if (actor.protected) {
      ctx.strokeStyle = '#e8e09dcc'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.strokeRect(actor.player.x - 4, actor.player.y - 4, actor.player.width + 8, actor.player.height + 8);
      ctx.setLineDash([]);
    }
  }
  private background() {
    const ctx = this.ctx;
    const camera = this.camera;
    const sky = ctx.createLinearGradient(0, 0, 0, 720);
    sky.addColorStop(0, NIGHT.skyTop);
    sky.addColorStop(0.45, NIGHT.skyMiddle);
    sky.addColorStop(1, NIGHT.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1280, 720);
    const moonX = 940 - camera.x * 0.1;
    const moonY = 165 - camera.y * 0.04;
    ctx.fillStyle = NIGHT.moon;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = NIGHT.moonHalo;
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 73, 0, Math.PI * 2);
    ctx.stroke();
    // Clouds are long soft bands, kept quieter than the solid playable surfaces.
    ctx.fillStyle = NIGHT.cloud;
    for (let i = 0; i < 8; i++) {
      const x = ((i * 227 + 47 - camera.x * 0.12) % 1550) - 130;
      const y = 90 + seed(i + 9) * 180 - camera.y * 0.04;
      rounded(
        ctx,
        x,
        y,
        90 + seed(i) * 130,
        5 + seed(i + 3) * 8,
        10,
        NIGHT.cloud,
      );
    }
    const farShift = camera.x * 0.15;
    polygon(
      ctx,
      [
        -200 - farShift,
        470,
        -80 - farShift,
        353,
        80 - farShift,
        377,
        212 - farShift,
        214,
        355 - farShift,
        353,
        472 - farShift,
        276,
        643 - farShift,
        432,
        790 - farShift,
        277,
        923 - farShift,
        345,
        1120 - farShift,
        215,
        1310 - farShift,
        357,
        1550 - farShift,
        260,
        1600,
        720,
        -200,
        720,
      ],
      NIGHT.farRidge,
    );
    polygon(
      ctx,
      [
        212 - farShift,
        214,
        252 - farShift,
        305,
        355 - farShift,
        353,
        291 - farShift,
        328,
      ],
      NIGHT.farFacet,
    );
    polygon(
      ctx,
      [
        1120 - farShift,
        215,
        1173 - farShift,
        314,
        1310 - farShift,
        357,
        1224 - farShift,
        331,
      ],
      NIGHT.farFacet,
    );
    const middle = camera.x * 0.3;
    polygon(
      ctx,
      [
        -300 - middle,
        545,
        -80 - middle,
        421,
        115 - middle,
        477,
        302 - middle,
        354,
        510 - middle,
        492,
        655 - middle,
        400,
        847 - middle,
        488,
        1030 - middle,
        358,
        1245 - middle,
        508,
        1440 - middle,
        421,
        1810 - middle,
        532,
        1800,
        720,
        -300,
        720,
      ],
      NIGHT.middleRidge,
    );
    polygon(
      ctx,
      [
        302 - middle,
        354,
        361 - middle,
        428,
        510 - middle,
        492,
        422 - middle,
        477,
      ],
      NIGHT.middleFacet,
    );
    polygon(
      ctx,
      [
        1030 - middle,
        358,
        1080 - middle,
        414,
        1245 - middle,
        508,
        1150 - middle,
        479,
      ],
      NIGHT.middleFacet,
    );
    const horizon = 470 + (660 - camera.y) * 0.14;
    ctx.fillStyle = NIGHT.haze;
    ctx.fillRect(0, horizon - 25, 1280, 150);
    const near = camera.x * 0.55;
    polygon(
      ctx,
      [
        -300 - near,
        horizon + 220,
        -100 - near,
        horizon + 34,
        90 - near,
        horizon + 77,
        285 - near,
        horizon + 6,
        414 - near,
        horizon + 79,
        600 - near,
        horizon + 12,
        810 - near,
        horizon + 95,
        940 - near,
        horizon + 2,
        1200 - near,
        horizon + 63,
        1450 - near,
        horizon + 6,
        1700 - near,
        horizon + 54,
        1800,
        800,
        -300,
        800,
      ],
      NIGHT.nearRidge,
    );
    // Faint radio mast on the opposite ridge.
    const mastX = 1020 - camera.x * 0.38;
    const mastY = 420 + (660 - camera.y) * 0.12;
    line(ctx, mastX, mastY, mastX + 10, mastY - 157, '#6a907b14', 2);
    line(ctx, mastX + 20, mastY, mastX + 10, mastY - 157, '#6a907b55', 2);
    line(ctx, mastX + 2, mastY - 15, mastX + 18, mastY - 65, '#6a907b55', 1);
    line(ctx, mastX + 18, mastY - 15, mastX + 5, mastY - 89, '#6a907b55', 1);
    line(ctx, mastX - 15, mastY - 117, mastX + 36, mastY - 117, '#6a907b55', 2);
    line(ctx, mastX + 10, mastY - 147, mastX + 10, mastY - 179, '#85a58d', 1);
    for (let i = 0; i < 19; i++) {
      const x = i * 114 - camera.x * 0.49 - 110;
      const y = horizon + 111 + Math.sin(i * 1.7) * 20;
      this.pine(x, y, 20 + seed(i + 22) * 45, '#182b2477');
    }
    // Fine airborne flecks supply depth without animated visual noise.
    ctx.fillStyle = '#e9e0bf66';
    for (let i = 0; i < 25; i++) {
      const x = seed(i + 120) * 1280;
      const y = seed(i + 91) * 590;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
  private pine(x: number, y: number, h: number, color: string) {
    const ctx = this.ctx;
    line(ctx, x, y, x, y - h, color, 3);
    polygon(
      ctx,
      [
        x,
        y - h,
        x - h * 0.26,
        y - h * 0.4,
        x - h * 0.09,
        y - h * 0.45,
        x - h * 0.35,
        y - h * 0.14,
        x + h * 0.35,
        y - h * 0.14,
        x + h * 0.09,
        y - h * 0.45,
        x + h * 0.26,
        y - h * 0.4,
      ],
      color,
    );
  }
  private environment() {
    const ctx = this.ctx;
    const floor = this.assets.arena.floorY;
    // Sparse tall conifers and a distant service fence establish the training outpost.
    this.pine(42, floor, 246, NIGHT.tree);
    this.pine(83, floor, 176, NIGHT.treeLight);
    this.pine(1523, floor, 214, NIGHT.treeLight);
    this.pine(1600, floor, 288, NIGHT.tree);
    this.pine(2202, floor, 340, NIGHT.tree);
    this.pine(2297, floor, 248, NIGHT.treeLight);
    for (let i = 0; i < 21; i++) {
      const x = i * 125;
      line(ctx, x, floor - 18, x, floor - 75, '#586d4566', 3);
    }
    line(ctx, 0, floor - 60, 2400, floor - 60, '#78815c66', 2);
    line(ctx, 0, floor - 31, 2400, floor - 31, '#78815c66', 2);
    // Rocky retaining columns behind platforms read as scenery, never as solid collision.
    for (let i = 0; i < this.assets.arena.platforms.length; i++) {
      const p = this.assets.arena.platforms[i];
      const bottom = Math.min(floor, p.y + p.height + 230);
      const sx = p.x + p.width * 0.7;
      polygon(
        ctx,
        [
          sx - 9,
          p.y + p.height,
          sx + 17,
          p.y + p.height,
          sx + 21,
          bottom,
          sx - 13,
          bottom,
        ],
        '#3c59422b',
      );
      line(ctx, sx - 5, p.y + p.height + 10, sx + 8, bottom, '#172c2044', 3);
    }
    // Slack cables and hanging field insignia are atmospheric rather than interactive.
    ctx.strokeStyle = '#58664d66';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 867);
    ctx.quadraticCurveTo(210, 1015, 465, 890);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const x = 70 + i * 54;
      const y = 895 + Math.sin(i * 0.43) * 44;
      polygon(
        ctx,
        [x, y, x + 17, y + 2, x + 7, y + 24],
        i % 2 ? '#c1a06588' : '#75805799',
      );
    }
  }
  private platform(p: Rect) {
    const ctx = this.ctx;
    const x = p.x,
      y = p.y,
      w = p.width,
      h = p.height;
    // A bright continuous cap and dark underside make every collidable edge unambiguous.
    ctx.fillStyle = '#050e0944';
    ctx.fillRect(x + 7, y + h + 5, w - 14, 7);
    polygon(
      ctx,
      [
        x,
        y + 8,
        x + w,
        y + 8,
        x + w - 6,
        y + h - 7,
        x + w - 31,
        y + h + 3,
        x + 24,
        y + h,
        x,
        y + h - 10,
      ],
      NIGHT.rockShadow,
    );
    polygon(
      ctx,
      [
        x + 5,
        y + 15,
        x + w - 4,
        y + 15,
        x + w - 13,
        y + h - 8,
        x + 23,
        y + h - 5,
      ],
      NIGHT.rock,
    );
    polygon(
      ctx,
      [x + 21, y + 19, x + 75, y + 14, x + 105, y + h - 3, x + 44, y + h - 1],
      '#404b36',
    );
    polygon(
      ctx,
      [
        x + w - 114,
        y + 15,
        x + w - 53,
        y + 14,
        x + w - 18,
        y + h - 9,
        x + w - 80,
        y + h - 2,
      ],
      NIGHT.rockFacet,
    );
    ctx.fillStyle = '#293e2a';
    ctx.fillRect(x, y, w, 9);
    ctx.fillStyle = NIGHT.landingEdge;
    ctx.fillRect(x + 2, y, w - 4, 4);
    ctx.fillStyle = NIGHT.landingHighlight;
    ctx.fillRect(x + 6, y, w - 12, 1);
    ctx.fillStyle = '#a6ad72';
    ctx.fillRect(x + 10, y + 10, 30, 5);
    ctx.fillRect(x + w - 41, y + 10, 30, 5);
    for (let i = 0; i < Math.floor(w / 54); i++) {
      const xx = x + 28 + i * 54;
      line(ctx, xx, y + 20, xx + 11, y + 27, '#625f4477', 1);
      ctx.fillStyle = '#e1c98c55';
      ctx.fillRect(xx + 13, y + 15, 11, 2);
    }
    // Small tufts soften the top while preserving its straight landing surface.
    for (let i = 0; i < 4; i++) {
      const gx = x + 50 + (i * (w - 80)) / 4;
      line(ctx, gx, y, gx - 3, y - 5, '#87955e', 1);
      line(ctx, gx, y, gx + 4, y - 7, '#9daa72', 1);
    }
    ctx.fillStyle = '#c2cb9699';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      'O7 / ' +
        String(this.assets.arena.platforms.indexOf(p) + 1).padStart(2, '0'),
      x + 50,
      y + 27,
    );
  }
  private ground() {
    const ctx = this.ctx;
    const floor = this.assets.arena.floorY;
    ctx.fillStyle = NIGHT.ground;
    ctx.fillRect(0, floor, 2400, 300);
    polygon(
      ctx,
      [
        0,
        floor + 26,
        150,
        floor + 49,
        390,
        floor + 21,
        560,
        floor + 38,
        820,
        floor + 18,
        1040,
        floor + 58,
        1320,
        floor + 29,
        1520,
        floor + 50,
        1810,
        floor + 21,
        2060,
        floor + 55,
        2400,
        floor + 30,
        2400,
        floor + 300,
        0,
        floor + 300,
      ],
      NIGHT.groundShadow,
    );
    ctx.fillStyle = '#536642';
    ctx.fillRect(0, floor, 2400, 11);
    ctx.fillStyle = NIGHT.landingEdge;
    ctx.fillRect(0, floor, 2400, 3);
    ctx.fillStyle = '#4a5a3988';
    ctx.fillRect(0, floor + 10, 2400, 3);
    for (let i = 0; i < 140; i++) {
      const x = seed(i + 51) * 2400,
        y = floor + 18 + seed(i + 125) * 132,
        w = 3 + seed(i + 96) * 18;
      polygon(
        ctx,
        [
          x,
          y,
          x + w * 0.4,
          y - 4,
          x + w,
          y - 1,
          x + w * 0.7,
          y + 3,
          x + 2,
          y + 4,
        ],
        i % 3 === 0 ? '#929e6455' : '#111e1255',
      );
    }
    for (let i = 0; i < 85; i++) {
      const x = i * 29 + seed(i + 4) * 13;
      line(ctx, x, floor, x - 2, floor - 3 - seed(i + 21) * 5, '#839050', 1.5);
      line(ctx, x, floor, x + 4, floor - 2 - seed(i + 31) * 7, '#8d9e64', 1);
    }
    // The range's painted firing lanes are world-space marks, not UI.
    ctx.fillStyle = '#dfcd9677';
    ctx.fillRect(374, floor + 4, 72, 4);
    ctx.fillRect(878, floor + 4, 96, 4);
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#cec19199';
    ctx.fillText('FIRING LINE', 410, floor + 30);
    ctx.fillText('TARGET 01', 929, floor + 30);
  }
  private rangeProps(world: WorldState) {
    const ctx = this.ctx;
    const floor = this.assets.arena.floorY;
    // A field manual board and range number establish the opening view.
    line(ctx, 170, floor, 170, floor - 148, '#687957', 7);
    line(ctx, 285, floor, 285, floor - 148, '#687957', 7);
    rounded(ctx, 147, floor - 144, 164, 65, 3, '#172c21');
    rounded(ctx, 152, floor - 139, 154, 55, 1, '#364b30');
    const badge = this.assets.images.insignia;
    if (badge) ctx.drawImage(badge, 185, floor - 216, 47, 52);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e3d2a1';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('LIVE-FIRE RANGE', 166, floor - 115);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#c6c493';
    ctx.fillText('KEEP YOUR BOOTS LIGHT.', 166, floor - 97);
    for (const x of [157, 301])
      for (const y of [floor - 135, floor - 88]) {
        ctx.fillStyle = '#b1aa75';
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    // Hanging target banner sits behind the target, with no false collidable geometry.
    const tx = world.target.x + world.target.width / 2;
    line(ctx, tx + 64, floor, tx + 64, floor - 168, '#697854', 4);
    line(ctx, tx + 23, floor - 165, tx + 67, floor - 165, '#697854', 3);
    const banner = this.assets.images['range-banner'];
    if (banner) ctx.drawImage(banner, tx + 25, floor - 161, 37, 44);
    // Ground pads and a stack of transport cases are decorative.
    rounded(ctx, tx - 46, floor - 4, 91, 4, 1, '#525f41');
    ctx.fillStyle = '#d1ad65';
    ctx.fillRect(tx - 44, floor - 4, 14, 3);
    ctx.fillRect(tx + 29, floor - 4, 14, 3);
    this.crate(1458, floor - 37, 53, 37);
    this.crate(1514, floor - 30, 44, 30);
    this.crate(1472, floor - 65, 34, 28);
    // Distant wind sock helps sell the place as an air-combat training ground.
    line(ctx, 2000, floor, 2000, 800, '#58664b', 5);
    ctx.save();
    ctx.translate(2000, 805);
    ctx.rotate(Math.sin(this.time * 0.8) * 0.035);
    polygon(ctx, [0, -8, 98, 10, 91, 29, 0, 13], '#d5a15f');
    polygon(ctx, [27, -3, 48, 1, 48, 21, 27, 17], '#e9d6ac');
    polygon(ctx, [67, 4, 86, 8, 82, 26, 65, 24], '#e9d6ac');
    ctx.restore();
  }
  private crate(x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    rounded(ctx, x, y, w, h, 2, '#586746');
    ctx.strokeStyle = '#303f31';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#8e9364';
    ctx.fillRect(x + 3, y + 3, w - 6, 3);
    ctx.fillStyle = '#404f36';
    ctx.fillRect(x + 5, y + 8, 5, h - 10);
    ctx.fillRect(x + w - 10, y + 8, 5, h - 10);
    ctx.fillStyle = '#b7b180';
    ctx.fillRect(x + w / 2 - 5, y + h / 2 - 3, 10, 6);
  }
  private targetHealth(x: number, y: number, health: number) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = this.outpost ? '#334536' : NIGHT.text;
    ctx.fillText('TRAINING BOT', x, y - 10);
    rounded(ctx, x - 29, y - 3, 58, 7, 3, '#314c38');
    rounded(
      ctx,
      x - 27,
      y - 1,
      (54 * health) / 100,
      3,
      1,
      health > 40 ? '#d8b173' : '#cd8059',
    );
    ctx.fillStyle = this.outpost ? '#4a5c42' : NIGHT.mutedText;
    ctx.font = '8px monospace';
    ctx.fillText(`${health} / 100`, x, y + 16);
  }
  private particle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: string,
  ) {
    if (this.particles.length < (this.graphics.effects === 'low' ? 36 : this.graphics.effects === 'medium' ? 90 : 180))
      this.particles.push({ x, y, vx, vy, life, max: life, size, color });
  }
  private event(event: PresentationEvent, reducedMotion: boolean, local = true) {
    const count = reducedMotion || this.graphics.effects === 'low' ? 2 : this.graphics.effects === 'medium' ? 4 : 8;
    if (event.type === 'shot') {
      if(this.tracers.length>=128)this.tracers.shift();
      this.tracers.push({ ...event, life: 0.075 });
      if (local) {if(event.hand==='offhand')this.offhandRecoil=1;else this.recoil = 1;}
      for (let i = 0; i < 3; i++)
        this.particle(
          event.toX,
          event.toY,
          (seed(this.time + i) - 0.5) * 140,
          -25 - seed(i + this.time) * 95,
          0.14 + i * 0.04,
          2,
          event.hit ? '#dca36a' : '#d9c58a',
        );
    }
    if (event.type === 'hit') {
      if (local) this.hitConfirm = 0.16;
      this.labels.push({
        x: event.x,
        y: event.y - 32,
        text: `−${event.damage}`,
        life: 0.65,
        color: this.outpost ? '#763c27' : '#f7e3b3',
      });
      for (let i = 0; i < count; i++)
        this.particle(
          event.x,
          event.y,
          (seed(this.time + i + 3) - 0.5) * 170,
          -30 - seed(i + this.time + 8) * 120,
          0.3 + i * 0.025,
          2 + (i % 2),
          '#eac58b',
        );
    }
    if(event.type==='melee'){
      for(let i=0;i<count;i++)this.particle(event.x+Math.cos(event.aimAngle)*event.range,event.y+Math.sin(event.aimAngle)*event.range,
        Math.cos(event.aimAngle)*80+(i-2)*15,Math.sin(event.aimAngle)*70-30,.12+i*.025,2,'#e9d9aa');
    }
    if (event.type === 'targetDeath') {
      this.labels.push({
        x: event.x,
        y: event.y - 42,
        text: event.actorId ? 'ELIMINATED' : 'TARGET DOWN',
        life: 1.1,
        color: '#f5e6bd',
      });
      for (let i = 0; i < Math.min(3,count); i++)
        this.particle(
          event.x,
          event.y,
          (seed(this.time + i + 21) - 0.5) * 190,
          -40 - seed(i + this.time + 4) * 160,
          0.5 + i * 0.018,
          3 + (i % 4),
          i % 2 ? '#b79966' : '#657550',
        );
    }
    if (event.type === 'land' || event.type === 'jump')
      for (let i = 0; i < count; i++)
        this.particle(
          event.x,
          event.y,
          (seed(i + this.time) - 0.5) * 130,
          -10 - seed(i + this.time + 12) * 45,
          0.2 + i * 0.03,
          3,
          '#cbbb87',
        );
    if (event.type === 'targetRespawn')
      for (let i = 0; i < count; i++)
        this.particle(
          event.x,
          event.y,
          (seed(i + this.time) - 0.5) * 70,
          -seed(i + this.time + 12) * 65,
          0.5,
          3,
          '#d9d3a2',
        );
    if(this.labels.length>48)this.labels.splice(0,this.labels.length-48);
  }
  private effects() {
    const ctx = this.ctx;
    for (const tracer of this.tracers) {
      ctx.globalAlpha = clamp(tracer.life / 0.075, 0, 1);
      line(ctx, tracer.x, tracer.y, tracer.toX, tracer.toY, '#e3b96377', 4);
      line(ctx, tracer.x, tracer.y, tracer.toX, tracer.toY, '#fff0bf', 1.3);
      ctx.fillStyle = '#fff1bd';
      ctx.beginPath();
      ctx.arc(tracer.toX, tracer.toY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.8;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const label of this.labels) {
      ctx.globalAlpha = Math.min(1, label.life * 3);
      ctx.textAlign = 'center';
      ctx.font =
        label.text === 'TARGET DOWN'
          ? 'bold 11px monospace'
          : 'bold 15px monospace';
      ctx.strokeStyle = '#394c38';
      ctx.lineWidth = 3;
      ctx.strokeText(label.text, label.x, label.y - (1 - label.life) * 20);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y - (1 - label.life) * 20);
    }
    ctx.globalAlpha = 1;
  }
  private crosshair(pivot: Vec2) {
    if (!this.pointer) return;
    const rect = this.bounds;
    const x = (this.pointer.x - rect.left - this.offsetX) / this.viewportScale,
      y = (this.pointer.y - rect.top - this.offsetY) / this.viewportScale;
    if (x < 0 || x > 1280 || y < 0 || y > 720) return;
    const point = this.screenToWorld(this.pointer.x, this.pointer.y);
    this.reticle = { mode: 'pointer', pivot, start: point, end: { ...point } };
    const ctx = this.ctx;
    ctx.strokeStyle = this.hitConfirm > 0 ? '#f4d28c' : '#eff0ce';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#2e4635';
    ctx.shadowBlur = this.graphics.effects === 'high' ? 2 : 0;
    for (const sign of [-1, 1]) {
      line(
        ctx,
        x + sign * 6,
        y,
        x + sign * 12,
        y,
        this.hitConfirm > 0 ? '#f4d28c' : '#eff0ce',
        2,
      );
      line(
        ctx,
        x,
        y + sign * 6,
        x,
        y + sign * 12,
        this.hitConfirm > 0 ? '#f4d28c' : '#eff0ce',
        2,
      );
    }
    ctx.fillStyle = '#e8efcb';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.shadowBlur = 0;
    if (this.hitConfirm > 0) {
      for (const a of [
        Math.PI * 0.25,
        Math.PI * 0.75,
        Math.PI * 1.25,
        Math.PI * 1.75,
      ])
        line(
          ctx,
          x + Math.cos(a) * 8,
          y + Math.sin(a) * 8,
          x + Math.cos(a) * 14,
          y + Math.sin(a) * 14,
          '#eac586',
          2,
        );
    }
  }
}

export { GameRenderer as Renderer };
