import { test, expect, type Page } from '@playwright/test';
import { installCapture, openMenu, enterPractice, moveAim } from './helpers/capture';
import { choosePracticeLoadout, cycleViewTo } from './helpers/combat';

test.beforeEach(async ({ page }) => { await installCapture(page); });
async function enter(page: Page) { await openMenu(page); await enterPractice(page); }
async function ticks(page: Page, count: number) {
  const until = await page.evaluate(count => window.__BURNHOP__!.snapshot().tick + count, count);
  await page.waitForFunction(until => window.__BURNHOP__!.snapshot().tick >= until, until);
}

test('starting pistol, each weapon view cap, and visible dual magazines use actual loadout controls', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await enter(page);
  await expect(page.getByTestId('hud-ammo')).toHaveText('12');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__BURNHOP__!.camera().zoomLevel)).toBe(1);
  await choosePracticeLoadout(page, 'ak47'); await cycleViewTo(page, 2.5);
  await expect(page.getByTestId('hud-ammo')).toHaveText('25');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__BURNHOP__!.camera().zoomLevel)).toBe(1);
  await choosePracticeLoadout(page, 'sniper'); await cycleViewTo(page, 4);
  await expect(page.getByLabel('10 reserve rounds', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('sniper-wide-view.png') });
  await choosePracticeLoadout(page, 'ump'); await cycleViewTo(page, 1.5);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__BURNHOP__!.camera().zoomLevel)).toBe(1);
  await choosePracticeLoadout(page, 'pistol', 'uzi'); await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__BURNHOP__!.camera().zoomLevel)).toBe(1);
  await expect(page.locator('.ammo-row')).toHaveCount(2);
  await expect(page.getByTestId('hud-ammo')).toHaveText('12');
  await expect(page.getByTestId('hud-offhand-ammo')).toHaveText('20');
  await page.screenshot({ path: testInfo.outputPath('mixed-dual-hud.png') });
  expect(errors).toEqual([]);
});

test('one trigger fires both hands and sequential reload fills their separate magazines', async ({ page }, testInfo) => {
  await enter(page); await choosePracticeLoadout(page, 'pistol', 'uzi');
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  await moveAim(page, box.x + box.width * .7, box.y + box.height * .3);
  await page.mouse.down(); await ticks(page, 20); await page.mouse.up();
  const fired = await page.evaluate(() => window.__BURNHOP__!.snapshot().player);
  expect(fired.weapon.shotCounter).toBeGreaterThan(0); expect(fired.offhand!.shotCounter).toBeGreaterThan(0);
  expect(fired.weapon.ammo).toBeLessThan(12); expect(fired.offhand!.ammo).toBeLessThan(20);
  await page.keyboard.press('KeyR');
  await expect(page.getByRole('progressbar', { name: 'Reloading', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Offhand reloading', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('hud-ammo')).toHaveText('12');
  await page.screenshot({ path: testInfo.outputPath('dual-sequential-reload.png') });
  await expect(page.getByTestId('hud-offhand-ammo')).toHaveText('20', { timeout: 5000 });
});

test('F punches through the normal input path and the practice target loses twenty health', async ({ page }, testInfo) => {
  await enter(page);
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => { const { player, target } = window.__BURNHOP__!.snapshot(); return target.x - player.x < 58; });
  await page.keyboard.up('KeyD'); await ticks(page, 8);
  const contact = await page.evaluate(() => {
    const api = window.__BURNHOP__!, target = api.snapshot().target;
    return api.toScreen(target.x + target.width / 2, target.y + target.height / 2);
  });
  await moveAim(page, contact.x, contact.y);
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().target.health === 80);
  const result = await page.evaluate(() => window.__BURNHOP__!.snapshot());
  expect(result.player.meleeSequence).toBe(1); expect(result.shotsFired).toBe(0); expect(result.player.weapon.ammo).toBe(12);
  await page.screenshot({ path: testInfo.outputPath('punch-contact.png') });
});

test('new pickup, pairing and punch actions expose their E Q F defaults and can be rebound', async ({ page }) => {
  await openMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  for (const [action, key] of [['Equip weapon alone', 'E'], ['Pair weapon', 'Q'], ['Punch', 'F']]) {
    await expect(page.getByRole('button', { name: `Change ${action} primary binding`, exact: true })).toContainText(key);
  }
  await page.getByRole('button', { name: 'Change Punch primary binding', exact: true }).click();
  await page.keyboard.press('KeyG');
  await expect(page.getByRole('button', { name: 'Change Punch primary binding', exact: true })).toContainText('G');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await enterPractice(page); await page.keyboard.press('KeyG');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.meleeSequence === 1);
});
