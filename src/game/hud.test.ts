import { expect, it } from 'vitest';
import { getCombatHud,retainHud } from './hud';
import type { HudState } from './types';
import { createWorld } from './simulation';
import arena from '../../public/assets/arena.json';
import { createWeapon,WEAPONS } from './weapons';

it('skips unchanged HUD values without hiding fuel warnings, segments or reload transitions', () => {
  const hud: HudState = { health: 100, fuel: 20, ammo: 30, reloadProgress: -1, shotsFired: 0, hits: 0, kills: 0, targetHealth: 100 };
  expect(retainHud(hud, { ...hud })).toBe(hud);
  expect(retainHud({ ...hud, fuel: 90.8 }, { ...hud, fuel: 90.5 }).fuel).toBe(90.8);
  for (const fuel of [19.99, 16.65, 0]) {
    const next = { ...hud, fuel }; expect(retainHud(hud, next)).toBe(next);
  }
  const segment = { ...hud, fuel: 16.65 };
  expect(retainHud({ ...hud, fuel: 16.8 }, segment)).toBe(segment);
  const reload = { ...hud, reloadProgress: 0 };
  expect(retainHud(hud, reload)).toBe(reload);
  expect(retainHud(reload, hud)).toBe(hud);
});

it('uses equipment-specific capacity, reload clocks and finite sniper reserve without hiding offhand changes',()=>{
  const player=createWorld(arena).player;player.weapon=createWeapon('sniper');player.weapon.reloadTicks=90;
  const sniper=getCombatHud(player);
  expect(sniper).toMatchObject({weaponId:'sniper',magazineSize:5,reserve:10,reloadProgress:.5});
  player.weapon=createWeapon('pistol');player.offhand=createWeapon('uzi');player.offhand.ammo=2;
  player.offhand.reloadTicks=WEAPONS.uzi.reloadTicks/2;
  const dual=getCombatHud(player);
  expect(dual).toMatchObject({magazineSize:12,offhand:{weaponId:'uzi',ammo:2,magazineSize:20,reloadProgress:.5}});
  expect(retainHud(dual,getCombatHud(player))).toBe(dual);
  player.offhand.ammo=3;const changed=getCombatHud(player);
  expect(retainHud(dual,changed)).toBe(changed);
  for(const next of [{...dual,pickupPrompt:'E · Equip AK-47'},{...dual,sniperWarning:'Drop inbound'},{...dual,damageSequence:1},{...dual,killSequence:1}])expect(retainHud(dual,next)).toBe(next);
});
