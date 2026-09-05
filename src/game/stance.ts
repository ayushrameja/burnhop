import type { Vec2 } from './types';

/** The approved artwork is authored from planted feet, then uniformly scaled for gameplay. */
export const STANDING_COLLISION_HEIGHT = 68;
export const CHARACTER_SCALE = STANDING_COLLISION_HEIGHT / 85.94;
export const CROUCH_COLLISION_HEIGHT = 68.5 * CHARACTER_SCALE;
export const CROUCH_TRANSITION_SECONDS = 0.18;

export function clampCrouchAmount(amount: number): number {
  return Number.isNaN(amount) ? 0 : Math.max(0, Math.min(1, amount));
}

/** Artwork-space hip/torso offset shared by the character pose and weapon position. */
export function getStanceBodyOffset(amount: number): Vec2 {
  const crouch = clampCrouchAmount(amount);
  return { x: -2 * crouch, y: -8.94 + (8.5 + 8.94) * crouch };
}

export function getStanceHeight(amount: number): number {
  return STANDING_COLLISION_HEIGHT + (CROUCH_COLLISION_HEIGHT - STANDING_COLLISION_HEIGHT) * clampCrouchAmount(amount);
}

/** World-space offset from the collider's horizontal center and planted feet. */
export function getStanceWeaponOffset(amount: number, facing: -1 | 1): Vec2 {
  const bodyOffset = getStanceBodyOffset(amount);
  return { x: bodyOffset.x * CHARACTER_SCALE * facing, y: (-38 + bodyOffset.y) * CHARACTER_SCALE };
}
