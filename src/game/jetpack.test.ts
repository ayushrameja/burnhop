import { describe, expect, it } from 'vitest';
import arenaData from '../../public/assets/arena.json';
import { cloneWorld, CONFIG, createWorld, releasePlayerInput, stepSimulation } from './simulation';
import { CROUCH_TRANSITION_SECONDS } from './stance';
import type { Arena, InputCommand, WorldState } from './types';

const arena: Arena = arenaData;
const separate = (pressed = false, held = false): NonNullable<InputCommand['jetpack']> => ({ source: 'separate', pressed, held });
const combined = (pressed = false, held = false): NonNullable<InputCommand['jetpack']> => ({ source: 'combined', pressed, held });
function tick(world: WorldState, changes: Partial<InputCommand> = {}, map = arena) {
  return stepSimulation(world, {
    tick: world.tick, actorId: world.player.id, moveX: 0, jumpPressed: false, jumpHeld: false,
    aimAngle: 0, fireHeld: false, reloadPressed: false, jetpack: separate(), ...changes,
  }, map);
}
function airborne(map = arena) {
  const world = createWorld(map);
  Object.assign(world.player, { y: map.floorY - CONFIG.bodyHeight - 500, grounded: false, coyoteTicks: 0 });
  return world;
}

describe('explicit jetpack commands', () => {
  it('keeps explicit combined commands identical to legacy input throughout a flight', () => {
    const legacy = createWorld(arena), explicit = cloneWorld(legacy);
    for (let frame = 0; frame < 240; frame++) {
      const jumpPressed = [0, 12, 150, 164].includes(frame);
      const jumpHeld = frame < 8 || (frame >= 12 && frame < 120) || (frame >= 150 && frame < 158) || frame >= 164;
      const input = { jumpPressed, jumpHeld, moveX: (frame < 100 ? 1 : -1) as -1 | 1, crouchHeld: frame >= 190 };
      expect(tick(explicit, { ...input, jetpack: combined(jumpPressed, jumpHeld) }))
        .toEqual(tick(legacy, { ...input, jetpack: undefined }));
      expect(explicit).toEqual(legacy);
    }
  });

  it('keeps the combined first jump separate from thrust and supports sustained intent after button release', () => {
    const world = createWorld(arena);
    expect(tick(world, { jumpPressed: true, jumpHeld: true, jetpack: combined(true, true) })
      .map(event => event.type)).toEqual(['jump']);
    for (let frame = 0; frame < 5; frame++) tick(world, { jumpHeld: true, jetpack: combined(false, true) });
    expect(world.player.thrustLatched).toBe(false);
    expect(world.player.fuel).toBe(CONFIG.maxFuel);
    tick(world, { jetpack: combined() });
    tick(world, { jumpPressed: true, jumpHeld: true, jetpack: combined(true, true) });
    tick(world, { jumpHeld: false, jetpack: combined(false, true) });
    expect(world.player.thrusting).toBe(true);
    tick(world, { jumpHeld: true, jetpack: combined() });
    expect(world.player.thrusting).toBe(false);
    expect(world.player.jumpBufferTicks).toBe(0);
  });

  it('preserves a queued combined hop when toggling thrust off without issuing a new jump pulse', () => {
    const world = airborne();
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 50, vy: 360 });
    const events = tick(world, { jumpPressed: true, jetpack: combined(true, true) });
    expect(world.player.jumpBufferTicks).toBeGreaterThan(0);
    for (let frame = 0; frame < CONFIG.jumpBufferTicks; frame++) events.push(...tick(world, { jetpack: combined() }));
    expect(events.map(event => event.type)).toEqual(['land', 'jump']);
    expect(world.player.thrustLatched).toBe(false);
    expect(world.player.fuel).toBe(CONFIG.maxFuel);
  });

  it('uses combined toggle intent for a missed landing even after the physical jump button is released', () => {
    const map = { ...arena, platforms: [{ x: 100, y: 500, width: 60, height: 20 }] };
    const world = airborne(map);
    Object.assign(world.player, { x: 155, y: 380, vy: 360 });
    tick(world, { jumpPressed: true, jetpack: combined(true, true) }, map);
    expect(world.player.jumpBufferTicks).toBeGreaterThan(0);
    for (let frame = 0; frame < CONFIG.jumpBufferTicks; frame++) tick(world, { moveX: 1, jetpack: combined(false, true) }, map);
    expect(world.player.jumpBufferTicks).toBe(0);
    expect(world.player.thrusting).toBe(true);
  });

  it('takes off directly with the separate jetpack and consumes coyote grace', () => {
    const world = createWorld(arena), startY = world.player.y;
    expect(tick(world, { jetpack: separate(true, true) })).toEqual([]);
    expect(world.player.grounded).toBe(false);
    expect(world.player.y).toBeLessThan(startY);
    expect(world.player.vy).toBeCloseTo((CONFIG.gravity - CONFIG.jetAcceleration) * CONFIG.fixedDt);
    expect(world.player.coyoteTicks).toBe(0);
    expect(tick(world, { jumpPressed: true, jetpack: separate(false, true) }).map(event => event.type)).not.toContain('jump');
    expect(world.player.thrusting).toBe(true);
  });

  it('combines separate simultaneous jump and jetpack input without clamping away the jump impulse', () => {
    const world = createWorld(arena);
    expect(tick(world, { jumpPressed: true, jumpHeld: true, jetpack: separate(true, true) })
      .map(event => event.type)).toEqual(['jump']);
    expect(world.player.thrusting).toBe(true);
    expect(world.player.vy).toBeCloseTo(-CONFIG.jumpSpeed + (CONFIG.gravity - CONFIG.jetAcceleration) * CONFIG.fixedDt);
  });

  it('never activates thrust from a separate jump or from a separate expired jump buffer', () => {
    const world = airborne();
    tick(world, { jumpPressed: true, jumpHeld: true });
    expect(world.player.thrusting).toBe(false);
    expect(world.player.fuel).toBe(CONFIG.maxFuel);

    const map = { ...arena, platforms: [{ x: 100, y: 500, width: 60, height: 20 }] };
    const buffered = airborne(map);
    Object.assign(buffered.player, { x: 155, y: 380, vy: 360 });
    tick(buffered, { jumpPressed: true, jumpHeld: true }, map);
    expect(buffered.player.jumpBufferTicks).toBeGreaterThan(0);
    for (let frame = 0; frame < CONFIG.jumpBufferTicks; frame++) {
      tick(buffered, { moveX: 1, jumpHeld: true, jetpack: separate(false, true) }, map);
    }
    expect(buffered.player.jumpBufferTicks).toBe(0);
    expect(buffered.player.thrusting).toBe(false);
    expect(buffered.player.thrustLatched).toBe(false);
    expect(buffered.player.fuel).toBe(CONFIG.maxFuel);
  });

  it('does not let a buffered separate jump defer an explicit jetpack activation', () => {
    const world = airborne();
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 50, vy: 360 });
    tick(world, { jumpPressed: true });
    expect(world.player.jumpBufferTicks).toBeGreaterThan(0);
    tick(world, { jetpack: separate(true, true) });
    expect(world.player.thrusting).toBe(true);
    expect(world.player.fuel).toBeLessThan(CONFIG.maxFuel);
  });

  it('releases crouch for direct thrust while preserving clearance under a low ceiling', () => {
    const world = createWorld(arena);
    for (let frame = 0; frame < Math.ceil(CROUCH_TRANSITION_SECONDS / CONFIG.fixedDt); frame++) tick(world, { crouchHeld: true });
    expect(world.player.crouchAmount).toBe(1);
    tick(world, { crouchHeld: true, jetpack: separate(true, true) });
    expect(world.player.crouchAmount).toBeLessThan(1);
    expect(world.player.thrusting).toBe(true);

    const blocked = createWorld(arena);
    for (let frame = 0; frame < Math.ceil(CROUCH_TRANSITION_SECONDS / CONFIG.fixedDt); frame++) tick(blocked, { crouchHeld: true });
    const ceilingBottom = blocked.player.y - 0.1;
    const map = { ...arena, platforms: [{ x: blocked.player.x - 20, y: ceilingBottom - 20, width: 100, height: 20 }] };
    tick(blocked, { crouchHeld: true, jetpack: separate(true, true) }, map);
    expect(blocked.player.crouchAmount).toBe(1);
    expect(blocked.player.y).toBeGreaterThanOrEqual(ceilingBottom);
  });

  it.each(['combined', 'separate'] as const)('clears %s thrust on empty fuel and requires another activation after regeneration', source => {
    const map = { ...arena, height: 10000, floorY: 9880, platforms: [] };
    const world = airborne(map);
    world.player.fuel = CONFIG.fuelDrain * CONFIG.fixedDt / 2;
    tick(world, { jetpack: { source, pressed: true, held: true } }, map);
    expect(world.player.fuel).toBe(0);
    expect(world.player.thrustLatched).toBe(false);
    for (let frame = 0; frame < CONFIG.fuelDelayTicks + 5; frame++) {
      tick(world, { jetpack: { source, pressed: false, held: true } }, map);
    }
    expect(world.player.fuel).toBeGreaterThan(0);
    expect(world.player.thrusting).toBe(false);
    tick(world, { jetpack: { source, pressed: true, held: true } }, map);
    expect(world.player.thrusting).toBe(true);
  });

  it.each(['combined', 'separate'] as const)('clears %s thrust on landing and does not take off again from sustained intent alone', source => {
    const world = airborne();
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 1, vy: 400, thrustLatched: true });
    expect(tick(world, { jetpack: { source, pressed: false, held: true } }).map(event => event.type)).toContain('land');
    expect(world.player.thrustLatched).toBe(false);
    for (let frame = 0; frame < 5; frame++) tick(world, { jetpack: { source, pressed: false, held: true } });
    expect(world.player.grounded).toBe(true);
    expect(world.player.thrusting).toBe(false);
  });

  it('clears separate thrust on pause without advancing simulation or changing momentum', () => {
    const world = createWorld(arena);
    tick(world, { jetpack: separate(true, true) });
    const before = cloneWorld(world);
    releasePlayerInput(world);
    before.player.thrusting = false;
    before.player.thrustLatched = false;
    expect(world).toEqual(before);
    tick(world, { jetpack: separate(false, true) });
    expect(world.player.thrusting).toBe(false);
  });
});
