import type { DetailedAppearance } from '../game/appearance';
import type { GameEvent, PlayerState, Rect, WeaponState } from '../game/types';

/** Input contains intent only. The transport session supplies actor identity. */
export interface NetworkInput {
  inputId: number;
  moveX: -1 | 0 | 1;
  jumpPressed: boolean;
  jumpHeld: boolean;
  jetPressed: boolean;
  jetHeld: boolean;
  jetSeparate: boolean;
  crouchHeld: boolean;
  fireHeld: boolean;
  reloadPressed: boolean;
  pickupPressed?: boolean;
  pairPressed?: boolean;
  punchPressed?: boolean;
  aimAngle: number;
}

export interface MatchPlayer extends PlayerState {
  connected: boolean;
  ready: boolean;
  joinedOrder: number;
  lifeId: number;
  kills: number;
  deaths: number;
  respawnTicks: number;
  protectionTicks: number;
  nickname: string;
  appearance: DetailedAppearance;
}
export type MatchPhase = 'lobby' | 'countdown' | 'playing' | 'results';
export interface MatchState {
  tick: number;
  phase: MatchPhase;
  hostId: string;
  code: string;
  countdownTicks: number;
  remainingTicks: number;
  players: Record<string, MatchPlayer>;
  winnerIds: string[];
  pickups: Record<string, WeaponPickup>;
  pickupSequence: number;
  pickupSeed: number;
  weaponBag: import('../game/weapons').WeaponId[];
  dropScheduleIndex: number;
  sniperWarningTicks: number;
}
export interface WeaponPickup {
  id: string;
  x: number;
  y: number;
  weapon: WeaponState;
  available: boolean;
  kind: 'pad' | 'dropped' | 'sniper';
  respawnTicks: number;
  expiresTicks: number;
  createdTick: number;
}
export type ActorEvent = GameEvent & {
  id: string;
  actorId: string;
  /** Correlates movement/reload cues as well as shots across prediction and authority. */
  inputId?: number;
  targetId?: string;
  shotId?: string;
  lifeId: number;
  targetLifeId?: number;
  killerId?: string;
};

export interface HistoricalTarget extends Rect {
  lifeId: number;
  health?: number;
  protectionTicks?: number;
}
/** The transport clamps rewind time before this callback. A null sample is not hittable. */
export type TargetHistory = (shooter: MatchPlayer, target: MatchPlayer, input: NetworkInput) => HistoricalTarget | null;

export const MATCH_CONFIG = Object.freeze({
  tickRate: 60, stateRate: 45, interpolationDelayMs: 80, maxRewindMs: 250,
  maxPlayers: 8, minPlayers: 2, countdownTicks: 180, durationTicks: 5 * 60 * 60,
  respawnTicks: 120, protectionTicks: 60, reconnectSeconds: 30, idleLobbySeconds: 600,
});

export function neutralInput(aimAngle = 0, inputId = 0): NetworkInput {
  return { inputId, moveX: 0, jumpPressed: false, jumpHeld: false, jetPressed: false,
    jetHeld: false, jetSeparate: false, crouchHeld: false, fireHeld: false, reloadPressed: false,
    pickupPressed: false, pairPressed: false, punchPressed: false, aimAngle };
}
export { COMPATIBILITY_ID, OUTPOST_ARENA } from './map';
