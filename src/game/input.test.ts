import { describe, expect, it } from 'vitest';
import arenaData from '../../public/assets/arena.json';
import { defaultControls } from './controls';
import { ActionInput } from './input';
import { CONFIG, createWorld, stepSimulation } from './simulation';
import type { Arena, GameEvent, WorldState } from './types';

const arena: Arena = arenaData;
function tick(input: ActionInput, world: WorldState, map = arena) {
  const events = stepSimulation(world, {
    tick: world.tick, actorId: world.player.id, aimAngle: 0, ...input.consumeTick(),
  }, map);
  input.reconcile(world.player, events);
  return events;
}
function airborne(map = arena) {
  const world = createWorld(map);
  Object.assign(world.player, { y: map.floorY - CONFIG.bodyHeight - 500, grounded: false, coyoteTicks: 0 });
  return world;
}

describe('action input', () => {
  it('uses physical aliases independently for Hold and ignores repeated presses', () => {
    const input = new ActionInput();
    expect(input.press('KeyS')).toEqual(['crouch']);
    expect(input.press('KeyS')).toEqual([]);
    input.press('ArrowDown');
    input.release('KeyS');
    expect(input.consumeTick().crouchHeld).toBe(true);
    input.release('ArrowDown');
    expect(input.consumeTick().crouchHeld).toBe(false);
    input.press('KeyA');
    input.press('KeyD');
    expect(input.snapshot().moveX).toBe(0);
    input.release('KeyA');
    expect(input.snapshot().moveX).toBe(1);
  });

  it('consumes jump and reload pulses once while preserving physical state', () => {
    const input = new ActionInput();
    input.press('Space');
    input.press('KeyR');
    expect(input.consumeTick()).toMatchObject({ jumpPressed: true, jumpHeld: true, reloadPressed: true, jetpack: { pressed: true, held: true } });
    expect(input.consumeTick()).toMatchObject({ jumpPressed: false, jumpHeld: true, reloadPressed: false, jetpack: { pressed: false, held: true } });
    expect(input.press('Space')).toEqual([]);
    input.release('Space');
    input.press('Space');
    expect(input.consumeTick().jumpPressed).toBe(true);
  });

  it('switches Toggle movement immediately to the opposite direction and stops on the same direction', () => {
    const controls = defaultControls();
    controls.behavior.movement = 'toggle';
    controls.bindings.moveLeft[1] = 'ArrowLeft';
    const input = new ActionInput(controls);
    input.press('KeyA');
    input.release('KeyA');
    expect(input.consumeTick().moveX).toBe(-1);
    input.press('KeyD');
    expect(input.consumeTick().moveX).toBe(1);
    input.release('KeyD');
    input.press('ArrowLeft');
    expect(input.consumeTick().moveX).toBe(-1);
    input.release('ArrowLeft');
    input.press('KeyA');
    expect(input.consumeTick().moveX).toBe(0);
  });

  it.each(['radial', 'pointer'] as const)('inverts the %s default aim independently of held firing', defaultAimMode => {
    const controls = defaultControls();
    controls.defaultAimMode = defaultAimMode;
    const input = new ActionInput(controls);
    const alternate = defaultAimMode === 'radial' ? 'pointer' : 'radial';
    expect(input.aimMode).toBe(defaultAimMode);
    input.press('Mouse0');
    input.press('Mouse2');
    expect(input.aimMode).toBe(alternate);
    expect(input.snapshot().fireHeld).toBe(true);
    input.release('Mouse2');
    expect(input.aimMode).toBe(defaultAimMode);
    expect(input.snapshot().fireHeld).toBe(true);
    input.release('Mouse0');
    expect(input.snapshot().fireHeld).toBe(false);
  });

  it('toggles aim and firing independently and restores the selected default when cleared', () => {
    const controls = defaultControls();
    controls.defaultAimMode = 'pointer';
    controls.behavior.aimSwitch = 'toggle';
    controls.behavior.fire = 'toggle';
    const input = new ActionInput(controls);
    input.press('Mouse0');
    input.release('Mouse0');
    input.press('Mouse2');
    input.release('Mouse2');
    expect(input.aimMode).toBe('radial');
    expect(input.snapshot().fireHeld).toBe(true);
    input.press('Mouse2');
    expect(input.aimMode).toBe('pointer');
    expect(input.snapshot().fireHeld).toBe(true);
    input.clear();
    expect(input.aimMode).toBe('pointer');
    expect(input.snapshot().fireHeld).toBe(false);
  });

  it('supports mouse and keyboard remaps while keeping Escape available and combined jet bindings inactive', () => {
    const controls = defaultControls();
    controls.bindings.jump = ['Mouse1', 'KeyJ'];
    controls.bindings.fire = ['KeyF', null];
    controls.bindings.pause = ['KeyP', null];
    const input = new ActionInput(controls);
    expect(input.isBound('Space')).toBe(false);
    expect(input.isBound('KeyW')).toBe(false);
    expect(input.actionsFor('Escape')).toEqual(['pause']);
    expect(input.actionsFor('KeyP')).toEqual(['pause']);
    input.press('Mouse1');
    input.press('KeyF');
    expect(input.snapshot()).toMatchObject({ jumpPressed: true, jumpHeld: true, fireHeld: true });
    input.release('Mouse1');
    input.press('KeyJ');
    expect(input.snapshot().jumpHeld).toBe(true);
  });

  it.each(['clear', 'configure'] as const)('%s releases every sustained action and pending command pulse', reset => {
    const controls = defaultControls();
    controls.jetpackSource = 'separate';
    controls.behavior = { movement: 'toggle', crouch: 'toggle', jetpack: 'toggle', fire: 'toggle', aimSwitch: 'toggle' };
    const input = new ActionInput(controls);
    for (const binding of ['KeyA', 'KeyS', 'KeyW', 'Mouse0', 'Mouse2', 'Space', 'KeyR']) input.press(binding);
    if (reset === 'clear') input.clear();
    else input.configure(controls);
    expect(input.snapshot()).toMatchObject({
      moveX: 0, jumpPressed: false, jumpHeld: false, crouchHeld: false, fireHeld: false,
      reloadPressed: false, jetpack: { pressed: false, held: false },
    });
    expect(input.aimMode).toBe('radial');
    expect(input.press('KeyA')).toEqual(['moveLeft']);
    expect(input.snapshot().moveX).toBe(-1);
  });
});

describe('action input and simulation', () => {
  it('preserves combined Hold jump, fresh airborne activation, and release to cut thrust', () => {
    const input = new ActionInput(), world = createWorld(arena);
    input.press('Space');
    expect(tick(input, world).map(event => event.type)).toEqual(['jump']);
    for (let frame = 0; frame < 8; frame++) tick(input, world);
    expect(world.player.thrusting).toBe(false);
    expect(world.player.fuel).toBe(CONFIG.maxFuel);
    input.release('Space');
    tick(input, world);
    input.press('Space');
    tick(input, world);
    expect(world.player.thrusting).toBe(true);
    input.release('Space');
    tick(input, world);
    expect(world.player.thrusting).toBe(false);
  });

  it('clears combined Toggle intent after the first jump, keeps fresh airborne thrust on release, and turns off without hopping', () => {
    const controls = defaultControls();
    controls.behavior.jetpack = 'toggle';
    const input = new ActionInput(controls), world = createWorld(arena);
    input.press('Space');
    tick(input, world);
    expect(input.active('jetpack')).toBe(false);
    expect(input.snapshot().jumpHeld).toBe(true);
    expect(input.press('Space')).toEqual([]);
    tick(input, world);
    expect(world.player.thrusting).toBe(false);
    input.release('Space');
    input.press('Space');
    tick(input, world);
    expect(input.active('jetpack')).toBe(true);
    input.release('Space');
    tick(input, world);
    expect(world.player.thrusting).toBe(true);
    expect(input.snapshot().jumpHeld).toBe(false);
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 1, vy: 360 });
    input.press('Space');
    expect(input.snapshot()).toMatchObject({ jumpPressed: false, jetpack: { pressed: false, held: false } });
    expect(tick(input, world).map(event => event.type)).toEqual(['land']);
    expect(world.player.jumpBufferTicks).toBe(0);
  });

  it.each(['hold', 'toggle'] as const)('preserves the combined %s buffered hop after physical release and clears its thrust intent on jumping', behavior => {
    const controls = defaultControls();
    controls.behavior.jetpack = behavior;
    const input = new ActionInput(controls), world = airborne();
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 50, vy: 360 });
    input.press('Space');
    const events = tick(input, world);
    expect(world.player.jumpBufferTicks).toBeGreaterThan(0);
    input.release('Space');
    for (let frame = 0; frame < CONFIG.jumpBufferTicks; frame++) events.push(...tick(input, world));
    expect(events.map(event => event.type)).toEqual(['land', 'jump']);
    expect(input.active('jetpack')).toBe(false);
    expect(input.snapshot().jumpHeld).toBe(false);
    expect(world.player.fuel).toBe(CONFIG.maxFuel);
  });

  it.each(['hold', 'toggle'] as const)('uses only remaining %s intent when steering misses a buffered landing after release', behavior => {
    const map = { ...arena, platforms: [{ x: 100, y: 500, width: 60, height: 20 }] };
    const controls = defaultControls();
    controls.behavior.jetpack = behavior;
    const input = new ActionInput(controls), world = airborne(map);
    Object.assign(world.player, { x: 155, y: 380, vy: 360 });
    input.press('Space');
    tick(input, world, map);
    expect(world.player.jumpBufferTicks).toBeGreaterThan(0);
    input.release('Space');
    input.press('KeyD');
    for (let frame = 0; frame < CONFIG.jumpBufferTicks; frame++) tick(input, world, map);
    expect(world.player.jumpBufferTicks).toBe(0);
    expect(world.player.thrusting).toBe(behavior === 'toggle');
  });

  it('keeps a queued hop when toggled off before landing without reissuing the jump press', () => {
    const controls = defaultControls();
    controls.behavior.jetpack = 'toggle';
    const input = new ActionInput(controls), world = airborne();
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 50, vy: 360 });
    input.press('Space');
    const events: GameEvent[] = tick(input, world);
    input.release('Space');
    input.press('Space');
    expect(input.snapshot().jumpPressed).toBe(false);
    input.release('Space');
    for (let frame = 0; frame < CONFIG.jumpBufferTicks; frame++) events.push(...tick(input, world));
    expect(events.map(event => event.type)).toEqual(['land', 'jump']);
    expect(input.active('jetpack')).toBe(false);
  });

  it('supports split Toggle ground takeoff and resets on landing until the next fresh press', () => {
    const controls = defaultControls();
    controls.jetpackSource = 'separate';
    controls.behavior.jetpack = 'toggle';
    const input = new ActionInput(controls), world = createWorld(arena);
    input.press('KeyW');
    expect(tick(input, world)).toEqual([]);
    expect(world.player.thrusting).toBe(true);
    expect(world.player.grounded).toBe(false);
    input.release('KeyW');
    tick(input, world);
    expect(world.player.thrusting).toBe(true);
    Object.assign(world.player, { y: arena.floorY - CONFIG.bodyHeight - 1, vy: 400 });
    expect(tick(input, world).map(event => event.type)).toContain('land');
    expect(input.active('jetpack')).toBe(false);
    tick(input, world);
    expect(world.player.grounded).toBe(true);
    input.press('KeyW');
    tick(input, world);
    expect(world.player.thrusting).toBe(true);
  });

  it.each(['combined', 'separate'] as const)('resets %s Toggle on empty fuel and requires a new press after regeneration', source => {
    const controls = defaultControls();
    controls.jetpackSource = source;
    controls.behavior.jetpack = 'toggle';
    const map = { ...arena, height: 10000, floorY: 9880, platforms: [] };
    const input = new ActionInput(controls), world = airborne(map);
    const binding = source === 'combined' ? 'Space' : 'KeyW';
    world.player.fuel = CONFIG.fuelDrain * CONFIG.fixedDt / 2;
    input.press(binding);
    tick(input, world, map);
    expect(world.player.fuel).toBe(0);
    expect(input.active('jetpack')).toBe(false);
    expect(input.press(binding)).toEqual([]);
    input.release(binding);
    for (let frame = 0; frame < CONFIG.fuelDelayTicks + 5; frame++) tick(input, world, map);
    expect(world.player.fuel).toBeGreaterThan(0);
    expect(world.player.thrusting).toBe(false);
    input.press(binding);
    tick(input, world, map);
    expect(world.player.thrusting).toBe(true);
  });
});
