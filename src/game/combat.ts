import { rayRectDistance, raySolidDistance, type CollisionSolid } from './collision';
import type { HitRegion, PlayerState, Rect, Vec2, WeaponId } from './types';
import { MELEE_CONFIG, WEAPONS } from './weapons';

// Rectangle and polygon intersection arithmetic can differ by a few ulps at the
// same surface. Match the collision geometry tolerance so cover wins those ties.
const HIT_TIE_EPSILON = 1e-8;
export function isCloserHit(distance: number, limit: number): boolean { return distance < limit - HIT_TIE_EPSILON; }

export function getHitRegions(rect: Rect): Array<{ region: HitRegion; rect: Rect }> {
  return [
    { region: 'head', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height * .25 } },
    { region: 'body', rect: { x: rect.x, y: rect.y + rect.height * .25, width: rect.width, height: rect.height * .45 } },
    { region: 'legs', rect: { x: rect.x, y: rect.y + rect.height * .7, width: rect.width, height: rect.height * .3 } },
  ];
}
const REGION_PRIORITY: Record<HitRegion, number> = { legs: 0, body: 1, head: 2 };
/** Regions follow the shared stance collider; cosmetics and visual animation cannot change damage. */
export function rayHitRegions(origin: Vec2, direction: Vec2, target: Rect, maxDistance: number): { distance: number; region: HitRegion } | null {
  let closest: { distance: number; region: HitRegion } | null = null;
  for (const { region, rect } of getHitRegions(target)) {
    const distance = rayRectDistance(origin, direction, rect, maxDistance);
    if (distance !== null && (!closest || isCloserHit(distance, closest.distance) ||
      (Math.abs(distance - closest.distance) <= HIT_TIE_EPSILON && REGION_PRIORITY[region] < REGION_PRIORITY[closest.region]))) closest = { distance, region };
  }
  return closest;
}
export function calculateDamage(weaponId: WeaponId, region: HitRegion, distance: number): number {
  const weapon = WEAPONS[weaponId];
  if (distance > weapon.range || distance < 0 || !Number.isFinite(distance)) return 0;
  const falloff = weapon.falloffEnd > weapon.falloffStart
    ? Math.max(0, Math.min(1, (distance - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart))) : 0;
  const multiplier = region === 'head' ? weapon.headMultiplier : region === 'legs' ? weapon.legMultiplier : 1;
  return Math.round(weapon.damage * multiplier * (1 - falloff * (1 - weapon.minimumDamageFactor)));
}

/** A cone intersects the target at visible contact points, never through terrain. */
export function resolveMeleeTarget(origin: Vec2, direction: Vec2, target: Rect, solids: readonly CollisionSolid[]): Vec2 | null {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const angle = Math.atan2(direction.y, direction.x), halfArc = MELEE_CONFIG.halfArcDegrees * Math.PI / 180;
  const points: Vec2[] = [{ x: clamp(origin.x, target.x, target.x + target.width), y: clamp(origin.y, target.y, target.y + target.height) }];
  for (const x of [target.x, target.x + target.width]) for (const y of [target.y, target.y + target.height]) points.push({ x, y });
  for (const offset of [-halfArc, 0, halfArc]) {
    const ray = { x: Math.cos(angle + offset), y: Math.sin(angle + offset) };
    const distance = rayRectDistance(origin, ray, target, MELEE_CONFIG.range);
    if (distance !== null) points.push({ x: origin.x + ray.x * distance, y: origin.y + ray.y * distance });
  }
  let selected: Vec2 | null = null, closest = Infinity;
  for (const point of points) {
    const x = point.x - origin.x, y = point.y - origin.y, distance = Math.hypot(x, y);
    if (distance > MELEE_CONFIG.range || distance >= closest) continue;
    if (distance > 1e-8 && (x * direction.x + y * direction.y) / distance < Math.cos(halfArc) - 1e-10) continue;
    const ray = distance > 1e-8 ? { x: x / distance, y: y / distance } : direction;
    if (solids.some(solid => {
      const contact = raySolidDistance(origin, ray, solid, distance + HIT_TIE_EPSILON);
      return contact !== null && contact <= distance + HIT_TIE_EPSILON;
    })) continue;
    selected = point; closest = distance;
  }
  return selected;
}
export function applyKnockback(player: PlayerState, direction: Vec2): void {
  player.impulseX += (direction.x >= 0 ? 1 : -1) * MELEE_CONFIG.knockbackX;
  player.impulseY -= MELEE_CONFIG.knockbackY;
  player.grounded = false;
}
