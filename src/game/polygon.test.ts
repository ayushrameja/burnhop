import { describe, expect, it } from 'vitest';
import outpostData from '../../public/assets/outpost.json';
import { compileTerrain, moveAndCollide, raySolidDistance, rectOverlapsSolid } from './collision';
import { cloneWorld, CONFIG, createWorld, getWeaponOrigin, stepSimulation } from './simulation';
import { CROUCH_TRANSITION_SECONDS } from './stance';
import type { Arena, InputCommand, Rect, TerrainPolygon, WorldState } from './types';

const polygon = (points: number[][], id = 'test'): TerrainPolygon => ({ id, material: 'rock', points: points.map(([x, y]) => ({ x, y })) });
const outpost = outpostData as Arena;
const hill = polygon([[0, 400], [150, 400], [350, 300], [500, 300], [700, 400], [900, 400], [900, 600], [0, 600]]);
const map: Arena = {
  width: 1000, height: 1000, floorY: 900, openFloor: true, platforms: [], terrain: [hill],
  playerSpawn: { x: 30, y: 400 - CONFIG.bodyHeight }, targetSpawn: { x: 800, y: 400 - CONFIG.bodyHeight },
};
function tick(world: WorldState, arena = map, changes: Partial<InputCommand> = {}) {
  return stepSimulation(world, {
    tick: world.tick, actorId: world.player.id, moveX: 0, jumpPressed: false, jumpHeld: false,
    aimAngle: 0, fireHeld: false, reloadPressed: false, ...changes,
  }, arena);
}

describe('polygon terrain collision', () => {
  it('compiles concave terrain deterministically, caches it, and leaves its input untouched', () => {
    const before = JSON.stringify(hill);
    const compiled = compileTerrain(hill);
    expect(compiled.length).toBeGreaterThan(1);
    expect(compileTerrain(hill)).toBe(compiled);
    expect(compileTerrain(JSON.parse(before))).toEqual(compiled);
    expect(JSON.stringify(hill)).toBe(before);
    const reversed = { ...hill, points: [...hill.points].reverse() };
    const body = { x: 220, y: 400, width: 36, height: 68 };
    expect(rectOverlapsSolid(body, reversed)).toBe(true);
  });

  it('walks a concave hill in both directions without stopping, sinking, or losing ground at seams', () => {
    const world = createWorld(map);
    for (let i = 0; i < 140; i++) {
      const beforeX = world.player.x;
      tick(world, map, { moveX: 1 });
      expect(world.player.x, `rightward tick ${i}`).toBeGreaterThan(beforeX);
      expect(world.player.grounded, `rightward tick ${i}`).toBe(true);
      expect(rectOverlapsSolid(world.player, hill), `rightward tick ${i}`).toBe(false);
      if (i > 5) expect(world.player.vx).toBe(CONFIG.moveSpeed);
    }
    expect(world.player.x).toBeGreaterThan(700);
    expect(world.player.y + world.player.height).toBeCloseTo(400);
    for (let i = 0; i < 140; i++) {
      tick(world, map, { moveX: -1 });
      expect(world.player.grounded, `leftward tick ${i}`).toBe(true);
      expect(rectOverlapsSolid(world.player, hill), `leftward tick ${i}`).toBe(false);
      if (i > 12) expect(world.player.vx, `leftward tick ${i}: ${JSON.stringify(world.player)}`).toBe(-CONFIG.moveSpeed);
    }
    expect(world.player.x).toBeLessThan(150);
  });

  it('does not slide sideways while idle on a slope and lets jumping leave the slope', () => {
    const world = createWorld(map);
    const x = 230;
    Object.assign(world.player, { x, y: 400 - (x + CONFIG.bodyWidth - 150) / 2 - CONFIG.bodyHeight });
    for (let i = 0; i < 60; i++) tick(world);
    expect(world.player.x).toBe(x);
    expect(world.player.grounded).toBe(true);
    const before = world.player.y;
    const events = tick(world, map, { jumpPressed: true, jumpHeld: true });
    expect(events.map(event => event.type)).toContain('jump');
    expect(world.player.grounded).toBe(false);
    expect(world.player.y).toBeLessThan(before);
    expect(world.player.vy).toBe(-CONFIG.jumpSpeed + CONFIG.gravity * CONFIG.fixedDt);
  });

  it('stops high-speed diagonal falls and ascents at sloped terrain and bunker ceilings', () => {
    const falling: Rect = { x: 40, y: 0, width: 36, height: 68 };
    expect(moveAndCollide(falling, { x: 270, y: 900 }, [hill]).grounded).toBe(true);
    expect(rectOverlapsSolid(falling, hill)).toBe(false);
    expect(falling.y + falling.height).toBeLessThanOrEqual(400);
    const roof = polygon([[100, 100], [600, 100], [600, 150], [100, 150]]);
    const rising = { x: 250, y: 300, width: 36, height: 68 };
    const result = moveAndCollide(rising, { x: 130, y: -500 }, [roof]);
    expect(result.hitY).toBe(true);
    expect(result.grounded).toBe(false);
    expect(rising.y).toBeCloseTo(150);
    expect(rising.x).toBeCloseTo(380);
    expect(rectOverlapsSolid(rising, roof)).toBe(false);
  });

  it('preserves rectangular wall, floor, and ceiling responses in mixed terrain arenas', () => {
    const solids: Rect[] = [
      { x: 0, y: 400, width: 700, height: 40 },
      { x: 400, y: 100, width: 15, height: 300 },
      { x: 100, y: 100, width: 200, height: 20 },
    ];
    const remoteTerrain = polygon([[900, 900], [920, 900], [910, 920]]);
    for (const movement of [{ x: 0, y: 500 }, { x: 500, y: 150 }, { x: 30, y: -250 }, { x: -250, y: 300 }]) {
      const legacy = { x: 200, y: 200, width: 36, height: 68 }, mixed = { ...legacy };
      const expected = moveAndCollide(legacy, movement, solids);
      expect(moveAndCollide(mixed, movement, [...solids, remoteTerrain])).toEqual(expected);
      expect(mixed.x).toBeCloseTo(legacy.x);
      expect(mixed.y).toBeCloseTo(legacy.y);
    }
  });

  it('keeps open concavities empty for actors and shots', () => {
    const bunker = polygon([[100, 100], [400, 100], [400, 300], [330, 300], [330, 170], [170, 170], [170, 300], [100, 300]]);
    const inside = { x: 220, y: 200, width: 36, height: 68 };
    expect(rectOverlapsSolid(inside, bunker)).toBe(false);
    expect(raySolidDistance({ x: 240, y: 320 }, { x: 0, y: -1 }, bunker, 1000)).toBeCloseTo(150);
    expect(raySolidDistance({ x: 240, y: 220 }, { x: 1, y: 0 }, bunker, 1000)).toBeCloseTo(90);
    expect(raySolidDistance({ x: 240, y: 220 }, { x: 0, y: 1 }, bunker, 1000)).toBeNull();
    expect(raySolidDistance({ x: 130, y: 220 }, { x: 1, y: 0 }, bunker, 1000)).toBe(0);
    expect(moveAndCollide(inside, { x: 0, y: -200 }, [bunker]).hitY).toBe(true);
    expect(inside.y).toBeCloseTo(170);
  });

  it('blocks firing through sloped cover and keeps the exposed air above a slope shootable', () => {
    const cover = polygon([[200, 400], [400, 200], [400, 600], [200, 600]]);
    expect(raySolidDistance({ x: 100, y: 300 }, { x: 1, y: 0 }, cover, 1000)).toBeCloseTo(200);
    expect(raySolidDistance({ x: 100, y: 150 }, { x: 1, y: 0 }, cover, 1000)).toBeNull();
    const world = createWorld(map);
    const origin = getWeaponOrigin(world.player);
    const wall = polygon([[150, origin.y + 20], [200, origin.y - 30], [200, 400], [150, 400]]);
    const events = tick(world, { ...map, terrain: [hill, wall] }, { fireHeld: true });
    const shot = events.find(event => event.type === 'shot')!;
    const direction = { x: shot.directionX, y: shot.directionY };
    const distance = raySolidDistance({ x: shot.originX, y: shot.originY }, direction, wall, shot.range)!;
    expect(distance).toBeGreaterThan(0);
    expect(shot.hit).toBe(false);
    expect(shot.toX).toBeCloseTo(shot.originX + direction.x * distance);
    expect(shot.toY).toBeCloseTo(shot.originY + direction.y * distance);
    expect(world.target.health).toBe(100);
    expect(world.hits).toBe(0);
  });

  it('uses polygon clearance when standing up and when jumping from a crouch', () => {
    const world = createWorld(map);
    for (let i = 0; i < Math.ceil(CROUCH_TRANSITION_SECONDS / CONFIG.fixedDt); i++) tick(world, map, { crouchHeld: true });
    const bottom = world.player.y - 0.1;
    const ceiling = polygon([[0, bottom - 40], [150, bottom - 20], [150, bottom], [0, bottom]]);
    const tunnelMap = { ...map, terrain: [hill, ceiling] };
    tick(world, tunnelMap);
    expect(world.player.crouchAmount).toBe(1);
    tick(world, tunnelMap, { jumpPressed: true, jumpHeld: true });
    expect(world.player.crouchAmount).toBe(1);
    expect(world.player.y).toBeCloseTo(bottom);
    expect(world.player.vy).toBe(0);
    expect(rectOverlapsSolid(world.player, ceiling)).toBe(false);
  });

  it('predicts buffered landings against the actual sloped surface', () => {
    const world = createWorld(map);
    const x = 230, landingY = 400 - (x + CONFIG.bodyWidth - 150) / 2 - CONFIG.bodyHeight;
    Object.assign(world.player, { x, y: landingY - 45, vy: 360, grounded: false, coyoteTicks: 0 });
    const events = tick(world, map, { jumpPressed: true, jumpHeld: true });
    expect(world.player.jumpBufferTicks).toBeGreaterThan(0);
    expect(world.player.thrustLatched).toBe(false);
    for (let i = 0; i < CONFIG.jumpBufferTicks; i++) events.push(...tick(world));
    expect(events.map(event => event.type)).toEqual(['land', 'jump']);
    expect(world.player.vy).toBeLessThan(0);
  });

  it('falls through an open floor and recovers at the spawn with motion and input cleared', () => {
    const world = createWorld(map);
    Object.assign(world, { shotsFired: 18, hits: 7, kills: 1 });
    Object.assign(world.player, {
      x: 940, y: map.floorY + 5, vy: 700, vx: 130, grounded: false, coyoteTicks: 0,
      thrusting: false, thrustLatched: true, jumpBufferTicks: 3,
    });
    world.player.weapon.ammo = 12;
    tick(world, map, { moveX: 1 });
    expect(world.player.y).toBeGreaterThan(map.floorY);
    for (let i = 0; i < 30 && world.player.x !== map.playerSpawn.x; i++) tick(world, map, { moveX: 1 });
    expect(world.player).toMatchObject({
      ...map.playerSpawn, vx: 0, vy: 0, grounded: true, jumpBufferTicks: 0,
      thrusting: false, thrustLatched: false, height: CONFIG.bodyHeight, crouchAmount: 0,
      weapon: { ammo: 12 },
    });
    expect(world).toMatchObject({ shotsFired: 18, hits: 7, kills: 1 });
    const clone = cloneWorld(world);
    clone.player.y = map.height + 1;
    tick(clone, map, { fireHeld: true, reloadPressed: true, jumpPressed: true, jumpHeld: true });
    expect(clone.player.weapon.ammo).toBe(12);
    expect(clone.player.weapon.reloadTicks).toBe(0);
    expect(clone.player.vy).toBe(0);
    expect(clone.player.thrustLatched).toBe(false);
  });
});

describe('Outpost collision integration', () => {
  it('compiles every contour and provides clear, supported player, target, and multiplayer spawns', () => {
    for (const terrain of outpost.terrain!) expect(compileTerrain(terrain).length).toBeGreaterThan(0);
    for (const spawn of [outpost.playerSpawn, outpost.targetSpawn, ...outpost.spawnPoints!]) {
      const body = { ...spawn, width: CONFIG.bodyWidth, height: CONFIG.bodyHeight };
      expect(outpost.terrain!.some(solid => rectOverlapsSolid(body, solid)), JSON.stringify(spawn)).toBe(false);
      const before = body.y;
      expect(moveAndCollide(body, { x: 0, y: 1 }, outpost.terrain!).grounded, JSON.stringify(spawn)).toBe(true);
      expect(body.y).toBeCloseTo(before);
    }
    const world = createWorld(outpost);
    for (let i = 0; i < 60; i++) tick(world, outpost);
    expect(world.player).toMatchObject({ ...outpost.playerSpawn, grounded: true });
  });

  it('traverses every lower slope with standing clearance and a body-width run both ways', () => {
    let checked = 0;
    for (const terrain of outpost.terrain!.filter(solid => /base|lower/.test(solid.id))) {
      for (let index = 0; index < terrain.points.length; index++) {
        const a = terrain.points[index], b = terrain.points[(index + 1) % terrain.points.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx < CONFIG.bodyWidth + 15 || Math.abs(dy) < 1 || Math.abs(dy / dx) > 1.5) continue;
        for (const direction of [-1, 1]) {
          const x = (a.x + b.x - CONFIG.bodyWidth) / 2;
          const supportX = dy > 0 ? x : x + CONFIG.bodyWidth;
          const body = { x, y: a.y + (supportX - a.x) * dy / dx - CONFIG.bodyHeight, width: CONFIG.bodyWidth, height: CONFIG.bodyHeight };
          // The inside turn at the tunnel entrance has an adjacent wall above
          // its short slope; a standing body cannot start in that corner.
          if (outpost.terrain!.some(solid => rectOverlapsSolid(body, solid))) continue;
          const before = { ...body };
          const result = moveAndCollide(body, { x: direction * 5, y: 0.42 }, [terrain], { grounded: true });
          expect(result.grounded, `${terrain.id} edge ${index}, direction ${direction}`).toBe(true);
          expect(body.x).toBeCloseTo(before.x + direction * 5);
          expect(body.y).toBeCloseTo(before.y + direction * 5 * dy / dx);
          expect(rectOverlapsSolid(body, terrain)).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(12);
  });

  it('replays polygon movement and shooting identically after JSON serialization', () => {
    const world = createWorld(outpost), replay = createWorld(JSON.parse(JSON.stringify(outpost)));
    const replayMap = JSON.parse(JSON.stringify(outpost));
    for (let i = 0; i < 360; i++) {
      const input: Partial<InputCommand> = {
        moveX: i < 220 ? 1 : -1, jumpPressed: [10, 40, 180, 210].includes(i),
        jumpHeld: (i >= 10 && i < 20) || (i >= 40 && i < 100) || (i >= 180 && i < 190) || (i >= 210 && i < 290),
        fireHeld: i % 80 < 35, reloadPressed: i === 210, aimAngle: Math.sin(i / 80),
      };
      expect(tick(replay, replayMap, input)).toEqual(tick(world, outpost, input));
    }
    expect(replay).toEqual(world);
  });
});
