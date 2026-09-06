import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import outpost from '../public/assets/outpost.json' with { type: 'json' };
import range from '../public/assets/arena.json' with { type: 'json' };
import { enterMenu, enterPractice, fixtureState, installCapture, moveAim, openMenu } from './helpers/capture';

const screenshots = 'docs/screenshots/outpost';
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });
test.beforeEach(async ({ page }) => { await installCapture(page); });

async function snapshot(page: Page) { return page.evaluate(() => window.__BURNHOP__!.snapshot()); }
async function ticks(page: Page, count: number) {
  const until = (await snapshot(page)).tick + count;
  await page.waitForFunction(until => window.__BURNHOP__!.snapshot().tick >= until, until);
}
async function menuFromPlay(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
}
async function expectArena(page: Page, arena: typeof outpost | typeof range, name: string) {
  await expect(page.getByTestId('arena-name')).toHaveText(name);
  const world = await snapshot(page);
  expect(world.player.x).toBeCloseTo(arena.playerSpawn.x, 4);
  expect(world.player.y).toBeCloseTo(arena.playerSpawn.y, 2);
  expect(world.target.x).toBeCloseTo(arena.targetSpawn.x, 4);
  expect(world.target.y).toBeCloseTo(arena.targetSpawn.y, 4);
}

test('Outpost selection loads its real geometry and supports movement, combat, pause and restart', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/outpost.json', async route => { await held; await route.continue(); });
  await openMenu(page);
  await expect(page.getByRole('radio', { name: 'Practice range', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Outpost', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Enter practice', exact: true })).toContainText('Outpost');
  await expect(page.locator('.arena-preview img')).toHaveJSProperty('complete', true);
  await page.screenshot({ path: `${screenshots}/menu.png` });
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await expect(page.getByTestId('loading-screen')).toHaveAttribute('aria-label', 'Loading outpost');
  await expect(page.getByRole('heading', { name: 'OUTPOST', exact: true })).toBeVisible();
  release();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await expectArena(page, outpost, 'Outpost');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('zoom-level')).toContainText('1x');
  await ticks(page, 18);
  await page.screenshot({ path: `${screenshots}/gameplay.png` });

  const start = await snapshot(page);
  await page.keyboard.down('KeyD');
  await ticks(page, 18);
  await page.keyboard.up('KeyD');
  expect((await snapshot(page)).player.x).toBeGreaterThan(start.player.x + 50);
  await page.keyboard.down('Space');
  await ticks(page, 14);
  const jump = await snapshot(page);
  expect(jump.player.y).toBeLessThan(start.player.y - 40);
  expect(jump.player.fuel).toBe(100);
  expect(jump.player.thrusting).toBe(false);
  await page.keyboard.up('Space');
  await ticks(page, 2);
  await page.keyboard.down('Space');
  await ticks(page, 24);
  const flight = await snapshot(page);
  expect(flight.player.thrusting).toBe(true);
  expect(flight.player.fuel).toBeLessThan(95);
  await moveAim(page, 1000, 390);
  await page.mouse.down();
  await ticks(page, 10);
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await snapshot(page)).shotsFired).toBeGreaterThan(0);
  expect((await snapshot(page)).player.weapon.ammo).toBeLessThan(12);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.reloadTicks > 0);
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.ammo === 12);

  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-arena')).toHaveText('Outpost');
  const paused = await snapshot(page);
  await page.waitForTimeout(150);
  expect((await snapshot(page)).tick).toBe(paused.tick);
  await page.getByRole('button', { name: 'Restart practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__!.metrics().running);
  await expectArena(page, outpost, 'Outpost');
  expect((await snapshot(page)).shotsFired).toBe(0);
  expect((await snapshot(page)).player.weapon.ammo).toBe(12);
  await expect(page.getByTestId('zoom-level')).toContainText('1x');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('switching Outpost to range and back uses the selected arena and keeps separate caches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMenu(page, '/?map=outpost');
  await enterPractice(page);
  await expectArena(page, outpost, 'Outpost');
  await menuFromPlay(page);
  await page.getByRole('radio', { name: 'Practice range', exact: true }).check();
  await enterPractice(page);
  await expectArena(page, range, 'Practice range');
  await menuFromPlay(page);
  await page.getByRole('radio', { name: 'Outpost', exact: true }).check();
  await enterPractice(page);
  await expectArena(page, outpost, 'Outpost');
  const calls = (await fixtureState(page)).calls;
  expect(calls.filter(call => call === 'fetch:/assets/outpost.json')).toHaveLength(1);
  expect(calls.filter(call => call === 'fetch:/assets/arena.json')).toHaveLength(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('invalid Outpost geometry presents a recoverable loading error and retry loads corrected data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let invalid = true;
  await page.route('**/assets/outpost.json', route => invalid ? route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ...outpost, terrain: [{ id: 'bad', material: 'rock', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }] }] }),
  }) : route.continue());
  await openMenu(page, '/?map=outpost');
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The arena geometry is invalid');
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  invalid = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await expectArena(page, outpost, 'Outpost');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('direct map selection keeps fullscreen entry and a canceled Outpost request cannot replace range', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/outpost.json', async route => { await held; await route.continue(); });
  await page.goto('/?map=outpost');
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  expect((await fixtureState(page)).calls).not.toContain('fetch:/assets/outpost.json');
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  await enterMenu(page);
  await expect(page.getByRole('radio', { name: 'Outpost', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await expect(page.getByTestId('loading-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('radio', { name: 'Practice range', exact: true }).check();
  await enterPractice(page);
  await expectArena(page, range, 'Practice range');
  const response = page.waitForResponse('**/assets/outpost.json');
  release();
  await response;
  await ticks(page, 20);
  await expectArena(page, range, 'Practice range');
  await expect(page.getByTestId('loading-screen')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
