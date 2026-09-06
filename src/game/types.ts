import type { DetailedAppearance } from './appearance';

export interface Vec2 { x: number; y: number }
export interface Rect extends Vec2 { width: number; height: number }
/** Immutable world geometry, shared by rendering and deterministic collision. */
export interface TerrainPolygon {
  id: string; points: Vec2[]; material: 'rock' | 'bunker' | 'wood'; grass?: boolean;
}
export interface Arena {
  width: number; height: number; floorY: number;
  platforms: Rect[]; playerSpawn: Vec2; targetSpawn: Vec2;
  id?: string; name?: string; theme?: 'range' | 'outpost';
  terrain?: TerrainPolygon[]; spawnPoints?: Array<Vec2 & { id: string }>;
  /** Open maps respawn falling actors instead of adding an invisible floor. */
  openFloor?: boolean;
  /** Pads use horizontal center and grounded surface coordinates. */
  pickupPads?: Array<{ id: string; x: number; y: number; kind: 'ordinary' | 'sniper' }>;
}
export type WeaponId = 'pistol' | 'revolver' | 'ak47' | 'm416' | 'uzi' | 'ump' | 'sniper';
export type WeaponHand = 'main' | 'offhand';
export type HitRegion = 'head' | 'body' | 'legs';
export interface WeaponState {
  weaponId: WeaponId; instanceId: string; ammo: number; reserve: number;
  reloadTicks: number; cooldownTicks: number; shotCounter: number;
  /** Recoil is an angular offset in degrees; bloom is a normalized 0..1 amount. */
  recoil: number; bloom: number; reloadQueued: boolean;
}
export interface PlayerState extends Rect {
  id: string; vx: number; vy: number; grounded: boolean; coyoteTicks: number; jumpBufferTicks: number;
  aimAngle: number; crouchAmount: number; health: number; fuel: number; thrusting: boolean;
  thrustLatched: boolean; fuelDelayTicks: number; weapon: WeaponState; offhand: WeaponState | null;
  equipTicks: number; fireLockTicks: number; fireHeldLast: boolean;
  meleeWindupTicks: number; meleeCooldownTicks: number; meleeAimAngle: number; meleeSequence: number;
  impulseX: number; impulseY: number;
}
export interface TargetState extends Rect { id: string; health: number; respawnTicks: number; hitTicks: number }
export interface WorldState { tick: number; player: PlayerState; target: TargetState; shotsFired: number; hits: number; kills: number }
export interface InputCommand {
  tick: number; actorId: string; moveX: -1 | 0 | 1; jumpPressed: boolean;
  jumpHeld: boolean; aimAngle: number; fireHeld: boolean; reloadPressed: boolean;
  crouchHeld?: boolean;
  pickupPressed?: boolean; pairPressed?: boolean; punchPressed?: boolean;
  /** Omitted commands retain the original combined jump/jetpack behavior. */
  jetpack?: { source: 'combined' | 'separate'; pressed: boolean; held: boolean };
}
export interface ShotEvent {
  type: 'shot'; x: number; y: number; toX: number; toY: number; hit: boolean;
  weaponId: WeaponId; hand: WeaponHand; instanceId: string; shotCounter: number;
  originX: number; originY: number; directionX: number; directionY: number; range: number;
  /** Exact distance along the canonical ray; never reconstruct from rounded endpoints. */
  distance: number;
  surface?: 'rock' | 'bunker' | 'wood' | 'body';
}
export interface MeleeEvent {
  type: 'melee'; x: number; y: number; aimAngle: number; sequence: number; range: number; damage: number;
}
export interface ReloadEvent {
  type: 'reloadStart'; x: number; y: number; weaponId?: WeaponId; hand?: WeaponHand; instanceId?: string;
}
export type GameEvent =
  | ShotEvent
  | { type: 'hit'; x: number; y: number; damage: number; region?: HitRegion; weaponId?: WeaponId; hand?: WeaponHand }
  | MeleeEvent | (Omit<MeleeEvent, 'type'> & { type: 'meleeStart' })
  | { type: 'dryfire'; x: number; y: number; weaponId: WeaponId; hand: WeaponHand; instanceId: string }
  | ReloadEvent | (Omit<ReloadEvent, 'type'> & { type: 'reloadEnd' })
  | { type: 'pickup'; x: number; y: number; weaponId: WeaponId; hand: WeaponHand; instanceId: string }
  | { type: 'sniperWarning' | 'sniperDrop'; x: number; y: number }
  | { type: 'targetDeath'; x: number; y: number;
    deathPose?: { x: number; y: number; width: number; height: number; aimAngle: number; crouchAmount: number; vx: number; vy: number; appearance: DetailedAppearance };
    impactDirection?: Vec2; cosmeticSeed?: number }
  | { type: 'targetRespawn' | 'jump' | 'land'; x: number; y: number };
export interface HudState {
  health: number; fuel: number; ammo: number; reloadProgress: number;
  shotsFired: number; hits: number; kills: number; targetHealth: number;
  weaponId?: WeaponId; magazineSize?: number; reserve?: number;
  offhand?: { weaponId: WeaponId; ammo: number; magazineSize: number; reloadProgress: number; reserve: number } | null;
  pickupPrompt?: string; sniperWarning?: string;
  damageSequence?: number; killSequence?: number;
}
