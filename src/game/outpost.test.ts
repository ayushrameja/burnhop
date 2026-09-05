import { describe, expect, it } from 'vitest';
import outpostData from '../../public/assets/outpost.json';
import { compileTerrain, rectOverlapsSolid } from './collision';
import { CONFIG, createWorld, stepSimulation } from './simulation';
import type { Arena, InputCommand, Vec2, WorldState } from './types';

const arena = outpostData as Arena;
const terrain = arena.terrain!;
const spawns = arena.spawnPoints!;

function tick(world: WorldState, input: Partial<InputCommand> = {}) {
  const events = stepSimulation(world, {
    tick: world.tick, actorId: world.player.id, moveX: 0, jumpPressed: false,
    jumpHeld: false, aimAngle: 0, fireHeld: false, reloadPressed: false, ...input,
  }, arena);
  expect(terrain.filter(solid => rectOverlapsSolid(world.player, solid)).map(solid => solid.id)).toEqual([]);
  return events;
}

function worldAt(point: Vec2) {
  return createWorld({ ...arena, playerSpawn: point });
}

describe('Outpost arena', () => {
  it('has simple, bounded collision contours and safe supported standing spawns', () => {
    expect(new Set(terrain.map(solid => solid.id)).size).toBe(terrain.length);
    for (const solid of terrain) {
      expect(compileTerrain(solid).length, solid.id).toBeGreaterThan(0);
      for (const point of solid.points) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y), solid.id).toBe(true);
        expect(point.x, solid.id).toBeGreaterThanOrEqual(0);
        expect(point.x, solid.id).toBeLessThanOrEqual(arena.width);
        expect(point.y, solid.id).toBeGreaterThanOrEqual(0);
        expect(point.y, solid.id).toBeLessThan(arena.height);
      }
    }
    for (const spawn of [...spawns, arena.playerSpawn, arena.targetSpawn]) {
      const world = worldAt(spawn);
      for (let i = 0; i < 60; i++) tick(world);
      expect(world.player.grounded, JSON.stringify(spawn)).toBe(true);
      expect(world.player.x).toBeCloseTo(spawn.x);
      expect(world.player.y).toBeCloseTo(spawn.y);
    }
  });

  it('crosses the west tunnel entrance and both lower shelves while crouching', () => {
    // This route runs under the two shelves, where a standing pilot cannot
    // clear the narrowest bend. Starting here isolates the tunnel itself.
    const world = worldAt({ x: 700, y: 1460 });
    for (let i = 0; i < 360; i++) {
      tick(world, { moveX: 1, crouchHeld: true });
      expect(world.player.y).toBeGreaterThan(1300);
      expect(world.player.y).toBeLessThan(1510);
    }
    expect(world.player.x).toBeGreaterThan(1600);
    expect(world.player.grounded).toBe(true);
  });

  it('reaches the central rise from the lower saddle using the existing jetpack fuel budget', () => {
    const world = worldAt(spawns.find(spawn => spawn.id === 'central-saddle')!);
    for (let i = 0; i < 120 && world.player.x < 1920; i++) tick(world, { moveX: 1 });
    expect(world.player.x).toBeGreaterThanOrEqual(1920);
    for (let i = 0; i < 140 && world.player.y > 680; i++) {
      tick(world, { jetpack: { source: 'separate', pressed: i === 0, held: true } });
    }
    expect(world.player.y).toBeLessThanOrEqual(680);
    for (let i = 0; i < 120 && world.player.x < 2250; i++) {
      const held = world.player.y > 620;
      tick(world, { moveX: 1, jetpack: { source: 'separate', pressed: held, held } });
    }
    const fuelAfterFlight = world.player.fuel;
    for (let i = 0; i < 180 && !world.player.grounded; i++) tick(world);
    const rise = terrain.find(solid => solid.id === 'central-rise')!;
    expect(world.player.x).toBeGreaterThan(2189);
    expect(world.player.x).toBeLessThan(2690);
    expect(rectOverlapsSolid({ ...world.player, y: world.player.y + 1 }, rise)).toBe(true);
    expect(world.player.grounded).toBe(true);
    expect(fuelAfterFlight).toBeGreaterThan(0);
    expect(fuelAfterFlight).toBeLessThan(CONFIG.maxFuel);
  });

  it('recovers a fall below the floating islands while preserving practice results and inventory', () => {
    const world = createWorld(arena);
    world.player.y = arena.height + CONFIG.bodyHeight;
    world.player.vx = 100;
    world.player.vy = CONFIG.maxFallSpeed;
    world.player.weapon.ammo = 11;
    world.shotsFired = 19;
    world.kills = 2;
    tick(world, { fireHeld: true });
    expect(world.player.x).toBe(arena.playerSpawn.x);
    expect(world.player.y).toBe(arena.playerSpawn.y);
    expect(world.player.vx).toBe(0);
    expect(world.player.vy).toBe(0);
    expect(world.player.weapon.ammo).toBe(11);
    expect(world.shotsFired).toBe(19);
    expect(world.kills).toBe(2);
  });
});
