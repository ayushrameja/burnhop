import { compileTerrain, moveAndCollide, rayRectDistance, raySolidDistance, rectOverlapsSolid, type CollisionSolid } from './collision';
import { CHARACTER_SCALE, CROUCH_TRANSITION_SECONDS, getStanceHeight, getStanceWeaponOffset, STANDING_COLLISION_HEIGHT } from './stance';
import type { Arena, GameEvent, InputCommand, PlayerState, Vec2, WorldState } from './types';

/** All gameplay quantities use world pixels, seconds, or explicitly named ticks. */
export const CONFIG = Object.freeze({
  fixedDt: 1 / 60,
  bodyWidth: 36,
  bodyHeight: STANDING_COLLISION_HEIGHT,
  moveSpeed: 320,
  groundAcceleration: 3800,
  airAcceleration: 2300,
  groundBraking: 4200,
  airBraking: 320,
  gravity: 1500,
  jumpSpeed: 520,
  jetAcceleration: 3600,
  jetFullPowerFuelFraction: 0.9,
  jetEndPowerFraction: 0.5,
  maxRiseSpeed: 480,
  maxFallSpeed: 740,
  coyoteTicks: 8,
  jumpBufferTicks: 9,
  maxFuel: 100,
  fuelDrain: 40 / 1.4,
  fuelRegen: 30,
  fuelDelayTicks: 24,
  maxHealth: 100,
  magazineSize: 30,
  shotCooldownTicks: 6,
  reloadTicks: 72,
  shotDamage: 20,
  shotRange: 1900,
  muzzleLength: 28 * CHARACTER_SCALE,
  targetRespawnTicks: 120,
  hitFlashTicks: 8,
});

export function createWorld(arena: Arena): WorldState {
  return {
    tick: 0,
    player: {
      id: 'player', ...arena.playerSpawn, width: CONFIG.bodyWidth, height: CONFIG.bodyHeight,
      vx: 0, vy: 0, grounded: true, coyoteTicks: CONFIG.coyoteTicks, jumpBufferTicks: 0,
      aimAngle: 0, crouchAmount: 0, health: CONFIG.maxHealth, fuel: CONFIG.maxFuel,
      thrusting: false, thrustLatched: false, fuelDelayTicks: 0,
      weapon: { ammo: CONFIG.magazineSize, reloadTicks: 0, cooldownTicks: 0 },
    },
    target: {
      id: 'target-1', ...arena.targetSpawn, width: CONFIG.bodyWidth, height: CONFIG.bodyHeight,
      health: CONFIG.maxHealth, respawnTicks: 0, hitTicks: 0,
    },
    shotsFired: 0, hits: 0, kills: 0,
  };
}

export function cloneWorld(state: WorldState): WorldState {
  return { ...state, player: { ...state.player, weapon: { ...state.player.weapon } }, target: { ...state.target } };
}

/** Releases persistent control intent when pausing or detaching an input source.
 * Physical stance, momentum and timers remain frozen. Resumed ticks release crouch with clearance checks.
 */
export function releasePlayerInput(state: WorldState): void {
  releaseActorInput(state.player);
}

export function releaseActorInput(player: PlayerState): void {
  player.thrusting = false;
  player.thrustLatched = false;
  player.jumpBufferTicks = 0;
}

export function getWeaponOrigin(player: PlayerState): Vec2 {
  const offset = getStanceWeaponOffset(player.crouchAmount, Math.cos(player.aimAngle) >= 0 ? 1 : -1);
  return { x: player.x + player.width / 2 + offset.x, y: player.y + player.height + offset.y };
}

export function getMuzzlePosition(player: PlayerState): Vec2 {
  const origin = getWeaponOrigin(player);
  return { x: origin.x + Math.cos(player.aimAngle) * CONFIG.muzzleLength, y: origin.y + Math.sin(player.aimAngle) * CONFIG.muzzleLength };
}

export interface CompiledArena { readonly arena: Arena; readonly solids: readonly CollisionSolid[] }
const compiledArenas = new WeakMap<Arena, CompiledArena>();

/** Compile immutable collision contours and bounds once per authored arena. */
export function compileArena(arena: Arena): CompiledArena {
  const cached = compiledArenas.get(arena);
  if (cached) return cached;
  for (const polygon of arena.terrain ?? []) compileTerrain(polygon);
  const solids: readonly CollisionSolid[] = Object.freeze([
    ...arena.platforms,
    ...(arena.terrain ?? []),
    ...(arena.openFloor ? [] : [{ x: -arena.width, y: arena.floorY, width: arena.width * 3, height: arena.height * 2 }]),
    { x: -arena.width, y: -arena.height, width: arena.width, height: arena.height * 3 },
    { x: arena.width, y: -arena.height, width: arena.width, height: arena.height * 3 },
    { x: -arena.width, y: -arena.height, width: arena.width * 3, height: arena.height },
  ]);
  const compiled = Object.freeze({ arena, solids });
  compiledArenas.set(arena, compiled);
  return compiled;
}

export function cloneActor<T extends PlayerState>(player: T): T {
  return { ...player, weapon: { ...player.weapon } };
}

/** Restore every simulation field, including input latches and weapon timers. */
export function restoreActor<T extends PlayerState>(player: T, snapshot: T): void {
  Object.assign(player, snapshot, { weapon: { ...snapshot.weapon } });
}

export type ActorInput = Omit<InputCommand, 'tick' | 'actorId'>;

function approach(value: number, target: number, amount: number) {
  return value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
}

/** Resize upward from the feet; blocked expansion retries on every future tick. */
function updateStance(player: PlayerState, command: ActorInput, solids: readonly CollisionSolid[]) {
  const separateJetIntent = command.jetpack?.source === 'separate' && command.jetpack.held;
  const target = player.grounded && command.crouchHeld && !command.jumpPressed && !command.jumpHeld
    && !separateJetIntent && player.jumpBufferTicks === 0 ? 1 : 0;
  const nextAmount = approach(player.crouchAmount, target, CONFIG.fixedDt / CROUCH_TRANSITION_SECONDS);
  if (nextAmount === player.crouchAmount) return;
  const height = getStanceHeight(nextAmount);
  const feetY = player.y + player.height;
  const y = feetY - height;
  if (height > player.height && solids.some(solid =>
    rectOverlapsSolid({ x: player.x, y, width: player.width, height }, solid),
  )) return;
  player.crouchAmount = nextAmount;
  player.height = height;
  player.y = y;
}

/** Fuel controls engine force, not velocity: the final thrust still opposes gravity. */
export function getJetAcceleration(fuel: number): number {
  const ramp = Math.max(0, Math.min(1, fuel / CONFIG.maxFuel / CONFIG.jetFullPowerFuelFraction));
  return CONFIG.jetAcceleration * (CONFIG.jetEndPowerFraction + (1 - CONFIG.jetEndPowerFraction) * ramp);
}

function jump(player: PlayerState, events: GameEvent[], preserveThrust = false) {
  player.vy = -CONFIG.jumpSpeed;
  player.grounded = false;
  player.coyoteTicks = 0;
  player.jumpBufferTicks = 0;
  if (!preserveThrust) {
    player.thrustLatched = false;
    player.thrusting = false;
  }
  events.push({ type: 'jump', x: player.x + player.width / 2, y: player.y + player.height });
}

/** Reserve a descending press for hopping only when its actual path reaches a surface.
 * Probing horizontal motion too avoids treating a nearby platform edge as a landing.
 */
function landingWithinBuffer(player: PlayerState, moveX: InputCommand['moveX'], solids: readonly CollisionSolid[]): boolean {
  if (player.vy < 0) return false;
  const probe = { ...player };
  for (let i = 0; i < CONFIG.jumpBufferTicks; i++) {
    probe.vx = approach(probe.vx, moveX * CONFIG.moveSpeed,
      (moveX ? CONFIG.airAcceleration : CONFIG.airBraking) * CONFIG.fixedDt);
    probe.vy = Math.min(CONFIG.maxFallSpeed, probe.vy + CONFIG.gravity * CONFIG.fixedDt);
    const collision = moveAndCollide(probe, { x: probe.vx * CONFIG.fixedDt, y: probe.vy * CONFIG.fixedDt }, solids);
    if (collision.grounded) return true;
    if (collision.hitX) probe.vx = 0;
    if (collision.hitY) probe.vy = 0;
  }
  return false;
}

function updateMovement(p: PlayerState, command: ActorInput, solids: readonly CollisionSolid[], events: GameEvent[]) {
  const dt = CONFIG.fixedDt;
  const jetpack = command.jetpack ?? { source: 'combined', pressed: command.jumpPressed, held: command.jumpHeld };
  const separateJetpack = jetpack.source === 'separate';
  const wasGrounded = p.grounded;
  p.coyoteTicks = wasGrounded ? CONFIG.coyoteTicks : Math.max(0, p.coyoteTicks - 1);
  p.aimAngle = command.aimAngle;
  updateStance(p, command, solids);
  p.fuelDelayTicks = Math.max(0, p.fuelDelayTicks - 1);
  if (!jetpack.held) p.thrustLatched = false;

  let jumpConsumedPress = false;
  let jumpedThisTick = false;
  if (command.jumpPressed) {
    if (wasGrounded || p.coyoteTicks > 0) {
      jump(p, events, separateJetpack);
      jumpConsumedPress = true;
      jumpedThisTick = true;
    } else if (landingWithinBuffer(p, command.moveX, solids)) {
      p.jumpBufferTicks = CONFIG.jumpBufferTicks;
      if (!separateJetpack) p.thrustLatched = false;
      jumpConsumedPress = true;
    }
  }
  if (jetpack.pressed && jetpack.held && p.fuel > 0
    && (separateJetpack || (!jumpConsumedPress && !p.grounded))) {
    if (!separateJetpack) p.jumpBufferTicks = 0;
    p.thrustLatched = true;
  }

  const acceleration = command.moveX
    ? (p.grounded ? CONFIG.groundAcceleration : CONFIG.airAcceleration)
    : (p.grounded ? CONFIG.groundBraking : CONFIG.airBraking);
  const moveSpeed = CONFIG.moveSpeed * (p.grounded ? 1 - 0.5 * p.crouchAmount : 1);
  p.vx = approach(p.vx, command.moveX * moveSpeed, acceleration * dt);

  p.thrusting = p.thrustLatched && jetpack.held && (separateJetpack || !p.grounded) && p.fuel > 0;
  let jetFraction = 0;
  let jetAcceleration = 0;
  if (p.thrusting) {
    // Direct takeoff spends ledge grace too; it must not grant an extra midair jump.
    if (separateJetpack && p.grounded) p.coyoteTicks = 0;
    const fuelUsed = Math.min(p.fuel, CONFIG.fuelDrain * dt);
    // Sample the fuel midpoint for a smooth taper, including the final partial tick.
    jetAcceleration = getJetAcceleration(p.fuel - fuelUsed / 2);
    jetFraction = fuelUsed / (CONFIG.fuelDrain * dt);
    p.fuel = Math.max(0, p.fuel - fuelUsed);
    p.fuelDelayTicks = CONFIG.fuelDelayTicks;
    if (p.fuel < 1e-8) { p.fuel = 0; p.thrustLatched = false; p.thrusting = false; }
  } else if (p.fuelDelayTicks === 0) {
    p.fuel = Math.min(CONFIG.maxFuel, p.fuel + CONFIG.fuelRegen * dt);
  }
  p.vy = Math.min(CONFIG.maxFallSpeed, p.vy + (CONFIG.gravity - jetAcceleration * jetFraction) * dt);
  // A jump starts faster than sustained flight; do not clamp its first frame.
  if (jetFraction > 0 && !jumpedThisTick) p.vy = Math.max(-CONFIG.maxRiseSpeed, p.vy);

  const collisions = moveAndCollide(p, { x: p.vx * dt, y: p.vy * dt }, solids, { grounded: p.grounded && !p.thrusting });
  if (collisions.hitX) p.vx = 0;
  if (collisions.hitY) p.vy = 0;
  p.grounded = collisions.grounded;
  if (p.grounded) {
    p.thrustLatched = false; p.thrusting = false;
    p.coyoteTicks = CONFIG.coyoteTicks;
    if (!wasGrounded) events.push({ type: 'land', x: p.x + p.width / 2, y: p.y + p.height });
    if (p.jumpBufferTicks > 0) jump(p, events);
  }
  if (p.jumpBufferTicks > 0 && --p.jumpBufferTicks === 0) {
    // Only a combined press may become thrust when steering misses its queued landing.
    if (!separateJetpack) p.thrustLatched = jetpack.held && !p.grounded && p.fuel > 0;
  }
}

function fireShot(state: WorldState, solids: readonly CollisionSolid[], events: GameEvent[]) {
  const p = state.player, target = state.target;
  const origin = getWeaponOrigin(p);
  const direction = { x: Math.cos(p.aimAngle), y: Math.sin(p.aimAngle) };
  let distance: number = CONFIG.shotRange;
  for (const solid of solids) {
    const collision = raySolidDistance(origin, direction, solid, distance);
    if (collision !== null) distance = Math.min(distance, collision);
  }
  const targetDistance = target.health > 0 ? rayRectDistance(origin, direction, target, distance) : null;
  // A tie belongs to cover. Casting from the hand also blocks a protruding muzzle.
  const hit = targetDistance !== null && targetDistance < distance;
  if (hit) distance = targetDistance;
  const impact = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
  const barrelOffset = distance < CONFIG.muzzleLength ? 0 : CONFIG.muzzleLength;
  events.push({ type: 'shot', x: origin.x + direction.x * barrelOffset, y: origin.y + direction.y * barrelOffset, toX: impact.x, toY: impact.y, hit });
  p.weapon.ammo--;
  p.weapon.cooldownTicks = CONFIG.shotCooldownTicks;
  state.shotsFired++;
  if (hit) {
    const damage = Math.min(CONFIG.shotDamage, target.health);
    target.health -= damage;
    target.hitTicks = CONFIG.hitFlashTicks;
    state.hits++;
    events.push({ type: 'hit', ...impact, damage });
    if (target.health === 0) {
      target.respawnTicks = CONFIG.targetRespawnTicks;
      state.kills++;
      events.push({ type: 'targetDeath', x: target.x + target.width / 2, y: target.y + target.height / 2 });
    }
  }
}

/** Practice recovery is deterministic and keeps accumulated results and inventory. */
function recoverFallenPlayer(state: WorldState, arena: Arena): boolean {
  if (!arena.openFloor || state.player.y <= arena.height) return false;
  Object.assign(state.player, {
    ...arena.playerSpawn, vx: 0, vy: 0, height: CONFIG.bodyHeight, crouchAmount: 0,
    grounded: true, coyoteTicks: CONFIG.coyoteTicks, jumpBufferTicks: 0,
    thrusting: false, thrustLatched: false,
  });
  return true;
}

/** Authoritative fixed tick: no rendering, wall clock, browser APIs, or random state. */
export function stepSimulation(state: WorldState, command: InputCommand, arena: Arena): GameEvent[] {
  if (command.tick !== state.tick) throw new Error(`Expected command tick ${state.tick}, received ${command.tick}`);
  if (command.actorId !== state.player.id) throw new Error(`Unknown actor: ${command.actorId}`);
  const events: GameEvent[] = [], solids = compileArena(arena).solids;
  const target = state.target;
  target.hitTicks = Math.max(0, target.hitTicks - 1);
  if (target.respawnTicks > 0 && --target.respawnTicks === 0) {
    target.health = CONFIG.maxHealth;
    target.x = arena.targetSpawn.x; target.y = arena.targetSpawn.y;
    target.hitTicks = 0;
    events.push({ type: 'targetRespawn', x: target.x + target.width / 2, y: target.y + target.height / 2 });
  }
  let recovered = recoverFallenPlayer(state, arena);
  if (!recovered) {
    updateMovement(state.player, command, solids, events);
    recovered = recoverFallenPlayer(state, arena);
  }
  advanceWeapon(state.player, command, events, !recovered, () => fireShot(state, solids, events));
  state.tick++;
  return events;
}

function advanceWeapon(player: PlayerState, command: ActorInput, events: GameEvent[], active: boolean, fire: () => void): void {
  const weapon = player.weapon;
  weapon.cooldownTicks = Math.max(0, weapon.cooldownTicks - 1);
  if (weapon.reloadTicks > 0 && --weapon.reloadTicks === 0) {
    weapon.ammo = CONFIG.magazineSize;
    events.push({ type: 'reloadEnd', ...getWeaponOrigin(player) });
  }
  if (active && command.reloadPressed && weapon.reloadTicks === 0 && weapon.ammo < CONFIG.magazineSize) {
    weapon.reloadTicks = CONFIG.reloadTicks;
    events.push({ type: 'reloadStart', ...getWeaponOrigin(player) });
  }
  if (active && command.fireHeld && weapon.reloadTicks === 0 && weapon.cooldownTicks === 0 && weapon.ammo > 0) fire();
}

/** A single actor tick. Shots are intents clipped to terrain; only the match authority applies damage. */
export function stepActor(player: PlayerState, command: ActorInput, arena: CompiledArena): GameEvent[] {
  const events: GameEvent[] = [];
  if (player.health <= 0) return events;
  updateMovement(player, command, arena.solids, events);
  advanceWeapon(player, command, events, true, () => {
    const origin = getWeaponOrigin(player);
    const direction = { x: Math.cos(player.aimAngle), y: Math.sin(player.aimAngle) };
    let distance: number = CONFIG.shotRange;
    for (const solid of arena.solids) {
      const collision = raySolidDistance(origin, direction, solid, distance);
      if (collision !== null) distance = Math.min(distance, collision);
    }
    const barrelOffset = distance < CONFIG.muzzleLength ? 0 : CONFIG.muzzleLength;
    events.push({ type: 'shot', x: origin.x + direction.x * barrelOffset, y: origin.y + direction.y * barrelOffset,
      toX: origin.x + direction.x * distance, toY: origin.y + direction.y * distance, hit: false });
    player.weapon.ammo--;
    player.weapon.cooldownTicks = CONFIG.shotCooldownTicks;
  });
  return events;
}
