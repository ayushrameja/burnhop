import { expect, it } from 'vitest';
import { retainHud } from './hud';
import type { HudState } from './types';

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
