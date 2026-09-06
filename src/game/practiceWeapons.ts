import { pickupDistance } from '../multiplayer/pickups';
import type { CompiledArena } from './simulation';
import { createWeapon, equipWeapon, WEAPONS } from './weapons';
import type { Arena, GameEvent, InputCommand, PlayerState, WeaponId } from './types';

export interface PracticeWeaponPickup {
  id: string; weaponId: WeaponId; x: number; y: number; available: boolean; label: string;
}

/** Permanent, fully stocked stations beside each supported practice spawn. */
export function createPracticeWeaponPickups(arena: Arena): PracticeWeaponPickup[] {
  const outpost = arena.id === 'outpost';
  if (!outpost && (arena.openFloor || arena.terrain?.length)) return [];
  const weapons: WeaponId[] = ['pistol', 'revolver', 'uzi', 'ump', 'ak47', 'm416', 'sniper'];
  // Outpost's western courtyard is flat from x=128.8 to 543.2 at y=1300.
  // Keep the rack on that ledge, before the raised rock and tunnel edge.
  const spacing = outpost ? 58 : Math.min(110, (arena.width - 120) / (weapons.length - 1));
  const start = outpost ? 166 : Math.max(60, Math.min(arena.playerSpawn.x - spacing * 2.5, arena.width - 60 - spacing * 6));
  const groundY = outpost ? 1300 : arena.floorY;
  return weapons.map((weaponId, index) => ({ id: `practice-rack:${weaponId}`, weaponId,
    x: start + index * spacing, y: groundY - 18, available: true, label: WEAPONS[weaponId].name }));
}

export function nearestPracticeWeapon(player: PlayerState, pickups: readonly PracticeWeaponPickup[], arena: CompiledArena): PracticeWeaponPickup | undefined {
  return pickups.map(pickup => ({ pickup, distance: pickupDistance(player, pickup, arena) }))
    .filter((entry): entry is { pickup: PracticeWeaponPickup; distance: number } => entry.distance !== null)
    .sort((a, b) => a.distance - b.distance || a.pickup.id.localeCompare(b.pickup.id))[0]?.pickup;
}

export function collectPracticeWeapon(player: PlayerState, pickup: PracticeWeaponPickup | undefined,
  command: Pick<InputCommand, 'pickupPressed' | 'pairPressed' | 'tick'>): Extract<GameEvent, { type: 'pickup' }> | null {
  if (!pickup || player.health <= 0 || !(command.pickupPressed || command.pairPressed)) return null;
  const pair = !command.pickupPressed && !!command.pairPressed;
  if (pair && (!WEAPONS[player.weapon.weaponId].dualWield || !WEAPONS[pickup.weaponId].dualWield)) return null;
  const weapon = createWeapon(pickup.weaponId, `${pickup.id}:${command.tick}`);
  weapon.reserve = -1; // Practice stations are replenishable, including the sniper.
  if (!equipWeapon(player, weapon, pair ? 'pair' : 'single')) return null;
  return { type: 'pickup', x: pickup.x, y: pickup.y, weaponId: weapon.weaponId,
    instanceId: weapon.instanceId, hand: pair ? 'offhand' : 'main' };
}
