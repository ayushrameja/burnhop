import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import outpost from '../public/assets/outpost.json' with { type: 'json' };
import range from '../public/assets/arena.json' with { type: 'json' };
import { enterPractice, fixtureState, installCapture, moveAim, openMenu } from './helpers/capture';

const screenshots = 'docs/screenshots/ui-readability';
const viewports = [{ width: 1440, height: 900 }, { width: 2560, height: 1440 }, { width: 390, height: 844 }];
type Box = { x: number; y: number; width: number; height: number };

test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });
test.beforeEach(async ({ page }) => { await installCapture(page); });

async function snapshot(page: Page) { return page.evaluate(() => window.__BURNHOP__!.snapshot()); }
async function ticks(page: Page, count: number) {
  const until = (await snapshot(page)).tick + count;
  await page.waitForFunction(until => window.__BURNHOP__!.snapshot().tick >= until, until);
}
async function box(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}
function withinViewport(bounds: Box, viewport: { width: number; height: number }) {
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}
function doNotOverlap(a: Box, b: Box) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  expect(width <= 0.5 || height <= 0.5, `Overlapping UI: ${JSON.stringify({ a, b })}`).toBe(true);
}
async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - innerWidth,
    vertical: document.documentElement.scrollHeight - innerHeight,
  }))).toMatchObject({ horizontal: 0, vertical: 0 });
}
async function selectedCard(page: Page, name: 'Practice range' | 'Outpost') {
  const selected = page.getByRole('radio', { name, exact: true });
  await expect(selected).toBeChecked();
  const label = page.locator('.arena-option').filter({ has: selected });
  await expect(label.getByText('SELECTED', { exact: true })).toBeVisible();
  const otherName = name === 'Outpost' ? 'Practice range' : 'Outpost';
  const other = page.getByRole('radio', { name: otherName, exact: true });
  await expect(other).not.toBeChecked();
  await expect(page.locator('.arena-option').filter({ has: other }).getByText('SELECTED', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter practice', exact: true })).toContainText(name);
}

for (const viewport of viewports) {
  test(`map cards, launch, and edge HUD stay readable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openMenu(page, '/?map=outpost');
    await page.evaluate(() => document.fonts.ready);
    await selectedCard(page, 'Outpost');
    const cards = page.locator('.arena-card');
    await expect(cards).toHaveCount(2);
    const [left, right, launch] = await Promise.all([
      box(cards.nth(0)), box(cards.nth(1)), box(page.getByRole('button', { name: 'Enter practice', exact: true })),
    ]);
    for (const bounds of [left, right, launch]) withinViewport(bounds, viewport);
    doNotOverlap(left, right);
    doNotOverlap(left, launch);
    doNotOverlap(right, launch);
    expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(2);
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
    const cardsBottom = Math.max(left.y + left.height, right.y + right.height);
    expect(launch.y).toBeGreaterThanOrEqual(cardsBottom);
    expect(launch.y - cardsBottom).toBeLessThan(120);
    expect(await page.locator('.arena-selector').evaluate(element => element.nextElementSibling?.matches('.launch-button'))).toBe(true);
    await noPageOverflow(page);
    await page.screenshot({ path: `${screenshots}/menu-${viewport.width}x${viewport.height}.png` });

    await enterPractice(page);
    await expect(page.getByTestId('arena-name')).toHaveText('Outpost');
    await expect(page.getByTestId('hud-health')).toHaveText('100');
    await expect(page.getByTestId('hud-fuel')).toHaveText('100');
    await expect(page.getByTestId('hud-ammo')).toHaveText('30');
    await expect(page.getByRole('meter', { name: 'Health', exact: true })).toHaveAttribute('aria-valuenow', '100');
    await expect(page.getByRole('meter', { name: 'Jet fuel', exact: true })).toHaveAttribute('aria-valuenow', '100');
    const pilot = await box(page.locator('.pilot-hud'));
    const ammo = await box(page.getByRole('region', { name: 'Ammunition', exact: true }));
    const fuel = await box(page.getByRole('meter', { name: 'Jet fuel', exact: true }));
    const health = await box(page.getByRole('meter', { name: 'Health', exact: true }));
    for (const bounds of [pilot, ammo, fuel, health]) withinViewport(bounds, viewport);
    doNotOverlap(pilot, ammo);
    doNotOverlap(fuel, health);
    expect(pilot.x + pilot.width).toBeLessThan(viewport.width / 2);
    expect(ammo.x).toBeGreaterThan(viewport.width / 2);
    expect(pilot.y).toBeGreaterThan(viewport.height * 0.65);
    expect(ammo.y).toBeGreaterThan(viewport.height * 0.65);
    // The central aiming area remains free of both HUD clusters at every size.
    const aimingArea = { x: viewport.width * 0.35, y: viewport.height * 0.25, width: viewport.width * 0.3, height: viewport.height * 0.4 };
    doNotOverlap(pilot, aimingArea);
    doNotOverlap(ammo, aimingArea);
    for (const id of ['hud-fuel', 'hud-ammo']) {
      expect(await page.getByTestId(id).evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(32);
    }
    await noPageOverflow(page);
    await page.screenshot({ path: `${screenshots}/hud-${viewport.width}x${viewport.height}.png` });
  });
}

test('keyboard radio selection updates the selected badge, launch destination, URL, and actual arena', async ({ page }) => {
  await openMenu(page);
  const rangeRadio = page.getByRole('radio', { name: 'Practice range', exact: true });
  const outpostRadio = page.getByRole('radio', { name: 'Outpost', exact: true });
  await selectedCard(page, 'Practice range');
  await rangeRadio.focus();
  await page.keyboard.press('ArrowRight');
  await expect(outpostRadio).toBeFocused();
  await selectedCard(page, 'Outpost');
  await expect(page).toHaveURL(/\?map=outpost$/);
  await page.keyboard.press('ArrowLeft');
  await expect(rangeRadio).toBeFocused();
  await selectedCard(page, 'Practice range');
  expect(new URL(page.url()).searchParams.has('map')).toBe(false);
  await page.keyboard.press('ArrowRight');
  await selectedCard(page, 'Outpost');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Enter practice', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await expect(page.getByTestId('arena-name')).toHaveText('Outpost');
  expect((await snapshot(page)).player.x).toBeCloseTo(outpost.playerSpawn.x);
  expect((await fixtureState(page)).calls).toContain('fetch:/assets/outpost.json');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expect(outpostRadio).toBeChecked();
  await outpostRadio.focus();
  await page.keyboard.press('ArrowLeft');
  await selectedCard(page, 'Practice range');
  expect(new URL(page.url()).searchParams.has('map')).toBe(false);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Enter practice', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await expect(page.getByTestId('arena-name')).toHaveText('Practice range');
  expect((await snapshot(page)).player.x).toBeCloseTo(range.playerSpawn.x);
  expect((await fixtureState(page)).calls).toContain('fetch:/assets/arena.json');
});

test('fuel gauge follows real keyboard flight through burning, low, empty, and recharge states', async ({ page }) => {
  await openMenu(page);
  await enterPractice(page);
  const meter = page.getByRole('meter', { name: 'Jet fuel', exact: true });
  await expect(meter).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('.pilot-fuel-segment[data-filled="true"]')).toHaveCount(12);
  await page.keyboard.down('Space');
  await ticks(page, 14);
  await page.keyboard.up('Space');
  await ticks(page, 2);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => {
    const player = window.__BURNHOP__!.snapshot().player;
    return player.thrusting && player.fuel < 75 && player.fuel > 60;
  });
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeLessThan(76);
  const burningSegments = await page.locator('.pilot-fuel-segment[data-filled="true"]').count();
  expect(burningSegments).toBeGreaterThan(0);
  expect(burningSegments).toBeLessThan(12);
  await page.screenshot({ path: `${screenshots}/fuel-burning.png` });
  await expect(page.locator('.pilot-fuel-warning')).toHaveText('LOW FUEL', { timeout: 8000 });
  await expect(page.locator('.pilot-hud')).toHaveAttribute('data-fuel-warning', 'true');
  expect((await snapshot(page)).player.fuel).toBeLessThan(20);
  await page.screenshot({ path: `${screenshots}/fuel-low.png` });
  await expect(page.locator('.pilot-fuel-warning')).toHaveText('FUEL EMPTY', { timeout: 4000 });
  await expect(page.getByTestId('hud-fuel')).toHaveText('0');
  await expect(page.locator('.pilot-fuel-segment[data-filled="true"]')).toHaveCount(0);
  expect((await snapshot(page)).player.thrusting).toBe(false);
  await page.screenshot({ path: `${screenshots}/fuel-empty.png` });
  await page.keyboard.up('Space');
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 6000 }).toBeGreaterThan(30);
  await expect(page.locator('.pilot-fuel-warning')).toBeEmpty();
  await expect(page.locator('.pilot-hud')).toHaveAttribute('data-fuel-warning', 'false');
  expect((await snapshot(page)).player.thrusting).toBe(false);
  await expect(page.getByTestId('hud-health')).toHaveText('100');
  await page.screenshot({ path: `${screenshots}/fuel-recharging.png` });
});

test('ammo count, empty warning, and reload progress follow real shooting and keyboard reload', async ({ page }) => {
  await openMenu(page);
  await enterPractice(page);
  const ammo = page.getByRole('region', { name: 'Ammunition', exact: true });
  await expect(page.getByTestId('hud-ammo')).toHaveText('30');
  await moveAim(page, 1100, 400);
  await page.mouse.down();
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.ammo <= 5);
  await page.mouse.up();
  await expect(ammo).toHaveAttribute('data-ammo-warning', 'true');
  await expect(ammo.getByRole('status')).toHaveText('LOW AMMO');
  const remaining = (await snapshot(page)).player.weapon.ammo;
  await expect(page.getByTestId('hud-ammo')).toHaveText(remaining.toString().padStart(2, '0'));
  await page.screenshot({ path: `${screenshots}/ammo-low.png` });
  await page.mouse.down();
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.ammo === 0);
  await page.mouse.up();
  await expect(page.getByTestId('hud-ammo')).toHaveText('00');
  await expect(ammo.getByRole('status')).toHaveText('RELOAD REQUIRED');
  await page.screenshot({ path: `${screenshots}/ammo-empty.png` });
  await page.keyboard.press('KeyR');
  await expect(ammo).toHaveAttribute('data-reloading', 'true');
  await expect(ammo.getByRole('status')).toHaveText('RELOADING');
  const progress = page.getByRole('progressbar', { name: 'Reloading', exact: true });
  await expect(progress).toBeVisible();
  await expect.poll(async () => Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(10);
  const firstProgress = Number(await progress.getAttribute('aria-valuenow'));
  await ticks(page, 10);
  expect(Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(firstProgress);
  await page.screenshot({ path: `${screenshots}/ammo-reloading.png` });
  await expect(page.getByTestId('hud-ammo')).toHaveText('30');
  await expect(ammo).toHaveAttribute('data-reloading', 'false');
  await expect(ammo).toHaveAttribute('data-ammo-warning', 'false');
  await expect(progress).toHaveCount(0);
  expect((await snapshot(page)).player.weapon.ammo).toBe(30);
  await expect(page.getByTestId('hud-health')).toHaveText('100');
  await page.screenshot({ path: `${screenshots}/ammo-reloaded.png` });
});
