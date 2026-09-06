import type { Arena } from './types';

export function validateArena(value: unknown): Arena {
  const a = value as Arena;
  const vector = (p: unknown) => !!p && typeof p === 'object' && Number.isFinite((p as { x: number }).x) && Number.isFinite((p as { y: number }).y);
  if (!a || !Number.isFinite(a.width) || !Number.isFinite(a.height) || !Number.isFinite(a.floorY) ||
      a.width <= 0 || a.height <= 0 || a.floorY <= 0 || a.floorY > a.height ||
      !vector(a.playerSpawn) || !vector(a.targetSpawn) || !Array.isArray(a.platforms) ||
      !a.platforms.every(p => vector(p) && Number.isFinite(p.width) && p.width > 0 && Number.isFinite(p.height) && p.height > 0)) {
    throw new Error('The arena data is incomplete. Retry to load it again.');
  }
  const bounded = (p: { x: number; y: number }) => vector(p) && p.x >= 0 && p.y >= 0 && p.x <= a.width && p.y <= a.height;
  const identifier = (id: unknown) => typeof id === 'string' && id.trim().length > 0;
  const invalidMetadata =
    (a.id !== undefined && !identifier(a.id)) ||
    (a.name !== undefined && !identifier(a.name)) ||
    (a.theme !== undefined && a.theme !== 'range' && a.theme !== 'outpost') ||
    (a.openFloor !== undefined && typeof a.openFloor !== 'boolean');
  const invalidSpawns = !bounded(a.playerSpawn) || !bounded(a.targetSpawn) ||
    (a.spawnPoints !== undefined && (!Array.isArray(a.spawnPoints) || !a.spawnPoints.every(p => bounded(p) && identifier(p.id)) || new Set(a.spawnPoints.map(p => p.id)).size !== a.spawnPoints.length));
  const invalidPickups = a.pickupPads !== undefined && (!Array.isArray(a.pickupPads)
    || !a.pickupPads.every(p => bounded(p) && identifier(p.id) && ['ordinary', 'sniper'].includes(p.kind))
    || new Set(a.pickupPads.map(p => p.id)).size !== a.pickupPads.length
    || a.pickupPads.filter(p => p.kind === 'sniper').length > 1);
  const invalidPlatforms = !a.platforms.every(p => bounded(p) && p.x + p.width <= a.width && p.y + p.height <= a.height);
  const invalidTerrain = a.terrain !== undefined && (!Array.isArray(a.terrain) || !a.terrain.every(polygon => {
    if (!polygon || !identifier(polygon.id) || !['rock', 'bunker', 'wood'].includes(polygon.material) ||
        (polygon.grass !== undefined && typeof polygon.grass !== 'boolean') ||
        !Array.isArray(polygon.points) || polygon.points.length < 3 || !polygon.points.every(bounded)) return false;
    const points = polygon.points;
    if (new Set(points.map(p => `${p.x},${p.y}`)).size !== points.length) return false;
    const signedArea = points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length];
      return sum + p.x * next.y - next.x * p.y;
    }, 0);
    if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 0.001) return false;
    // Concave contours are supported, but crossing edges do not describe a solid.
    const cross = (p: typeof points[number], q: typeof points[number], r: typeof points[number]) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const between = (p: typeof points[number], q: typeof points[number], r: typeof points[number]) => r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x) && r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y);
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      for (let j = i + 1; j < points.length; j++) {
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
        const r = points[j], s = points[(j + 1) % points.length];
        const pqR = cross(p, q, r), pqS = cross(p, q, s), rsP = cross(r, s, p), rsQ = cross(r, s, q);
        if ((pqR * pqS < 0 && rsP * rsQ < 0) ||
            (pqR === 0 && between(p, q, r)) || (pqS === 0 && between(p, q, s)) ||
            (rsP === 0 && between(r, s, p)) || (rsQ === 0 && between(r, s, q))) return false;
      }
    }
    return true;
  }) || new Set(a.terrain.map(p => p.id)).size !== a.terrain.length);
  if (invalidMetadata || invalidSpawns || invalidPlatforms || invalidTerrain || invalidPickups) {
    throw new Error('The arena geometry is invalid. Retry to load it again.');
  }
  return a;
}
