import { describe, expect, it } from 'vitest';
import outpostData from '../../public/assets/outpost.json';
import { raySolidDistance, rectOverlapsSolid } from './collision';
import { CONFIG, createWorld, stepSimulation } from './simulation';
import { CROUCH_COLLISION_HEIGHT, CROUCH_TRANSITION_SECONDS } from './stance';
import type { Arena, InputCommand, Vec2, WorldState } from './types';

const arena = outpostData as Arena;
const scale = 1.4, sky = 180;
const westFloor = [[320, 384], [512, 384], [576, 352], [640, 376], [662, 446]];
const eastFloor = [[2818, 686], [2878, 666], [2950, 706], [3004, 706], [3078, 666], [3136, 686], [3168, 736]];
const mouths = [
  { name: 'west left', outside: 335, inside: 420, throat: 384, floor: westFloor, roof: 'west-bunker-roof', ground: 'west-island', tight: false },
  { name: 'west right', outside: 620, inside: 515, throat: 576, floor: westFloor, roof: 'west-bunker-roof', ground: 'west-island', tight: true },
  { name: 'east left', outside: 2818, inside: 2905, throat: 2878, floor: eastFloor, roof: 'east-bunker-left', ground: 'east-base', tight: true },
  { name: 'east right', outside: 3112, inside: 3032, throat: 3078, floor: eastFloor, roof: 'east-bunker-right', ground: 'east-base', tight: true },
];

/** AABB feet rest on the highest point covered by its full width, including ridges. */
function feetAt(designX: number, floor: number[][]): number {
  const right = designX + CONFIG.bodyWidth / scale;
  const heights: number[] = [];
  for (let i = 0; i < floor.length - 1; i++) {
    const [ax, ay] = floor[i], [bx, by] = floor[i + 1];
    if (right < ax || designX > bx) continue;
    for (const x of [Math.max(ax, designX), Math.min(bx, right)]) heights.push(ay + (x - ax) * (by - ay) / (bx - ax));
  }
  return Math.min(...heights) * scale + sky;
}

function start(designX: number, floor: number[][], crouched = false) {
  const height = crouched ? CROUCH_COLLISION_HEIGHT : CONFIG.bodyHeight;
  const position = { x: designX * scale, y: feetAt(designX, floor) - height };
  const world = createWorld({ ...arena, playerSpawn: position });
  if (crouched) Object.assign(world.player, { height, crouchAmount: 1 });
  return world;
}

function tick(world: WorldState, input: Partial<InputCommand> = {}) {
  const events = stepSimulation(world, {
    tick: world.tick, actorId: world.player.id, moveX: 0, jumpPressed: false, jumpHeld: false,
    aimAngle: 0, fireHeld: false, reloadPressed: false, ...input,
  }, arena);
  expect(arena.terrain!.filter(solid => rectOverlapsSolid(world.player, solid)).map(solid => solid.id), JSON.stringify(world.player)).toEqual([]);
  return events;
}

describe('Outpost bunker entrances', () => {
  it.each(mouths)('crosses the $name mouth in both directions while crouching', mouth => {
    for (const [from, to] of [[mouth.outside, mouth.inside], [mouth.inside, mouth.outside]]) {
      const world = start(from, mouth.floor);
      for (let i = 0; i < Math.ceil(CROUCH_TRANSITION_SECONDS / CONFIG.fixedDt); i++) tick(world, { crouchHeld: true });
      expect(world.player.crouchAmount).toBe(1);
      const direction = Math.sign(to - from) as -1 | 1;
      for (let i = 0; i < 180 && direction * world.player.x < direction * to * scale; i++) {
        tick(world, { moveX: direction, crouchHeld: true });
      }
      expect(direction * world.player.x, `${mouth.name}: ${from} -> ${to}`).toBeGreaterThanOrEqual(direction * to * scale);
      expect(world.player.grounded).toBe(true);
    }
  });

  it.each(mouths.filter(mouth => mouth.tight))('allows a crouch but prevents standing inside the $name throat', mouth => {
    const designX = mouth.throat - CONFIG.bodyWidth / scale / 2;
    const world = start(designX, mouth.floor, true);
    for (let i = 0; i < 30; i++) tick(world);
    expect(world.player.height).toBeGreaterThan(CROUCH_COLLISION_HEIGHT);
    expect(world.player.height).toBeLessThan(CONFIG.bodyHeight);
    expect(world.player.crouchAmount).toBeGreaterThan(0);
    expect(world.player.grounded).toBe(true);
    const roof = arena.terrain!.find(solid => solid.id === mouth.roof)!;
    expect(rectOverlapsSolid({ ...world.player, y: world.player.y + world.player.height - CONFIG.bodyHeight, height: CONFIG.bodyHeight }, roof)).toBe(true);
    // Continue into the open chamber after releasing crouch: clearance retries
    // each tick and the pilot stands only once its full width clears the lip.
    const direction = Math.sign(mouth.inside * scale - world.player.x) as -1 | 1;
    for (let i = 0; i < 120 && direction * world.player.x < direction * mouth.inside * scale; i++) tick(world, { moveX: direction });
    expect(world.player.crouchAmount).toBe(0);
  });

  it.each(mouths.filter(mouth => mouth.tight))('retains solid roof and floor for shots at the $name mouth', mouth => {
    const designX = mouth.throat - CONFIG.bodyWidth / scale / 2;
    const world = start(designX, mouth.floor, true);
    const origin: Vec2 = { x: mouth.throat * scale, y: world.player.y + world.player.height / 2 };
    const roof = arena.terrain!.find(solid => solid.id === mouth.roof)!;
    const ground = arena.terrain!.find(solid => solid.id === mouth.ground)!;
    const roofDistance = raySolidDistance(origin, { x: 0, y: -1 }, roof, 100);
    const floorDistance = raySolidDistance(origin, { x: 0, y: 1 }, ground, 100);
    expect(roofDistance).toBeGreaterThan(0);
    expect(roofDistance).toBeLessThan(50);
    expect(floorDistance).toBeCloseTo(CROUCH_COLLISION_HEIGHT / 2);
    expect(roofDistance! + floorDistance!).toBeGreaterThanOrEqual(60);
    expect(roofDistance! + floorDistance!).toBeLessThanOrEqual(65);
  });
});
