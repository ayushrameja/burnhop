import { CHARACTER_SCALE } from './stance';
import type { PlayerState, WeaponHand, WeaponId, WeaponState } from './types';
export type { WeaponHand, WeaponId, WeaponState } from './types';

export interface WeaponDefinition {
  readonly id: WeaponId; readonly name: string;
  readonly magazineSize: number; readonly reloadTicks: number; readonly cooldownTicks: number;
  readonly damage: number; readonly headMultiplier: number; readonly legMultiplier: number;
  readonly range: number; readonly falloffStart: number; readonly falloffEnd: number; readonly minimumDamageFactor: number;
  readonly spreadDegrees: number; readonly maxSpreadDegrees: number; readonly recoilDegrees: number;
  readonly muzzleLength: number; readonly dualWield: boolean; readonly viewRange: number;
}

function definition(id: WeaponId, name: string, damage: number, headMultiplier: number, magazineSize: number,
  cooldownTicks: number, reloadTicks: number, falloffStart: number, falloffEnd: number, minimumDamageFactor: number,
  range: number, spreadDegrees: number, maxSpreadDegrees: number, recoilDegrees: number,
  artworkMuzzleLength: number, dualWield: boolean, viewRange: number): WeaponDefinition {
  return Object.freeze({ id, name, damage, headMultiplier, legMultiplier: .75, magazineSize, cooldownTicks, reloadTicks,
    falloffStart, falloffEnd, minimumDamageFactor, range, spreadDegrees, maxSpreadDegrees, recoilDegrees,
    muzzleLength: artworkMuzzleLength * CHARACTER_SCALE, dualWield, viewRange });
}

/** Both authority and prediction import this initial, playtestable balance catalog. */
export const WEAPONS: Readonly<Record<WeaponId, WeaponDefinition>> = Object.freeze({
  pistol: definition('pistol', 'Pistol', 18, 1.75, 12, 12, 72, 300, 800, .4, 1000, .45, 1.8, .45, 17, true, 1),
  revolver: definition('revolver', 'Revolver', 42, 2, 6, 30, 132, 500, 1000, .65, 1300, .35, 2, 2.2, 21, false, 1),
  ak47: definition('ak47', 'AK-47', 28, 1.75, 25, 8, 126, 700, 1500, .75, 1900, .6, 3, 1.4, 35, false, 2.5),
  m416: definition('m416', 'M416', 23, 1.75, 30, 7, 114, 800, 1600, .8, 1900, .35, 1.6, .7, 34, false, 2.5),
  uzi: definition('uzi', 'UZI', 15, 1.5, 20, 4, 90, 220, 700, .3, 1000, 1.4, 7, .65, 22, true, 1.5),
  ump: definition('ump', 'UMP', 20, 1.5, 25, 6, 108, 320, 900, .4, 1200, .9, 4.5, .75, 29, true, 1.5),
  sniper: definition('sniper', 'Sniper', 80, 2, 5, 72, 180, 2300, 2300, 1, 2300, .15, .8, 3, 43, false, 4),
});
export const WEAPON_CONFIG = WEAPONS;
export const DUAL_CONFIG = Object.freeze({ cooldownMultiplier: 1.5, spreadMultiplier: 1.6, recoilMultiplier: 1.3, viewRange: 1 });
export const MELEE_CONFIG = Object.freeze({ damage: 20, range: 56, halfArcDegrees: 55, windupTicks: 6,
  cooldownTicks: 36, fireLockTicks: 12, knockbackX: 220, knockbackY: 80, impulseDecaySeconds: .18 });
export const WEAPON_HANDLING = Object.freeze({ equipTicks: 18, bloomShots: 6, bloomRecoveryTicks: 36,
  recoilCapDegrees: 8, recoilRecoveryDegreesPerTick: 12 / 60,
  crouchSpreadMultiplier: .75, airborneSpreadMultiplier: 1.5 });

export function createWeapon(weaponId: WeaponId = 'pistol', instanceId = `initial:${weaponId}`): WeaponState {
  return { weaponId, instanceId, ammo: WEAPONS[weaponId].magazineSize, reserve: weaponId === 'sniper' ? 10 : -1,
    reloadTicks: 0, cooldownTicks: 0, shotCounter: 0, recoil: 0, bloom: 0, reloadQueued: false };
}
export function cloneWeapon(weapon: WeaponState): WeaponState { return { ...weapon }; }
export function equippedWeapons(player: Pick<PlayerState, 'weapon' | 'offhand'>): Array<{ hand: WeaponHand; weapon: WeaponState }> {
  return [{ hand: 'main', weapon: player.weapon }, ...(player.offhand ? [{ hand: 'offhand' as const, weapon: player.offhand }] : [])];
}
export function cancelReload(player: Pick<PlayerState, 'weapon' | 'offhand'>): void {
  for (const { weapon } of equippedWeapons(player)) { weapon.reloadTicks = 0; weapon.reloadQueued = false; }
}
/** Transfer instances, preserving ammunition and longer cooldowns. Null means pairing is incompatible. */
export function equipWeapon(player: PlayerState, incoming: WeaponState, mode: 'single' | 'pair' = 'single'): WeaponState[] | null {
  if (equippedWeapons(player).some(({ weapon }) => weapon.instanceId === incoming.instanceId)) return null;
  if (mode === 'pair' && (!WEAPONS[player.weapon.weaponId].dualWield || !WEAPONS[incoming.weaponId].dualWield)) return null;
  cancelReload(player);
  const weapon = cloneWeapon(incoming);
  weapon.reloadTicks = 0; weapon.reloadQueued = false;
  const dropped = mode === 'single' ? equippedWeapons(player).map(entry => entry.weapon) : player.offhand ? [player.offhand] : [];
  if (mode === 'single') { player.weapon = weapon; player.offhand = null; }
  else player.offhand = weapon;
  player.equipTicks = Math.max(player.equipTicks, WEAPON_HANDLING.equipTicks);
  player.fireHeldLast = false;
  return dropped;
}
/** Dropped weapons use this same clock, so picking up an instance never resets its cooldown. */
export function advanceWeaponTimers(weapon: WeaponState, triggerHeld = false): void {
  weapon.cooldownTicks = Math.max(0, weapon.cooldownTicks - 1);
  if (!triggerHeld) {
    const remaining = Math.max(0, Math.abs(weapon.recoil) - WEAPON_HANDLING.recoilRecoveryDegreesPerTick);
    weapon.recoil = remaining > 0 ? Math.sign(weapon.recoil) * remaining : 0;
    weapon.bloom = Math.max(0, weapon.bloom - 1 / WEAPON_HANDLING.bloomRecoveryTicks);
  }
}

/** Stateless hash: replay and authority produce identical spread without ambient random state. */
export function weaponRandom(instanceId: string, shotCounter: number, channel: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < instanceId.length; i++) hash = Math.imul(hash ^ instanceId.charCodeAt(i), 0x01000193);
  hash = Math.imul(hash ^ shotCounter, 0x85ebca6b);
  hash = Math.imul(hash ^ channel, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}
