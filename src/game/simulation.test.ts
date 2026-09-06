import { describe, expect, it } from 'vitest';
import arenaData from '../../public/assets/arena.json';
import { moveAndCollide, rayRectDistance } from './collision';
import { cloneWorld, CONFIG, createWorld, getJetAcceleration, getMuzzlePosition, getWeaponOrigin, releasePlayerInput, stepSimulation } from './simulation';
import { CHARACTER_SCALE, CROUCH_COLLISION_HEIGHT, CROUCH_TRANSITION_SECONDS, getStanceHeight, getStanceWeaponOffset } from './stance';
import { FixedStepClock } from './timing';
import { createWeapon, WEAPONS } from './weapons';
import type { Arena, GameEvent, InputCommand, WorldState } from './types';

const arena: Arena = arenaData;
const command = (world: WorldState, changes: Partial<InputCommand> = {}): InputCommand => ({
  tick: world.tick, actorId: world.player.id, moveX: 0, jumpPressed: false,
  jumpHeld: false, aimAngle: 0, fireHeld: false, reloadPressed: false, ...changes,
});
function tick(world: WorldState, input: Partial<InputCommand> = {}, map: Arena = arena) {
  return stepSimulation(world, command(world, input), map);
}
function advance(world: WorldState, count: number, input: Partial<InputCommand> = {}, map: Arena = arena) {
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) events.push(...tick(world, input, map));
  return events;
}

describe('movement and collision', () => {
  it('accelerates quickly to the cap, brakes, and remains on the safe floor', () => {
    const world = createWorld(arena);
    advance(world, 30, { moveX: 1 });
    expect(world.player.vx).toBe(CONFIG.moveSpeed);
    expect(world.player.x).toBeGreaterThan(arena.playerSpawn.x + 130);
    expect(world.player.y + world.player.height).toBe(arena.floorY);
    expect(world.player.grounded).toBe(true);
    advance(world, 5);
    expect(world.player.vx).toBe(0);
    advance(world, 600, { moveX: -1 });
    expect(world.player.x).toBe(0);
    expect(world.player.vx).toBe(0);
    expect(world.player.health).toBe(100);
  });

  it('jumps about 90 pixels and holding the first press never jets or jumps on landing', () => {
    const world = createWorld(arena);
    const events = tick(world, { jumpPressed: true, jumpHeld: true });
    let apex = world.player.y;
    for (let i = 0; i < 75; i++) {
      events.push(...tick(world, { jumpHeld: true }));
      apex = Math.min(apex, world.player.y);
      expect(world.player.thrusting).toBe(false);
    }
    expect(arena.playerSpawn.y - apex).toBeGreaterThan(80);
    expect(arena.playerSpawn.y - apex).toBeLessThan(95);
    expect(events.filter(e => e.type === 'jump')).toHaveLength(1);
    expect(events.filter(e => e.type === 'land')).toHaveLength(1);
    expect(world.player.fuel).toBe(100);
    expect(world.player.grounded).toBe(true);
  });

  it('consumes coyote time on jumping so a fresh airborne press activates the jet', () => {
    const world = createWorld(arena);
    world.player.x = 409; world.player.y = 960 - world.player.height; world.player.vx = 320;
    tick(world, { moveX: 1 });
    expect(world.player.grounded).toBe(false);
    expect(tick(world, { jumpPressed: true, jumpHeld: true }).some(e => e.type === 'jump')).toBe(true);
    expect(world.player.coyoteTicks).toBe(0);
    tick(world);
    tick(world, { jumpPressed: true, jumpHeld: true });
    expect(world.player.thrusting).toBe(true);
  });

  it('uses thrust instead of a jump after coyote time has expired', () => {
    const world = createWorld(arena);
    world.player.x = 411; world.player.y = 892; world.player.grounded = false;
    advance(world, CONFIG.coyoteTicks + 1);
    const events = tick(world, { jumpPressed: true, jumpHeld: true });
    expect(events.some(e => e.type === 'jump')).toBe(false);
    expect(world.player.thrusting).toBe(true);
  });

  it('sweeps through the whole motion to prevent tunnelling through thin platforms', () => {
    const body = { x: 120, y: 100, width: 36, height: 68 };
    const platform = { x: 100, y: 500, width: 200, height: 10 };
    const collision = moveAndCollide(body, { x: 0, y: 1000 }, [platform]);
    expect(body.y).toBe(432);
    expect(collision.grounded).toBe(true);
    body.y = 550;
    expect(moveAndCollide(body, { x: 0, y: -1000 }, [platform]).hitY).toBe(true);
    expect(body.y).toBe(510);
  });

  it('sweeps diagonal motion and slides along a wall', () => {
    const body = { x: 0, y: 0, width: 20, height: 20 };
    const wall = { x: 150, y: 100, width: 20, height: 500 };
    expect(moveAndCollide(body, { x: 500, y: 500 }, [wall]).hitX).toBe(true);
    expect(body).toMatchObject({ x: 130, y: 500 });
  });

  it('walks along the top of a platform without sticking to it', () => {
    const world = createWorld(arena);
    world.player.x = 130; world.player.y = 892;
    advance(world, 15, { moveX: 1 });
    expect(world.player.x).toBeGreaterThan(185);
    expect(world.player.y).toBe(892);
    expect(world.player.grounded).toBe(true);
  });

  it('accepts a jump late in the extended ledge grace period', () => {
    const world = createWorld(arena);
    world.player.x = 411; world.player.y = 892; world.player.grounded = false;
    advance(world, 6);
    expect(tick(world, { jumpPressed: true, jumpHeld: true }).map(e => e.type)).toContain('jump');
    expect(world.player.thrusting).toBe(false);
  });

  it.each([1, 30, 72])('buffers a descending tap %i pixels above the floor and hops on the landing tick', distance => {
    const world = createWorld(arena);
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - distance, vy: 360, grounded: false, coyoteTicks: 0, vx: CONFIG.moveSpeed });
    const events = tick(world, { jumpPressed: true, jumpHeld: true, moveX: 1 });
    for (let i = 1; i < CONFIG.jumpBufferTicks && !events.some(e => e.type === 'jump'); i++) {
      events.push(...tick(world, { moveX: 1 })); // Releasing Space must preserve the queued hop.
    }
    expect(events.map(e => e.type)).toEqual(['land', 'jump']);
    expect(world.player.vy).toBe(-CONFIG.jumpSpeed);
    expect(world.player.vx).toBe(CONFIG.moveSpeed);
    expect(world.player.grounded).toBe(false);
    expect(world.player.jumpBufferTicks).toBe(0);
    expect(world.player.fuel).toBe(100);
    const later = advance(world, 90, { jumpHeld: true });
    expect(later.filter(e => e.type === 'jump')).toHaveLength(0);
    expect(world.player.thrusting).toBe(false);
  });

  it('does not buffer an early press beyond the landing window', () => {
    const world = createWorld(arena);
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 80, vy: 360, grounded: false, coyoteTicks: 0 });
    tick(world, { jumpPressed: true, jumpHeld: true });
    expect(world.player.jumpBufferTicks).toBe(0);
    expect(world.player.thrusting).toBe(true);
    const events = advance(world, 90);
    expect(events.filter(e => e.type === 'jump')).toHaveLength(0);
  });

  it('predicts platform landings along the horizontal path and falls back to thrust if steering misses', () => {
    const map = { ...arena, platforms: [{ x: 100, y: 500, width: 60, height: 20 }] };
    const world = createWorld(map);
    Object.assign(world.player, { x: 155, y: 380, vy: 360, grounded: false, coyoteTicks: 0 });
    tick(world, { jumpPressed: true, jumpHeld: true }, map);
    expect(world.player.jumpBufferTicks).toBeGreaterThan(0);
    const events = advance(world, CONFIG.jumpBufferTicks, { moveX: 1, jumpHeld: true }, map);
    expect(events.filter(e => e.type === 'jump')).toHaveLength(0);
    expect(world.player.jumpBufferTicks).toBe(0);
    expect(world.player.thrusting).toBe(true);

    const passing = createWorld(map);
    Object.assign(passing.player, { x: 155, y: 380, vy: 360, vx: 320, grounded: false, coyoteTicks: 0 });
    tick(passing, { moveX: 1, jumpPressed: true, jumpHeld: true }, map);
    expect(passing.player.jumpBufferTicks).toBe(0);
    expect(passing.player.thrusting).toBe(true);
  });

  it('clears a queued hop on pause so it cannot fire after resuming', () => {
    const world = createWorld(arena);
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 50, vy: 360, grounded: false, coyoteTicks: 0 });
    tick(world, { jumpPressed: true, jumpHeld: true });
    expect(world.player.jumpBufferTicks).toBeGreaterThan(0);
    releasePlayerInput(world);
    expect(world.player.jumpBufferTicks).toBe(0);
    expect(advance(world, 20).filter(e => e.type === 'jump')).toHaveLength(0);
  });
});

describe('gameplay crouch', () => {
  const transitionTicks = Math.ceil(CROUCH_TRANSITION_SECONDS / CONFIG.fixedDt);

  it('lowers the approved pose and collider together while preserving the feet in both directions', () => {
    const world = createWorld(arena);
    const target = { ...world.target };
    expect(world.player.crouchAmount).toBe(0);
    for (let i = 0; i < transitionTicks; i++) {
      tick(world, { crouchHeld: true });
      expect(world.player.y + world.player.height).toBe(arena.floorY);
      expect(world.player.height).toBeCloseTo(getStanceHeight(world.player.crouchAmount));
      expect(world.player.grounded).toBe(true);
    }
    expect(world.player.crouchAmount).toBe(1);
    expect(world.player.height).toBeCloseTo(68.5 * CHARACTER_SCALE);
    expect(world.player.height).toBeCloseTo(CROUCH_COLLISION_HEIGHT);
    expect(world.player.height).toBeLessThan(CONFIG.bodyHeight);
    for (let i = 0; i < transitionTicks; i++) {
      tick(world);
      expect(world.player.y + world.player.height).toBe(arena.floorY);
    }
    expect(world.player.crouchAmount).toBe(0);
    expect(world.player.height).toBe(CONFIG.bodyHeight);
    expect(world.player.y).toBe(arena.playerSpawn.y);
    expect(world.target).toEqual(target);
  });

  it('keeps a released crouch beneath a low ceiling and stands automatically after walking clear', () => {
    const world = createWorld(arena);
    advance(world, transitionTicks, { crouchHeld: true });
    const ceiling = { x: world.player.x - 20, y: arena.floorY - 100, width: 120, height: 45 };
    const map = { ...arena, platforms: [ceiling] };
    advance(world, 30, {}, map);
    expect(world.player.crouchAmount).toBe(1);
    expect(world.player.y).toBeGreaterThan(ceiling.y + ceiling.height);
    for (let i = 0; i < 60; i++) {
      tick(world, { moveX: 1 }, map);
      const underCeiling = world.player.x < ceiling.x + ceiling.width && world.player.x + world.player.width > ceiling.x;
      if (underCeiling) expect(world.player.y).toBeGreaterThanOrEqual(ceiling.y + ceiling.height);
      expect(world.player.y + world.player.height).toBe(arena.floorY);
    }
    expect(world.player.x).toBeGreaterThan(ceiling.x + ceiling.width);
    expect(world.player.crouchAmount).toBe(0);
    expect(world.player.height).toBe(CONFIG.bodyHeight);
  });

  it('lets jumping override crouch without changing the jump impulse or moving the feet during resizing', () => {
    const world = createWorld(arena);
    advance(world, transitionTicks, { crouchHeld: true });
    const events = tick(world, { crouchHeld: true, jumpPressed: true, jumpHeld: true });
    expect(events.map(event => event.type)).toContain('jump');
    expect(world.player.crouchAmount).toBeLessThan(1);
    expect(world.player.vy).toBe(-CONFIG.jumpSpeed + CONFIG.gravity * CONFIG.fixedDt);
    expect(world.player.y + world.player.height).toBeCloseTo(arena.floorY + world.player.vy * CONFIG.fixedDt);
    expect(world.player.grounded).toBe(false);
    advance(world, transitionTicks, { crouchHeld: true, jumpHeld: true });
    expect(world.player.crouchAmount).toBe(0);
    expect(world.player.thrusting).toBe(false);
  });

  it('resolves a jump into a low ceiling without expanding into it or trapping the player', () => {
    const world = createWorld(arena);
    advance(world, transitionTicks, { crouchHeld: true });
    const ceiling = { x: world.player.x - 20, y: arena.floorY - 100, width: 120, height: 45 };
    const map = { ...arena, platforms: [ceiling] };
    const events = tick(world, { jumpPressed: true, jumpHeld: true }, map);
    expect(events.map(event => event.type)).toContain('jump');
    expect(world.player.crouchAmount).toBe(1);
    expect(world.player.y).toBe(ceiling.y + ceiling.height);
    expect(world.player.vy).toBe(0);
    advance(world, 5, {}, map);
    expect(world.player.grounded).toBe(true);
    expect(world.player.y + world.player.height).toBe(arena.floorY);
    advance(world, 60, { moveX: 1 }, map);
    expect(world.player.crouchAmount).toBe(0);
    expect(tick(world, { jumpPressed: true, jumpHeld: true }, map).map(event => event.type)).toContain('jump');
  });

  it('starts crouching only after landing and gives a buffered jump priority over a held crouch', () => {
    const world = createWorld(arena);
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 1, vy: 120, grounded: false, coyoteTicks: 0 });
    expect(tick(world, { crouchHeld: true }).map(event => event.type)).toContain('land');
    expect(world.player.crouchAmount).toBe(0);
    tick(world, { crouchHeld: true });
    expect(world.player.crouchAmount).toBeGreaterThan(0);

    const buffered = createWorld(arena);
    Object.assign(buffered.player, { y: arena.floorY - CONFIG.bodyHeight - 1, vy: 120, grounded: false, coyoteTicks: 0 });
    expect(tick(buffered, { crouchHeld: true, jumpPressed: true, jumpHeld: true }).map(event => event.type)).toEqual(['land', 'jump']);
    expect(buffered.player.crouchAmount).toBe(0);
    tick(buffered, { crouchHeld: true });
    expect(buffered.player.crouchAmount).toBe(0);
    expect(buffered.player.grounded).toBe(false);
  });

  it('releases residual crouch in flight while keeping the jet and full air speed available', () => {
    const world = createWorld(arena);
    advance(world, transitionTicks, { crouchHeld: true });
    Object.assign(world.player, { y: 700, grounded: false, coyoteTicks: 0, vx: CONFIG.moveSpeed });
    tick(world, { crouchHeld: true, moveX: 1, jumpPressed: true, jumpHeld: true });
    expect(world.player.vx).toBe(CONFIG.moveSpeed);
    expect(world.player.crouchAmount).toBeLessThan(1);
    expect(world.player.thrusting).toBe(true);
    advance(world, transitionTicks, { crouchHeld: true, moveX: 1, jumpHeld: true });
    expect(world.player.crouchAmount).toBe(0);
    expect(world.player.height).toBe(CONFIG.bodyHeight);
    expect(world.player.thrusting).toBe(true);
  });

  it('walks at half speed when fully crouched and restores normal speed on release', () => {
    const world = createWorld(arena);
    advance(world, transitionTicks, { crouchHeld: true });
    advance(world, 15, { crouchHeld: true, moveX: 1 });
    expect(world.player.vx).toBe(CONFIG.moveSpeed / 2);
    const startX = world.player.x;
    tick(world, { crouchHeld: true, moveX: 1 });
    expect(world.player.x - startX).toBeCloseTo(CONFIG.moveSpeed / 2 * CONFIG.fixedDt);
    advance(world, transitionTicks, { moveX: 1 });
    expect(world.player.crouchAmount).toBe(0);
    expect(world.player.vx).toBe(CONFIG.moveSpeed);
  });

  it('preserves the physical stance on pause and safely releases it on resumed ticks', () => {
    const world = createWorld(arena);
    advance(world, transitionTicks, { crouchHeld: true });
    const before = cloneWorld(world);
    releasePlayerInput(world);
    expect(world).toEqual(before);
    const ceiling = { x: world.player.x - 20, y: arena.floorY - 100, width: 120, height: 45 };
    tick(world, {}, { ...arena, platforms: [ceiling] });
    expect(world.player.crouchAmount).toBe(1);
    tick(world);
    expect(world.player.crouchAmount).toBeLessThan(1);
    expect(world.player.y + world.player.height).toBe(arena.floorY);
  });

  it.each([0, Math.PI])('fires from the pose-matched lowered hand while facing %f radians', aimAngle => {
    const world = createWorld(arena);
    const standingOrigin = getWeaponOrigin(world.player);
    advance(world, transitionTicks, { crouchHeld: true, aimAngle });
    const offset = getStanceWeaponOffset(1, aimAngle === 0 ? 1 : -1);
    const origin = getWeaponOrigin(world.player);
    expect(origin.x).toBeCloseTo(world.player.x + world.player.width / 2 + offset.x);
    expect(origin.y).toBeCloseTo(arena.floorY + offset.y);
    expect(origin.y - standingOrigin.y).toBeCloseTo(17.44 * CHARACTER_SCALE);
    const events = tick(world, { crouchHeld: true, fireHeld: true, aimAngle });
    expect(events.find(event => event.type === 'shot')).toMatchObject({ originX: origin.x, originY: origin.y });
  });

  it('fires downward from the crouched barrel above the floor rather than falling back to the hand', () => {
    const world = createWorld(arena);
    const aimAngle = Math.PI / 2;
    advance(world, transitionTicks, { crouchHeld: true, aimAngle });
    const muzzle = getMuzzlePosition(world.player);
    expect(muzzle.y).toBeLessThan(arena.floorY);
    expect(muzzle.y).toBeGreaterThan(getWeaponOrigin(world.player).y + 10);
    const events = tick(world, { crouchHeld: true, fireHeld: true, aimAngle });
    const shot = events.find(event => event.type === 'shot')!;
    expect(shot).toMatchObject({ toY: arena.floorY, hit: false });
    expect(shot.y).toBeCloseTo(muzzle.y, 3);
    expect(shot.y).toBeGreaterThan(shot.originY);
  });

  it('blocks the lowered hand behind cover that a standing shot clears', () => {
    const standing = createWorld(arena);
    const crouched = createWorld(arena);
    standing.player.weapon = createWeapon('ak47', 'standing-cover');
    crouched.player.weapon = createWeapon('ak47', 'crouched-cover');
    advance(crouched, transitionTicks, { crouchHeld: true });
    const wall = { x: standing.player.x + standing.player.width + 1, y: arena.floorY - 30, width: 2, height: 30 };
    const map = { ...arena, platforms: [wall] };
    expect(getWeaponOrigin(standing.player).y).toBeLessThan(wall.y);
    const origin = getWeaponOrigin(crouched.player);
    expect(origin.y).toBeGreaterThan(wall.y);
    expect(origin.x + WEAPONS.ak47.muzzleLength).toBeGreaterThan(wall.x);
    expect(tick(standing, { fireHeld: true }, map).find(event => event.type === 'shot')).toMatchObject({ hit: true });
    expect(tick(crouched, { crouchHeld: true, fireHeld: true }, map).find(event => event.type === 'shot')).toMatchObject({ x: origin.x, y: origin.y, toX: wall.x, hit: false });
    expect(crouched.target.health).toBe(100);
  });
});

describe('jetpack state transitions', () => {
  it('can activate from a fresh airborne press with no double-tap window and stops on release', () => {
    const world = createWorld(arena);
    tick(world, { jumpPressed: true, jumpHeld: true });
    advance(world, 20, { jumpHeld: true });
    tick(world);
    tick(world, { jumpPressed: true, jumpHeld: true });
    expect(world.player.thrusting).toBe(true);
    expect(world.player.fuel).toBeLessThan(100);
    const fuel = world.player.fuel;
    tick(world);
    expect(world.player.thrusting).toBe(false);
    expect(world.player.thrustLatched).toBe(false);
    expect(world.player.fuel).toBe(fuel);
  });

  it('drains in 3.5 seconds, waits 400 ms to regenerate, and never sputters while held', () => {
    const tallArena = { ...arena, height: 10000, floorY: 9880, platforms: [] };
    const world = createWorld(tallArena);
    world.player.y = 5000; world.player.grounded = false; world.player.coyoteTicks = 0;
    tick(world, { jumpPressed: true, jumpHeld: true }, tallArena);
    advance(world, 149, { jumpHeld: true }, tallArena);
    expect(world.player.fuel).toBeCloseTo(100 * (1 - 2.5 / 3.5));
    expect(world.player.thrusting).toBe(true);
    advance(world, 59, { jumpHeld: true }, tallArena);
    expect(world.player.fuel).toBeGreaterThan(0);
    tick(world, { jumpHeld: true }, tallArena);
    expect(world.player.fuel).toBe(0);
    expect(world.player.thrusting).toBe(false);
    expect(world.player.thrustLatched).toBe(false);
    advance(world, 23, { jumpHeld: true }, tallArena);
    expect(world.player.fuel).toBe(0);
    tick(world, { jumpHeld: true }, tallArena);
    expect(world.player.fuel).toBeCloseTo(0.5);
    advance(world, 100, { jumpHeld: true }, tallArena);
    expect(world.player.thrusting).toBe(false);
    expect(world.player.fuel).toBeCloseTo(50.5);
    tick(world, {}, tallArena);
    tick(world, { jumpPressed: true, jumpHeld: true }, tallArena);
    expect(world.player.thrusting).toBe(true);
  });

  it('keeps the first tenth at full power and tapers smoothly to half engine force', () => {
    expect(getJetAcceleration(100)).toBe(3600);
    expect(getJetAcceleration(90)).toBe(3600);
    expect(getJetAcceleration(45)).toBe(2700);
    expect(getJetAcceleration(0)).toBe(1800);
    for (let fuel = 0; fuel < 100; fuel++) {
      expect(getJetAcceleration(fuel)).toBeLessThanOrEqual(getJetAcceleration(fuel + 1));
    }
  });

  it('gives a stronger initial kick and weaker low-fuel lift without resetting power on reactivation', () => {
    const accelerate = (fuel: number) => {
      const world = createWorld(arena);
      Object.assign(world.player, { y: 700, grounded: false, coyoteTicks: 0, fuel });
      tick(world, { jumpPressed: true, jumpHeld: true });
      return world;
    };
    const full = accelerate(100), low = accelerate(10);
    expect(full.player.vy).toBeCloseTo(-35);
    expect(low.player.vy).toBeLessThan(0);
    expect(low.player.vy).toBeGreaterThan(full.player.vy);
    tick(low);
    const before = low.player.vy;
    tick(low, { jumpPressed: true, jumpHeld: true });
    expect(before - low.player.vy).toBeLessThan(10);
  });

  it('uses only the remaining fuel on a partial final thrust tick', () => {
    const world = createWorld(arena);
    const fuel = CONFIG.fuelDrain * CONFIG.fixedDt / 2;
    Object.assign(world.player, { y: 700, grounded: false, coyoteTicks: 0, fuel });
    tick(world, { jumpPressed: true, jumpHeld: true });
    expect(world.player.fuel).toBe(0);
    expect(world.player.vy).toBeCloseTo((CONFIG.gravity - getJetAcceleration(fuel / 2) / 2) * CONFIG.fixedDt);
    expect(world.player.thrustLatched).toBe(false);
  });

  it('regenerates on the ground to the maximum without exceeding it', () => {
    const world = createWorld(arena);
    world.player.fuel = 0; world.player.fuelDelayTicks = 24;
    advance(world, 223);
    expect(world.player.fuel).toBe(100);
    advance(world, 20);
    expect(world.player.fuel).toBe(100);
  });

  it('landing clears thrust and holding Space does not relaunch', () => {
    const world = createWorld(arena);
    world.player.y = 1151; world.player.vy = 150; world.player.grounded = false;
    world.player.thrustLatched = true; world.player.fuel = 50;
    expect(tick(world, { jumpHeld: true }).some(e => e.type === 'land')).toBe(true);
    expect(world.player.thrustLatched).toBe(false);
    advance(world, 10, { jumpHeld: true });
    expect(world.player.grounded).toBe(true);
    expect(world.player.thrusting).toBe(false);
  });
});

describe('default pistol and targets', () => {
  it('fires exactly five shots per second and stops at an empty magazine', () => {
    const world = createWorld(arena);
    advance(world, 60, { fireHeld: true });
    expect(world.shotsFired).toBe(5);
    expect(world.player.weapon.ammo).toBe(7);
    advance(world, 240, { fireHeld: true });
    expect(world.shotsFired).toBe(12);
    expect(world.player.weapon.ammo).toBe(0);
    expect(world.player.weapon.reloadTicks).toBe(0);
  });

  it('manually reloads for 72 ticks and prevents firing throughout the reload', () => {
    const world = createWorld(arena);
    tick(world, { fireHeld: true });
    expect(tick(world, { reloadPressed: true }).map(e => e.type)).toContain('reloadStart');
    expect(world.player.weapon.reloadTicks).toBe(72);
    advance(world, 71, { fireHeld: true });
    expect(world.player.weapon.ammo).toBe(11);
    expect(world.shotsFired).toBe(1);
    expect(tick(world).map(e => e.type)).toContain('reloadEnd');
    expect(world.player.weapon.ammo).toBe(12);
    expect(world.player.weapon.reloadTicks).toBe(0);
    expect(tick(world, { reloadPressed: true }).map(e => e.type)).not.toContain('reloadStart');
  });

  it('deals 18 close-range body damage, kills with six hits, and respawns two seconds later', () => {
    const world = createWorld(arena);
    world.target.x = world.player.x + 150;
    const first = tick(world, { fireHeld: true });
    expect(world.target.health).toBe(82);
    expect(first.find(e => e.type === 'hit')).toMatchObject({ damage: 18, region: 'body' });
    const events = advance(world, 60, { fireHeld: true });
    expect(world.target.health).toBe(0);
    expect(world.kills).toBe(1);
    expect(world.hits).toBe(6);
    expect(world.target.respawnTicks).toBe(120);
    expect(events.filter(e => e.type === 'targetDeath')).toHaveLength(1);
    advance(world, 119);
    expect(world.target.health).toBe(0);
    expect(tick(world).map(e => e.type)).toContain('targetRespawn');
    expect(world.target.health).toBe(100);
  });

  it('hits only the first obstruction and cannot fire through a platform', () => {
    const world = createWorld(arena);
    const wall = { x: 600, y: 1050, width: 20, height: 170 };
    const events = tick(world, { fireHeld: true }, { ...arena, platforms: [wall] });
    expect(events.find(e => e.type === 'shot')).toMatchObject({ toX: 600, hit: false });
    expect(world.target.health).toBe(100);
    expect(world.hits).toBe(0);
  });

  it('blocks a shot when the hand is behind cover but the muzzle extends through it', () => {
    const world = createWorld(arena);
    world.player.weapon = createWeapon('ak47', 'cover-test');
    const origin = getWeaponOrigin(world.player);
    const wall = { x: world.player.x + world.player.width + 1, y: 1100, width: 2, height: 120 };
    expect(wall.x).toBeLessThan(origin.x + WEAPONS.ak47.muzzleLength);
    const events = tick(world, { fireHeld: true }, { ...arena, platforms: [wall] });
    expect(events.find(e => e.type === 'shot')).toMatchObject({ x: origin.x, toX: wall.x, hit: false });
    expect(world.target.health).toBe(100);
  });

  it('supports aim in either direction and firing while thrusting', () => {
    const world = createWorld(arena);
    world.player.grounded = false; world.player.coyoteTicks = 0;
    world.player.y = 1060;
    const aim = Math.atan2(world.target.y + 30 - (world.player.y + 30), world.target.x + 18 - (world.player.x + 18));
    tick(world, { fireHeld: true, jumpPressed: true, jumpHeld: true, aimAngle: aim });
    expect(world.player.thrusting).toBe(true);
    expect(world.target.health).toBeLessThan(100);
    const healthAfterFirstHit = world.target.health;
    world.player.x = 1200; world.player.y = 1152; world.player.vy = 0;
    advance(world, 12, { fireHeld: true, aimAngle: Math.PI });
    expect(world.target.health).toBeLessThan(healthAfterFirstHit);
  });

  it('handles parallel rays, origins in cover, and geometry behind the shot', () => {
    const wall = { x: 10, y: 10, width: 20, height: 20 };
    expect(rayRectDistance({ x: 0, y: 15 }, { x: 1, y: 0 }, wall, 100)).toBe(10);
    expect(rayRectDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, wall, 100)).toBeNull();
    expect(rayRectDistance({ x: 15, y: 15 }, { x: 1, y: 0 }, wall, 100)).toBe(0);
    expect(rayRectDistance({ x: 40, y: 15 }, { x: 1, y: 0 }, wall, 100)).toBeNull();
  });
});

describe('headless deterministic boundary', () => {
  it('releases latched thrust for pause without advancing time or changing momentum', () => {
    const world = createWorld(arena);
    tick(world, { jumpPressed: true, jumpHeld: true });
    tick(world);
    tick(world, { jumpPressed: true, jumpHeld: true, fireHeld: true });
    expect(world.player.thrusting).toBe(true);
    const before = cloneWorld(world);
    releasePlayerInput(world);
    before.player.thrusting = false;
    before.player.thrustLatched = false;
    before.player.fireHeldLast = false;
    expect(world).toEqual(before);
    tick(world);
    expect(world.player.thrusting).toBe(false);
    expect(world.shotsFired).toBe(1);
  });

  it('clones all mutable state and serializes without browser objects', () => {
    const world = createWorld(arena), copy = cloneWorld(world);
    copy.player.weapon.ammo = 1; copy.player.x = 20; copy.target.health = 20;
    expect(world.player.weapon.ammo).toBe(12);
    expect(world.player.x).toBe(arena.playerSpawn.x);
    expect(world.target.health).toBe(100);
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);
  });

  it('rejects out-of-order ticks and unknown actors', () => {
    const world = createWorld(arena);
    expect(() => tick(world, { tick: 9 })).toThrow('Expected command tick 0');
    expect(() => tick(world, { actorId: 'another-player' })).toThrow('Unknown actor');
    expect(world.tick).toBe(0);
  });

  it('produces identical states with identical commands at 30, 60 and 144 Hz rendering', () => {
    function replay(renderHz: number) {
      const world = createWorld(arena);
      const clock = new FixedStepClock();
      for (let frame = 0; frame < renderHz * 8; frame++) {
        clock.advance(1 / renderHz, () => {
          const t = world.tick;
          tick(world, {
            moveX: t < 100 ? 1 : t < 200 ? -1 : 0,
            jumpPressed: [10, 30, 220, 235].includes(t),
            jumpHeld: (t >= 10 && t < 25) || (t >= 30 && t < 110) || (t >= 220 && t < 230) || (t >= 235 && t < 310),
            crouchHeld: (t >= 0 && t < 15) || (t >= 160 && t < 240) || t >= 360,
            fireHeld: t % 80 < 50, reloadPressed: t === 210 || t === 390, aimAngle: Math.sin(t / 90) * 0.2,
          });
        });
      }
      return world;
    }
    expect(replay(30)).toEqual(replay(60));
    expect(replay(144)).toEqual(replay(60));
    expect(replay(60).tick).toBe(480);
  });

  it('bounds long frame catch-up and clears partial ticks when paused', () => {
    const clock = new FixedStepClock();
    let steps = 0;
    clock.advance(30, () => steps++);
    expect(steps).toBe(5);
    clock.advance(CONFIG.fixedDt, () => steps++);
    expect(steps).toBe(6);
    clock.advance(CONFIG.fixedDt / 2, () => steps++);
    clock.reset();
    clock.advance(CONFIG.fixedDt / 2, () => steps++);
    expect(steps).toBe(6);
    clock.advance(CONFIG.fixedDt / 2, () => steps++);
    expect(steps).toBe(7);
  });
});
