import { CONFIG, getWeaponOrigin } from './simulation';
import type { PlayerState, Vec2 } from './types';

export type AimMode = 'radial' | 'pointer';
export const AIM_DASH_DISTANCE = CONFIG.bodyHeight * 2.2;
export const AIM_DASH_LENGTH = 56;
export interface PointerBounds { left: number; top: number; right: number; bottom: number }

/** Pointer-lock deltas remain in CSS pixels, including letterboxed or resized viewports. */
export function clampAimPointer(pointer: Vec2, bounds: PointerBounds): Vec2 {
  return {
    x: Math.max(bounds.left, Math.min(bounds.right, Number.isFinite(pointer.x) ? pointer.x : (bounds.left + bounds.right) / 2)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, Number.isFinite(pointer.y) ? pointer.y : (bounds.top + bounds.bottom) / 2)),
  };
}

export function moveAimPointer(pointer: Vec2, movement: Vec2, bounds: PointerBounds): Vec2 {
  return clampAimPointer({
    x: pointer.x + (Number.isFinite(movement.x) ? movement.x : 0),
    y: pointer.y + (Number.isFinite(movement.y) ? movement.y : 0),
  }, bounds);
}

/** The dead zone uses CSS pixels so aim remains predictable at any zoom or display density. */
export function resolveAimAngle(pointerScreen: Vec2, originScreen: Vec2, previousAngle: number, mode: AimMode): number {
  const dx = pointerScreen.x - originScreen.x;
  const dy = pointerScreen.y - originScreen.y;
  const retainedAngle = Number.isFinite(previousAngle) ? previousAngle : 0;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return retainedAngle;
  if (mode === 'radial' && Math.hypot(dx, dy) <= 6) return retainedAngle;
  return Math.atan2(dy, dx);
}

/** Resolve again after a facing change because the crouched grip shifts slightly sideways. */
export function resolveWeaponAim(
  pointer: Vec2, player: PlayerState, project: (point: Vec2) => Vec2,
  previousAngle: number, mode: AimMode,
): { angle: number; pivot: Vec2 } {
  let angle = Number.isFinite(previousAngle) ? previousAngle : 0;
  let pivot = getWeaponOrigin({ ...player, aimAngle: angle });
  for (let pass = 0; pass < 2; pass++) {
    const nextAngle = resolveAimAngle(pointer, project(pivot), angle, mode);
    const changedFacing = (Math.cos(nextAngle) >= 0) !== (Math.cos(angle) >= 0);
    angle = nextAngle;
    pivot = getWeaponOrigin({ ...player, aimAngle: angle });
    if (!changedFacing) break;
  }
  return { angle, pivot };
}

/** Radial aim stays at a fixed distance from the weapon pivot, independent of the mouse radius. */
export function getAimDash(origin: Vec2, angle: number): { start: Vec2; end: Vec2 } {
  const x = Math.cos(angle), y = Math.sin(angle);
  return {
    start: { x: origin.x + x * AIM_DASH_DISTANCE, y: origin.y + y * AIM_DASH_DISTANCE },
    end: { x: origin.x + x * (AIM_DASH_DISTANCE + AIM_DASH_LENGTH), y: origin.y + y * (AIM_DASH_DISTANCE + AIM_DASH_LENGTH) },
  };
}
