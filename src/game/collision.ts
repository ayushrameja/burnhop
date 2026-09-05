import type { Rect, TerrainPolygon, Vec2 } from './types';

const EPSILON = 1e-8;
interface Collision { time: number; normal: Vec2 }
export type CollisionSolid = Rect | TerrainPolygon;
export interface ConvexPolygon {
  readonly points: readonly Vec2[];
  readonly axes: readonly Vec2[];
  readonly bounds: Rect;
}

const terrainCache = new WeakMap<TerrainPolygon, readonly ConvexPolygon[]>();
const rectangleCache = new WeakMap<Rect, readonly ConvexPolygon[]>();
const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const isTerrain = (solid: CollisionSolid): solid is TerrainPolygon => 'points' in solid;

function makeConvex(points: readonly Vec2[]): ConvexPolygon {
  const axes: Vec2[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= EPSILON) continue;
    const normal = { x: (a.y - b.y) / length, y: (b.x - a.x) / length };
    if (!axes.some(axis => Math.abs(dot(axis, normal)) > 1 - EPSILON)) axes.push(normal);
  }
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { points, axes, bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y } };
}

/** Deterministic ear clipping. Terrain objects are immutable after arena loading. */
export function compileTerrain(terrain: TerrainPolygon): readonly ConvexPolygon[] {
  const cached = terrainCache.get(terrain);
  if (cached) return cached;
  const points = terrain.points.map(point => ({ ...point }));
  for (let i = points.length - 1; i >= 0 && points.length > 2; i--) {
    const previous = points[(i + points.length - 1) % points.length];
    const current = points[i], next = points[(i + 1) % points.length];
    if (Math.abs(cross(previous, current, next)) < EPSILON) points.splice(i, 1);
  }
  const area = points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (points.length < 3 || Math.abs(area) < EPSILON) throw new Error(`Invalid terrain polygon: ${terrain.id}`);
  if (area < 0) points.reverse();
  const convex = points.every((point, i) => cross(point, points[(i + 1) % points.length], points[(i + 2) % points.length]) >= -EPSILON);
  if (convex) {
    const result = [makeConvex(points)];
    terrainCache.set(terrain, result);
    return result;
  }
  const indices = points.map((_, i) => i), result: ConvexPolygon[] = [];
  while (indices.length > 3) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const previous = indices[(i + indices.length - 1) % indices.length];
      const current = indices[i], next = indices[(i + 1) % indices.length];
      const a = points[previous], b = points[current], c = points[next];
      if (cross(a, b, c) <= EPSILON) continue;
      if (indices.some(index => index !== previous && index !== current && index !== next
        && cross(a, b, points[index]) >= -EPSILON && cross(b, c, points[index]) >= -EPSILON
        && cross(c, a, points[index]) >= -EPSILON)) continue;
      result.push(makeConvex([a, b, c]));
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error(`Terrain polygon must be simple: ${terrain.id}`);
  }
  result.push(makeConvex(indices.map(index => points[index])));
  terrainCache.set(terrain, result);
  return result;
}

function compileSolid(solid: CollisionSolid): readonly ConvexPolygon[] {
  if (isTerrain(solid)) return compileTerrain(solid);
  const cached = rectangleCache.get(solid);
  if (cached) return cached;
  const { x, y, width, height } = solid;
  const result = [makeConvex([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }])];
  rectangleCache.set(solid, result);
  return result;
}

function projections(body: Rect, polygon: ConvexPolygon, axis: Vec2) {
  const center = dot({ x: body.x + body.width / 2, y: body.y + body.height / 2 }, axis);
  const radius = Math.abs(axis.x) * body.width / 2 + Math.abs(axis.y) * body.height / 2;
  let low = Infinity, high = -Infinity;
  for (const point of polygon.points) {
    const distance = dot(point, axis);
    low = Math.min(low, distance); high = Math.max(high, distance);
  }
  return { bodyLow: center - radius, bodyHigh: center + radius, low, high };
}

/** Strict interior overlap; touching a floor is a valid spawn/stance. */
export function rectOverlapsSolid(body: Rect, solid: CollisionSolid): boolean {
  if (!isTerrain(solid)) return body.x + body.width > solid.x + EPSILON && body.x < solid.x + solid.width - EPSILON
    && body.y + body.height > solid.y + EPSILON && body.y < solid.y + solid.height - EPSILON;
  return compileTerrain(solid).some(polygon => polygon.axes.every(axis => {
    const { bodyLow, bodyHigh, low, high } = projections(body, polygon, axis);
    return bodyHigh > low + EPSILON && bodyLow < high - EPSILON;
  }));
}

/** Continuous separating-axis sweep against one convex piece of terrain. */
function sweepConvex(body: Rect, movement: Vec2, polygon: ConvexPolygon): Collision | null {
  let entry = -Infinity, exit = Infinity;
  let normal: Vec2 = { x: 0, y: 0 };
  for (const axis of polygon.axes) {
    const { bodyLow, bodyHigh, low, high } = projections(body, polygon, axis);
    const speed = dot(movement, axis);
    if (Math.abs(speed) < EPSILON) {
      if (bodyHigh <= low + EPSILON || bodyLow >= high - EPSILON) return null;
      continue;
    }
    const a = (low - bodyHigh) / speed, b = (high - bodyLow) / speed;
    const axisEntry = Math.min(a, b), axisExit = Math.max(a, b);
    const axisNormal = speed > 0 ? { x: -axis.x, y: -axis.y } : { ...axis };
    // A slope endpoint shares its entry time with the AABB x axis. Prefer the
    // upward face there, otherwise the beginning of an incline becomes a wall.
    if (axisEntry > entry + EPSILON || (Math.abs(axisEntry - entry) <= EPSILON && axisNormal.y < normal.y)) {
      entry = axisEntry;
      normal = axisNormal;
    }
    exit = Math.min(exit, axisExit);
    if (entry > exit + EPSILON) return null;
  }
  // A zero-duration corner graze never enters the solid. Rejecting it also
  // avoids treating shared triangulation vertices as little invisible walls.
  if (entry < -EPSILON || entry > 1 || exit < 0 || entry >= exit - EPSILON) return null;
  return { time: Math.max(0, entry), normal };
}

function firstCollision(body: Rect, movement: Vec2, solids: readonly CollisionSolid[]): Collision | null {
  let first: Collision | null = null;
  const left = Math.min(body.x, body.x + movement.x), top = Math.min(body.y, body.y + movement.y);
  const right = Math.max(body.x, body.x + movement.x) + body.width;
  const bottom = Math.max(body.y, body.y + movement.y) + body.height;
  for (const solid of solids) for (const polygon of compileSolid(solid)) {
    const bounds = polygon.bounds;
    if (right < bounds.x - EPSILON || left > bounds.x + bounds.width + EPSILON
      || bottom < bounds.y - EPSILON || top > bounds.y + bounds.height + EPSILON) continue;
    const collision = sweepConvex(body, movement, polygon);
    if (collision && (!first || collision.time < first.time - EPSILON
      || (Math.abs(collision.time - first.time) <= EPSILON && collision.normal.y < first.normal.y))) first = collision;
  }
  return first;
}

/** Sweep a rectangle across an entire tick, including high-speed diagonal motion. */
function sweep(body: Rect, movement: Vec2, wall: Rect): Collision | null {
  let xEntry: number, xExit: number, yEntry: number, yExit: number;
  if (movement.x === 0) {
    if (body.x + body.width <= wall.x + EPSILON || body.x >= wall.x + wall.width - EPSILON) return null;
    xEntry = -Infinity; xExit = Infinity;
  } else {
    const a = (wall.x - body.x - body.width) / movement.x;
    const b = (wall.x + wall.width - body.x) / movement.x;
    xEntry = Math.min(a, b); xExit = Math.max(a, b);
  }
  if (movement.y === 0) {
    if (body.y + body.height <= wall.y + EPSILON || body.y >= wall.y + wall.height - EPSILON) return null;
    yEntry = -Infinity; yExit = Infinity;
  } else {
    const a = (wall.y - body.y - body.height) / movement.y;
    const b = (wall.y + wall.height - body.y) / movement.y;
    yEntry = Math.min(a, b); yExit = Math.max(a, b);
  }
  const entry = Math.max(xEntry, yEntry), exit = Math.min(xExit, yExit);
  if (entry > exit || exit < 0 || entry < -EPSILON || entry > 1) return null;
  return {
    time: Math.max(0, entry),
    normal: xEntry > yEntry
      ? { x: movement.x > 0 ? -1 : 1, y: 0 }
      : { x: 0, y: movement.y > 0 ? -1 : 1 },
  };
}

/** Mutates position, preserving movement tangent to the first surface hit. */
function moveAmongRectangles(body: Rect, movement: Vec2, solids: readonly Rect[]) {
  let remaining = { ...movement };
  let hitX = false, hitY = false, grounded = false;
  for (let iteration = 0; iteration < 4; iteration++) {
    if (Math.abs(remaining.x) + Math.abs(remaining.y) < EPSILON) break;
    let first: Collision | null = null;
    for (const solid of solids) {
      const collision = sweep(body, remaining, solid);
      if (collision && (!first || collision.time < first.time)) first = collision;
    }
    if (!first) {
      body.x += remaining.x; body.y += remaining.y;
      break;
    }
    body.x += remaining.x * first.time;
    body.y += remaining.y * first.time;
    remaining.x *= 1 - first.time;
    remaining.y *= 1 - first.time;
    if (first.normal.x) { remaining.x = 0; hitX = true; }
    if (first.normal.y) {
      remaining.y = 0; hitY = true;
      if (first.normal.y === -1) grounded = true;
    }
  }
  // A floor encountered at the start of a sweep may no longer be beneath the
  // actor after its remaining horizontal movement carries it over an edge.
  grounded = grounded && solids.some(solid =>
    Math.abs(body.y + body.height - solid.y) < EPSILON
    && body.x + body.width > solid.x + EPSILON
    && body.x < solid.x + solid.width - EPSILON,
  );
  return { hitX, hitY, grounded };
}

const WALKABLE_NORMAL_Y = -0.55;

/** Swept AABB movement with terrain slopes; the original range retains its exact path. */
export function moveAndCollide(body: Rect, movement: Vec2, solids: readonly CollisionSolid[], options: { grounded?: boolean } = {}) {
  if (!solids.some(isTerrain)) return moveAmongRectangles(body, movement, solids as readonly Rect[]);
  let remaining = { ...movement };
  let hitX = false, hitY = false, touchedGround = false;
  for (let iteration = 0; iteration < 10; iteration++) {
    if (Math.abs(remaining.x) + Math.abs(remaining.y) < EPSILON) break;
    const first = firstCollision(body, remaining, solids);
    if (!first) {
      body.x += remaining.x; body.y += remaining.y;
      break;
    }
    body.x += remaining.x * first.time; body.y += remaining.y * first.time;
    remaining.x *= 1 - first.time; remaining.y *= 1 - first.time;
    const normal = first.normal;
    if (normal.y <= WALKABLE_NORMAL_Y) {
      // Walking keeps the commanded horizontal speed. Gravity does not push an
      // idle actor sideways down a hill, and climbing does not cancel vx.
      remaining.y = -normal.x * remaining.x / normal.y;
      hitY = true; touchedGround = true;
    } else {
      const intoSurface = dot(remaining, normal);
      remaining.x -= normal.x * intoSurface;
      remaining.y -= normal.y * intoSurface;
      if (Math.abs(normal.x) > EPSILON) hitX = true;
      if (Math.abs(normal.y) > EPSILON) hitY = true;
    }
  }
  // Follow descending slopes and the transition from a slope onto a flat top.
  // The probe runs only from established ground with downward intended motion,
  // so jumps and jetpack takeoff never get pulled back onto terrain.
  const snapDistance = options.grounded && movement.y >= 0 ? Math.abs(movement.x) * 1.52 + 0.5 : 1e-5;
  const support = (touchedGround || (options.grounded && movement.y >= 0))
    ? firstCollision(body, { x: 0, y: snapDistance }, solids) : null;
  const grounded = !!support && support.normal.y <= WALKABLE_NORMAL_Y;
  if (grounded) {
    body.y += snapDistance * support.time;
    hitY = true;
  }
  return { hitX, hitY, grounded };
}

/** Distance to the first point of intersection, including an origin inside cover. */
export function rayRectDistance(origin: Vec2, direction: Vec2, rect: Rect, maxDistance: number): number | null {
  let near = 0, far = maxDistance;
  for (const axis of ['x', 'y'] as const) {
    const extent = axis === 'x' ? rect.width : rect.height;
    if (Math.abs(direction[axis]) < EPSILON) {
      if (origin[axis] < rect[axis] || origin[axis] > rect[axis] + extent) return null;
    } else {
      const a = (rect[axis] - origin[axis]) / direction[axis];
      const b = (rect[axis] + extent - origin[axis]) / direction[axis];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return null;
    }
  }
  return near;
}

/** Rays use the same convex pieces as body movement and stance clearance. */
export function raySolidDistance(origin: Vec2, direction: Vec2, solid: CollisionSolid, maxDistance: number): number | null {
  if (!isTerrain(solid)) return rayRectDistance(origin, direction, solid, maxDistance);
  let nearest: number | null = null;
  for (const polygon of compileTerrain(solid)) {
    let near = 0, far = nearest ?? maxDistance;
    for (let i = 0; i < polygon.points.length; i++) {
      const a = polygon.points[i], b = polygon.points[(i + 1) % polygon.points.length];
      const edge = { x: b.x - a.x, y: b.y - a.y };
      const inward = { x: -edge.y, y: edge.x };
      const distance = dot({ x: origin.x - a.x, y: origin.y - a.y }, inward);
      const velocity = dot(direction, inward);
      if (Math.abs(velocity) < EPSILON) {
        if (distance < -EPSILON) { far = -1; break; }
      } else {
        const time = -distance / velocity;
        if (velocity > 0) near = Math.max(near, time);
        else far = Math.min(far, time);
        if (near > far) break;
      }
    }
    if (near <= far && far >= 0) nearest = nearest === null ? near : Math.min(nearest, near);
  }
  return nearest;
}
