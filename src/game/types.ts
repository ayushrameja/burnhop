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
}
export interface WeaponState { ammo: number; reloadTicks: number; cooldownTicks: number }
export interface PlayerState extends Rect {
  id: string; vx: number; vy: number; grounded: boolean; coyoteTicks: number; jumpBufferTicks: number;
  aimAngle: number; crouchAmount: number; health: number; fuel: number; thrusting: boolean;
  thrustLatched: boolean; fuelDelayTicks: number; weapon: WeaponState;
}
export interface TargetState extends Rect { id: string; health: number; respawnTicks: number; hitTicks: number }
export interface WorldState { tick: number; player: PlayerState; target: TargetState; shotsFired: number; hits: number; kills: number }
export interface InputCommand {
  tick: number; actorId: string; moveX: -1 | 0 | 1; jumpPressed: boolean;
  jumpHeld: boolean; aimAngle: number; fireHeld: boolean; reloadPressed: boolean;
  crouchHeld?: boolean;
  /** Omitted commands retain the original combined jump/jetpack behavior. */
  jetpack?: { source: 'combined' | 'separate'; pressed: boolean; held: boolean };
}
export type GameEvent =
  | { type: 'shot'; x: number; y: number; toX: number; toY: number; hit: boolean }
  | { type: 'hit'; x: number; y: number; damage: number }
  | { type: 'targetDeath' | 'targetRespawn' | 'reloadStart' | 'reloadEnd' | 'jump' | 'land'; x: number; y: number };
export interface GameAssets { arena: Arena; images: Record<string, HTMLImageElement> }
export interface HudState {
  health: number; fuel: number; ammo: number; reloadProgress: number;
  shotsFired: number; hits: number; kills: number; targetHealth: number;
}
