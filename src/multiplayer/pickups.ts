import { raySolidDistance } from '../game/collision';
import type { CompiledArena } from '../game/simulation';
import { advanceWeaponTimers, cloneWeapon, createWeapon, equipWeapon, WEAPONS, type WeaponId } from '../game/weapons';
import type { WeaponState } from '../game/types';
import { MATCH_CONFIG, type ActorEvent, type MatchPlayer, type MatchState, type NetworkInput, type WeaponPickup } from './model';
import { PICKUP_CONFIG } from './pickupConfig';
export { PICKUP_CONFIG } from './pickupConfig';

const ordinary: readonly WeaponId[] = ['pistol', 'revolver', 'ak47', 'm416', 'uzi', 'ump'];

function random(state: MatchState): number {
  let n = state.pickupSeed | 0;
  n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
  state.pickupSeed = n >>> 0;
  return state.pickupSeed / 0x100000000;
}
function nextWeapon(state: MatchState): WeaponState {
  if (!state.weaponBag.length) {
    state.weaponBag = [...ordinary];
    for (let i = state.weaponBag.length - 1; i > 0; i--) {
      const j = Math.floor(random(state) * (i + 1));
      [state.weaponBag[i], state.weaponBag[j]] = [state.weaponBag[j], state.weaponBag[i]];
    }
  }
  return createWeapon(state.weaponBag.pop()!, `pickup:${state.code}:${++state.pickupSequence}`);
}
export function resetPickups(state: MatchState, map: CompiledArena): void {
  state.pickups = {}; state.weaponBag = []; state.dropScheduleIndex = 0; state.sniperWarningTicks = 0;
  for (const pad of map.arena.pickupPads ?? []) {
    if (pad.kind !== 'ordinary') continue;
    state.pickups[pad.id] = { id: pad.id, x: pad.x, y: pad.y - 18, weapon: nextWeapon(state),
      available: true, kind: 'pad', respawnTicks: 0, expiresTicks: 0, createdTick: state.tick };
  }
}
export function sniperExists(state: MatchState): boolean {
  return Object.values(state.pickups).some(p => p.available && p.weapon.weaponId === 'sniper')
    || Object.values(state.players).some(p => p.health > 0 && p.weapon.weaponId === 'sniper');
}
function roomEvent(state: MatchState, type: 'sniperWarning' | 'sniperDrop', x: number, y: number): ActorEvent {
  return { type, x, y, id: `${state.tick}:supply:${type}`, actorId: '', lifeId: 0 };
}
export function advancePickups(state: MatchState, map: CompiledArena, events: ActorEvent[]): void {
  for (const pickup of Object.values(state.pickups)) {
    if (pickup.available) {
      advanceWeaponTimers(pickup.weapon);
      if (pickup.kind !== 'pad' && --pickup.expiresTicks <= 0) delete state.pickups[pickup.id];
    } else if (pickup.kind === 'pad' && --pickup.respawnTicks <= 0) {
      pickup.weapon = nextWeapon(state); pickup.available = true; pickup.respawnTicks = 0;
    }
  }
  const elapsed = MATCH_CONFIG.durationTicks - state.remainingTicks;
  const at = PICKUP_CONFIG.sniperTimes[state.dropScheduleIndex];
  const pad = map.arena.pickupPads?.find(p => p.kind === 'sniper');
  const previousWarning = state.sniperWarningTicks;
  state.sniperWarningTicks = 0;
  if (at === undefined || !pad) return;
  if (elapsed >= at - PICKUP_CONFIG.warningTicks && elapsed < at && !sniperExists(state)) {
    state.sniperWarningTicks = at - elapsed;
    if (previousWarning === 0) events.push(roomEvent(state, 'sniperWarning', pad.x, pad.y - 18));
  }
  if (elapsed >= at) {
    state.dropScheduleIndex++;
    if (sniperExists(state)) return;
    const id = `sniper:${state.code}:${++state.pickupSequence}`;
    state.pickups[id] = { id, x: pad.x, y: pad.y - 18, weapon: createWeapon('sniper', id), available: true,
      kind: 'sniper', respawnTicks: 0, expiresTicks: PICKUP_CONFIG.sniperExpiryTicks, createdTick: state.tick };
    events.push(roomEvent(state, 'sniperDrop', pad.x, pad.y - 18));
  }
}

export function pickupDistance(player: Pick<MatchPlayer, 'x' | 'y' | 'width' | 'height'>,
  pickup: Pick<WeaponPickup, 'x' | 'y' | 'available'>, map: CompiledArena): number | null {
  if (!pickup.available) return null;
  const origin = { x: player.x + player.width / 2, y: player.y + player.height / 2 };
  const dx = pickup.x - origin.x, dy = pickup.y - origin.y, distance = Math.hypot(dx, dy);
  if (distance > PICKUP_CONFIG.reach) return null;
  if (distance > 0 && map.solids.some(solid => {
    const hit = raySolidDistance(origin, { x: dx / distance, y: dy / distance }, solid, distance);
    return hit !== null && hit < distance;
  })) return null;
  return distance;
}

export function dropWeapons(state: MatchState, player: MatchPlayer, weapons: WeaponState[]): void {
  for (const source of weapons) {
    const weapon = cloneWeapon(source);
    weapon.reloadTicks = 0; weapon.reloadQueued = false;
    const id = `dropped:${state.code}:${++state.pickupSequence}`;
    state.pickups[id] = { id, x: player.x + player.width / 2, y: player.y + player.height - 18,
      weapon, available: true, kind: 'dropped', respawnTicks: 0,
      expiresTicks: weapon.weaponId === 'sniper' ? PICKUP_CONFIG.sniperExpiryTicks : PICKUP_CONFIG.dropTicks,
      createdTick: state.tick };
  }
  const ordinaryDrops = Object.values(state.pickups).filter(p => p.kind === 'dropped' && p.weapon.weaponId !== 'sniper')
    .sort((a, b) => a.createdTick - b.createdTick || a.id.localeCompare(b.id));
  for (const pickup of ordinaryDrops.slice(0, Math.max(0, ordinaryDrops.length - PICKUP_CONFIG.maxDropped))) delete state.pickups[pickup.id];
}

/** Freeze candidates before transferring anything; a newly dropped gun cannot be collected in this tick. */
export function collectPickups(state: MatchState, inputs: Readonly<Record<string, NetworkInput | undefined>>,
  map: CompiledArena, events: ActorEvent[]): void {
  const attempts: Array<{ player: MatchPlayer; pickup: WeaponPickup; distance: number; pair: boolean }> = [];
  for (const player of Object.values(state.players)) {
    const input = inputs[player.id];
    if (!player.connected || player.health <= 0 || !(input?.pickupPressed || input?.pairPressed)) continue;
    const nearby = Object.values(state.pickups).map(pickup => ({ pickup, distance: pickupDistance(player, pickup, map) }))
      .filter((p): p is { pickup: WeaponPickup; distance: number } => p.distance !== null)
      .sort((a, b) => a.distance - b.distance || a.pickup.id.localeCompare(b.pickup.id));
    if (nearby[0]) attempts.push({ player, ...nearby[0], pair: !input.pickupPressed && !!input.pairPressed });
  }
  attempts.sort((a, b) => a.distance - b.distance || a.player.joinedOrder - b.player.joinedOrder || a.player.id.localeCompare(b.player.id));
  for (const { player, pickup, pair } of attempts) {
    if (!pickup.available || state.pickups[pickup.id] !== pickup) continue;
    if (pair && (!WEAPONS[player.weapon.weaponId].dualWield || !WEAPONS[pickup.weapon.weaponId].dualWield)) continue;
    const dropped = equipWeapon(player, pickup.weapon, pair ? 'pair' : 'single');
    if (dropped === null) continue;
    pickup.available = false;
    if (pickup.kind === 'pad') pickup.respawnTicks = PICKUP_CONFIG.refillTicks;
    else delete state.pickups[pickup.id];
    dropWeapons(state, player, dropped);
    events.push({ type: 'pickup', id: `${state.tick}:${player.id}:pickup`, actorId: player.id, lifeId: player.lifeId,
      x: pickup.x, y: pickup.y, weaponId: pickup.weapon.weaponId, instanceId: pickup.weapon.instanceId, hand: pair ? 'offhand' : 'main' });
  }
}
