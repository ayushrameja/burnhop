import { describe, expect, it } from 'vitest';
import range from '../../public/assets/arena.json';
import outpost from '../../public/assets/outpost.json';
import type { Arena } from './types';
import { moveAndCollide, rectOverlapsSolid } from './collision';
import { collectPracticeWeapon, createPracticeWeaponPickups, nearestPracticeWeapon } from './practiceWeapons';
import { compileArena, createWorld } from './simulation';
import { WEAPONS } from './weapons';

describe('practice weapon stations', () => {
  it.each([['range', range], ['outpost', outpost]] as const)('places every weapon on reachable %s ground and equips replenishable copies', (_name, data) => {
    const arena = data as Arena, map = compileArena(arena);
    const pickups = createPracticeWeaponPickups(arena), player = createWorld(arena).player;
    expect(pickups.map(p => p.weaponId).sort()).toEqual(Object.keys(WEAPONS).sort());
    for (const [tick, pickup] of pickups.entries()) {
      player.x = pickup.x - player.width / 2;
      expect(map.solids.some(solid => rectOverlapsSolid(player, solid))).toBe(false);
      expect(moveAndCollide(player, { x: 0, y: 1 }, map.solids).grounded).toBe(true);
      expect(nearestPracticeWeapon(player, pickups, map)).toBe(pickup);
      expect(collectPracticeWeapon(player, pickup, { tick, pickupPressed: true })).toMatchObject({ type: 'pickup', weaponId: pickup.weaponId });
      expect(player.weapon).toMatchObject({ ammo: WEAPONS[pickup.weaponId].magazineSize, reserve: -1, reloadTicks: 0 });
      expect(player.offhand).toBeNull();
      expect(pickup.available).toBe(true);
    }
  });
  it('pairs fresh instances from one station and cancels reloads when switching to a rifle', () => {
    const pickups = createPracticeWeaponPickups(range), player = createWorld(range).player;
    const pistol = pickups.find(p => p.weaponId === 'pistol')!, rifle = pickups.find(p => p.weaponId === 'ak47')!;
    collectPracticeWeapon(player, pistol, { tick: 1, pickupPressed: true });
    player.weapon.ammo = 3; player.weapon.reloadTicks = 30;
    collectPracticeWeapon(player, pistol, { tick: 2, pairPressed: true });
    expect(player.weapon.ammo).toBe(3);
    expect(player.weapon.reloadTicks).toBe(0);
    expect(player.offhand!.instanceId).not.toBe(player.weapon.instanceId);
    expect(player.offhand!.ammo).toBe(12);
    expect(collectPracticeWeapon(player, rifle, { tick: 3, pairPressed: true })).toBeNull();
    expect(player.offhand!.weaponId).toBe('pistol');
    collectPracticeWeapon(player, rifle, { tick: 4, pickupPressed: true, pairPressed: true });
    expect(player.weapon.weaponId).toBe('ak47'); expect(player.offhand).toBeNull();
  });
  it('requires a pickup command and reach, respecting solid cover and unsupported terrain maps', () => {
    const pickups = createPracticeWeaponPickups(range), player = createWorld(range).player;
    expect(collectPracticeWeapon(player, pickups[0], { tick: 1 })).toBeNull();
    player.x = 1800;
    expect(nearestPracticeWeapon(player, pickups, compileArena(range))).toBeUndefined();
    player.x = pickups[0].x - player.width / 2 - 35;
    const blocked = { ...range, platforms: [...range.platforms, { x: pickups[0].x - 15, y: range.floorY - 100, width: 8, height: 100 }] };
    expect(nearestPracticeWeapon(player, pickups, compileArena(blocked))).toBeUndefined();
    expect(createPracticeWeaponPickups({ ...range, openFloor: true })).toEqual([]);
  });
});
