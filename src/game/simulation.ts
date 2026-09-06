import { compileTerrain, moveAndCollide, raySolidDistance, rectOverlapsSolid, type CollisionSolid } from './collision';
import { CHARACTER_SCALE, CROUCH_TRANSITION_SECONDS, getDualWeaponOffset, getStanceHeight, getStanceWeaponOffset, STANDING_COLLISION_HEIGHT } from './stance';
import type { Arena, GameEvent, InputCommand, PlayerState, ShotEvent, Vec2, WeaponHand, WeaponState, WorldState } from './types';
import { calculateDamage, isCloserHit, rayHitRegions, resolveMeleeTarget } from './combat';
import { advanceWeaponTimers, cancelReload, cloneWeapon, createWeapon, DUAL_CONFIG, equippedWeapons, MELEE_CONFIG, WEAPON_HANDLING, WEAPONS, weaponRandom } from './weapons';

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
  // Legacy presentation callers use the default weapon; gameplay reads the catalog per instance.
  magazineSize: WEAPONS.pistol.magazineSize,
  shotCooldownTicks: WEAPONS.pistol.cooldownTicks,
  reloadTicks: WEAPONS.pistol.reloadTicks,
  shotDamage: WEAPONS.pistol.damage,
  shotRange: WEAPONS.pistol.range,
  muzzleLength: WEAPONS.pistol.muzzleLength,
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
      weapon: createWeapon('pistol', 'initial:player:pistol'), offhand: null,
      equipTicks: 0, fireLockTicks: 0, fireHeldLast: false, nextShotOffhand: false,
      meleeWindupTicks: 0, meleeCooldownTicks: 0, meleeAimAngle: 0, meleeSequence: 0, impulseX: 0, impulseY: 0,
    },
    target: {
      id: 'target-1', ...arena.targetSpawn, width: CONFIG.bodyWidth, height: CONFIG.bodyHeight,
      health: CONFIG.maxHealth, respawnTicks: 0, hitTicks: 0,
    },
    shotsFired: 0, hits: 0, kills: 0,
  };
}

export function cloneWorld(state: WorldState): WorldState {
  return { ...state, player: cloneActor(state.player), target: { ...state.target } };
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
  player.fireHeldLast = false;
}

export function getWeaponOrigin(player: PlayerState, hand: WeaponHand = 'main'): Vec2 {
  const facing = Math.cos(player.aimAngle) >= 0 ? 1 : -1;
  const offset = getStanceWeaponOffset(player.crouchAmount, facing);
  const dual = player.offhand ? getDualWeaponOffset(hand) : { x: 0, y: 0 };
  return { x: player.x + player.width / 2 + offset.x + dual.x * CHARACTER_SCALE * facing,
    y: player.y + player.height + offset.y + dual.y * CHARACTER_SCALE };
}

export function getMuzzlePosition(player: PlayerState, hand: WeaponHand = 'main'): Vec2 {
  const origin = getWeaponOrigin(player, hand), weapon = hand === 'offhand' ? player.offhand ?? player.weapon : player.weapon;
  const length = WEAPONS[weapon.weaponId].muzzleLength;
  return { x: origin.x + Math.cos(player.aimAngle) * length, y: origin.y + Math.sin(player.aimAngle) * length };
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
  return { ...player, weapon: cloneWeapon(player.weapon), offhand: player.offhand ? cloneWeapon(player.offhand) : null };
}

/** Restore every simulation field, including input latches and weapon timers. */
export function restoreActor<T extends PlayerState>(player: T, snapshot: T): void {
  Object.assign(player, snapshot, { weapon: cloneWeapon(snapshot.weapon), offhand: snapshot.offhand ? cloneWeapon(snapshot.offhand) : null });
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

  const collisions = moveAndCollide(p, { x: (p.vx + p.impulseX) * dt, y: (p.vy + p.impulseY) * dt }, solids, { grounded: p.grounded && !p.thrusting });
  if (collisions.hitX) { p.vx = 0; p.impulseX = 0; }
  if (collisions.hitY) { p.vy = 0; p.impulseY = 0; }
  p.impulseX = approach(p.impulseX, 0, MELEE_CONFIG.knockbackX * dt / MELEE_CONFIG.impulseDecaySeconds);
  p.impulseY = approach(p.impulseY, 0, MELEE_CONFIG.knockbackY * dt / MELEE_CONFIG.impulseDecaySeconds);
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

function fireShot(player: PlayerState, hand: WeaponHand, weapon: WeaponState, solids: readonly CollisionSolid[]): ShotEvent {
  const config = WEAPONS[weapon.weaponId], dual = player.offhand !== null;
  const origin = getWeaponOrigin(player, hand), shotCounter = ++weapon.shotCounter;
  const stanceSpread = player.grounded
    ? 1 - (1 - WEAPON_HANDLING.crouchSpreadMultiplier) * player.crouchAmount
    : WEAPON_HANDLING.airborneSpreadMultiplier;
  const spread = (config.spreadDegrees + (config.maxSpreadDegrees - config.spreadDegrees) * weapon.bloom)
    * stanceSpread * (dual ? DUAL_CONFIG.spreadMultiplier : 1);
  const angle = player.aimAngle + (weapon.recoil + (weaponRandom(weapon.instanceId, shotCounter, 0) * 2 - 1) * spread) * Math.PI / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  let distance = config.range;
  let surface: ShotEvent['surface'];
  for (const solid of solids) {
    const collision = raySolidDistance(origin, direction, solid, distance);
    if (collision !== null && collision <= distance) {
      distance = collision; surface = 'material' in solid ? solid.material : 'rock';
    }
  }
  weapon.ammo--;
  weapon.cooldownTicks = config.cooldownTicks * (dual ? DUAL_CONFIG.cooldownMultiplier : 1);
  weapon.bloom = Math.min(1, weapon.bloom + 1 / WEAPON_HANDLING.bloomShots);
  // The AK wanders in both directions. Other weapons have a steadier, aim-relative upward kick.
  const kickDirection = weapon.weaponId === 'ak47' ? (weaponRandom(weapon.instanceId, shotCounter, 1) < .5 ? -1 : 1)
    : -(Math.cos(player.aimAngle) >= 0 ? 1 : -1);
  const kick = config.recoilDegrees * (dual ? DUAL_CONFIG.recoilMultiplier : 1)
    * kickDirection;
  weapon.recoil = Math.max(-WEAPON_HANDLING.recoilCapDegrees, Math.min(WEAPON_HANDLING.recoilCapDegrees, weapon.recoil + kick));
  const barrelOffset = distance < config.muzzleLength ? 0 : config.muzzleLength;
  return { type: 'shot', weaponId: weapon.weaponId, hand, instanceId: weapon.instanceId, shotCounter,
    originX: origin.x, originY: origin.y, directionX: direction.x, directionY: direction.y, range: config.range, distance,
    x: origin.x + direction.x * barrelOffset, y: origin.y + direction.y * barrelOffset,
    toX: origin.x + direction.x * distance, toY: origin.y + direction.y * distance, hit: false, ...(surface ? { surface } : {}) };
}

function applyPracticeCombat(state: WorldState, events: GameEvent[], solids: readonly CollisionSolid[]): void {
  const confirmations: GameEvent[] = [];
  for (const event of events) {
    if (event.type === 'shot') state.shotsFired++;
    if (state.target.health <= 0) continue;
    let damage = 0, impact: Vec2 | null = null;
    let hit: Extract<GameEvent, { type: 'hit' }> | null = null;
    if (event.type === 'shot') {
      const origin = { x: event.originX, y: event.originY }, direction = { x: event.directionX, y: event.directionY };
      const limit = event.distance;
      const contact = rayHitRegions(origin, direction, state.target, limit);
      // Cover retains exact-distance ties, including a barrel protruding through a wall.
      if (contact && isCloserHit(contact.distance, limit)) {
        damage = calculateDamage(event.weaponId, contact.region, contact.distance);
        impact = { x: origin.x + direction.x * contact.distance, y: origin.y + direction.y * contact.distance };
        event.toX = impact.x; event.toY = impact.y; event.distance = contact.distance; event.hit = true; event.surface = 'body';
        if (contact.distance < WEAPONS[event.weaponId].muzzleLength) { event.x = origin.x; event.y = origin.y; }
        hit = { type: 'hit', ...impact, damage: 0, region: contact.region, weaponId: event.weaponId, hand: event.hand };
      }
    } else if (event.type === 'melee') {
      impact = resolveMeleeTarget(event, { x: Math.cos(event.aimAngle), y: Math.sin(event.aimAngle) }, state.target, solids);
      if (impact) { damage = MELEE_CONFIG.damage; hit = { type: 'hit', ...impact, damage: 0 }; }
    }
    if (!impact || !hit || damage <= 0) continue;
    hit.damage = Math.min(damage, state.target.health);
    state.target.health -= hit.damage; state.target.hitTicks = CONFIG.hitFlashTicks; state.hits++;
    confirmations.push(hit);
    if (state.target.health === 0) {
      state.target.respawnTicks = CONFIG.targetRespawnTicks; state.kills++;
      confirmations.push({ type: 'targetDeath', x: state.target.x + state.target.width / 2, y: state.target.y + state.target.height / 2 });
    }
  }
  events.push(...confirmations);
}

/** Practice recovery is deterministic and keeps accumulated results and inventory. */
function recoverFallenPlayer(state: WorldState, arena: Arena): boolean {
  if (!arena.openFloor || state.player.y <= arena.height) return false;
  Object.assign(state.player, {
    ...arena.playerSpawn, vx: 0, vy: 0, height: CONFIG.bodyHeight, crouchAmount: 0,
    grounded: true, coyoteTicks: CONFIG.coyoteTicks, jumpBufferTicks: 0,
    thrusting: false, thrustLatched: false, impulseX: 0, impulseY: 0,
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
  advanceCombat(state.player, command, events, !recovered, solids);
  applyPracticeCombat(state, events, solids);
  state.tick++;
  return events;
}

function reloadable(weapon: WeaponState): boolean {
  return weapon.ammo < WEAPONS[weapon.weaponId].magazineSize && weapon.reserve !== 0;
}
function reloadEvent(type: 'reloadStart' | 'reloadEnd', player: PlayerState, hand: WeaponHand, weapon: WeaponState): GameEvent {
  const cue = { ...getWeaponOrigin(player, hand), weaponId: weapon.weaponId, hand, instanceId: weapon.instanceId };
  return type === 'reloadStart' ? { ...cue, type: 'reloadStart' } : { ...cue, type: 'reloadEnd' };
}
function beginNextReload(player: PlayerState, events: GameEvent[]): void {
  if (equippedWeapons(player).some(({ weapon }) => weapon.reloadTicks > 0)) return;
  for (const { hand, weapon } of equippedWeapons(player)) {
    if (!weapon.reloadQueued) continue;
    weapon.reloadQueued = false;
    if (!reloadable(weapon)) continue;
    weapon.reloadTicks = WEAPONS[weapon.weaponId].reloadTicks;
    events.push(reloadEvent('reloadStart', player, hand, weapon));
    break;
  }
}
function advanceReload(player: PlayerState, events: GameEvent[]): void {
  const active = equippedWeapons(player).find(({ weapon }) => weapon.reloadTicks > 0);
  if (active && --active.weapon.reloadTicks === 0) {
    const capacity = WEAPONS[active.weapon.weaponId].magazineSize;
    const amount = Math.min(capacity - active.weapon.ammo, active.weapon.reserve < 0 ? capacity : active.weapon.reserve);
    active.weapon.ammo += amount;
    if (active.weapon.reserve >= 0) active.weapon.reserve -= amount;
    events.push(reloadEvent('reloadEnd', player, active.hand, active.weapon));
    beginNextReload(player, events);
  }
}
function meleeEvent(type: 'meleeStart' | 'melee', player: PlayerState): GameEvent {
  return { type, ...getWeaponOrigin(player), aimAngle: player.meleeAimAngle, sequence: player.meleeSequence,
    range: MELEE_CONFIG.range, damage: MELEE_CONFIG.damage };
}

function advanceCombat(player: PlayerState, command: ActorInput, events: GameEvent[], active: boolean, solids: readonly CollisionSolid[]): void {
  player.equipTicks = Math.max(0, player.equipTicks - 1);
  player.fireLockTicks = Math.max(0, player.fireLockTicks - 1);
  player.meleeCooldownTicks = Math.max(0, player.meleeCooldownTicks - 1);
  const shooting = active && command.fireHeld && player.equipTicks === 0 && player.fireLockTicks === 0
    && !equippedWeapons(player).some(({ weapon }) => weapon.reloadTicks > 0 || weapon.reloadQueued);
  for (const { weapon } of equippedWeapons(player)) advanceWeaponTimers(weapon, shooting && weapon.ammo > 0);
  advanceReload(player, events);
  if (player.meleeWindupTicks > 0 && --player.meleeWindupTicks === 0 && active) events.push(meleeEvent('melee', player));
  if (active && command.punchPressed && player.meleeCooldownTicks === 0 && player.equipTicks === 0) {
    cancelReload(player);
    player.meleeAimAngle = player.aimAngle; player.meleeSequence++;
    player.meleeWindupTicks = MELEE_CONFIG.windupTicks;
    player.meleeCooldownTicks = MELEE_CONFIG.cooldownTicks;
    player.fireLockTicks = Math.max(player.fireLockTicks, MELEE_CONFIG.fireLockTicks);
    events.push(meleeEvent('meleeStart', player));
  }
  if (active && command.reloadPressed && player.equipTicks === 0 && player.fireLockTicks === 0
    && !equippedWeapons(player).some(({ weapon }) => weapon.reloadTicks > 0 || weapon.reloadQueued)) {
    for (const { weapon } of equippedWeapons(player)) weapon.reloadQueued = reloadable(weapon);
    beginNextReload(player, events);
  }
  const canFire = active && command.fireHeld && player.equipTicks === 0 && player.fireLockTicks === 0
    && !equippedWeapons(player).some(({ weapon }) => weapon.reloadTicks > 0 || weapon.reloadQueued);
  if (canFire) {
    let hands = equippedWeapons(player);
    const ready = ({ weapon }: typeof hands[number]) => weapon.cooldownTicks === 0 && weapon.ammo > 0;
    if (!player.fireHeldLast && player.offhand) {
      // A tap fires one ready hand, remembering the other for the next tap.
      // Only an actual shot starts the stagger; empty/cooling hands cannot starve their partner.
      const preferred = hands[player.nextShotOffhand ? 1 : 0];
      const first = ready(preferred) ? preferred : hands.find(ready);
      if (first) {
        const other = hands.find(entry => entry.hand !== first.hand)!;
        const interval = Math.min(WEAPONS[first.weapon.weaponId].cooldownTicks, WEAPONS[other.weapon.weaponId].cooldownTicks)
          * DUAL_CONFIG.cooldownMultiplier;
        other.weapon.cooldownTicks = Math.max(other.weapon.cooldownTicks, Math.floor(interval / 2));
        hands = [first, other];
      }
    }
    for (const { hand, weapon } of hands) {
      if (weapon.cooldownTicks === 0 && weapon.ammo > 0) {
        events.push(fireShot(player, hand, weapon, solids));
        player.nextShotOffhand = hand === 'main';
      }
      else if (!player.fireHeldLast && weapon.ammo === 0) events.push({ type: 'dryfire', ...getWeaponOrigin(player, hand),
        weaponId: weapon.weaponId, hand, instanceId: weapon.instanceId });
    }
  }
  // Releasing or locking the trigger keeps the next hand, including across reloads and pause.
  player.fireHeldLast = canFire;
}

/** Shared deterministic actor step: presentation may predict intents; only authority resolves hits. */
export function stepActor(player: PlayerState, command: ActorInput, arena: CompiledArena): GameEvent[] {
  const events: GameEvent[] = [];
  if (player.health <= 0) return events;
  updateMovement(player, command, arena.solids, events);
  advanceCombat(player, command, events, true, arena.solids);
  return events;
}
