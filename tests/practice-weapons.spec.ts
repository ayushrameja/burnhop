import { test, expect, type Page } from '@playwright/test';
import { enterPractice, installCapture, openMenu } from './helpers/capture';
import { WEAPONS, type WeaponId } from '../src/game/weapons';

async function walkTo(page: Page, weaponId: WeaponId) {
  const { target, x } = await page.evaluate(id => {
    const api = window.__BURNHOP__!, player = api.snapshot().player;
    return { target: api.pickups().find(p => p.weaponId === id)!.x - player.width / 2, x: player.x };
  }, weaponId);
  const right = target > x, key = right ? 'KeyD' : 'KeyA';
  if (Math.abs(target - x) > 8) {
    await page.keyboard.down(key);
    await page.waitForFunction(({ target, right }) => {
      const x = window.__BURNHOP__!.snapshot().player.x;
      return right ? x >= target - 4 : x <= target + 4;
    }, { target, right });
    await page.keyboard.up(key);
  }
  await expect(page.locator('.combat-pickup-prompt')).toContainText(WEAPONS[weaponId].name);
}

for (const arena of ['range', 'outpost']) {
test.describe(`${arena} practice stations`, () => {
test.beforeEach(async ({ page }) => { await installCapture(page); await openMenu(page, `/?map=${arena}`); await enterPractice(page); });

test('all seven spawned weapons can be reached, equipped and fired, and remain stocked after restart', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const pickups = await page.evaluate(() => window.__BURNHOP__!.pickups());
  expect(pickups.map(p => p.weaponId).sort()).toEqual(Object.keys(WEAPONS).sort());
  await page.screenshot({ path: info.outputPath('practice-weapon-stations.png') });
  for (const pickup of pickups) {
    await walkTo(page, pickup.weaponId);
    await expect(page.locator('.combat-pickup-prompt')).toContainText('F Equip alone');
    await page.keyboard.press('KeyF');
    await page.waitForFunction(id => {
      const p = window.__BURNHOP__!.snapshot().player;
      return p.weapon.weaponId === id && p.equipTicks === 0;
    }, pickup.weaponId);
    const before = await page.evaluate(() => window.__BURNHOP__!.snapshot().shotsFired);
    await page.getByTestId('game-canvas').hover(); await page.mouse.down();
    await page.waitForFunction(before => window.__BURNHOP__!.snapshot().shotsFired > before, before);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.weapon.reserve)).toBe(-1);
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Restart practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__!.metrics().running);
  expect(await page.evaluate(() => window.__BURNHOP__!.pickups())).toEqual(pickups);
  expect(errors).toEqual([]);
});

test('Q pairs fresh pistols from a station and F replaces the pair with a rifle', async ({ page }) => {
  await walkTo(page, 'pistol'); await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.instanceId.startsWith('practice-rack:pistol:'));
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.offhand?.weaponId === 'pistol');
  const dual = await page.evaluate(() => window.__BURNHOP__!.snapshot().player);
  expect(dual.weapon.instanceId).not.toBe(dual.offhand!.instanceId);
  await walkTo(page, 'ak47');
  await expect(page.locator('.combat-pickup-prompt')).not.toContainText('Pair');
  await page.keyboard.press('KeyQ');
  await expect(page.locator('.combat-pickup-prompt')).toContainText('Pairing needs a handgun or SMG');
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.weapon.weaponId)).toBe('pistol');
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.weaponId === 'ak47');
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.offhand)).toBeNull();
});
});
}
