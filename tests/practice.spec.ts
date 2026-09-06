import { installCapture, openMenu, enterMenu, moveAim } from './helpers/capture';
import { choosePracticeLoadout, cycleViewTo } from './helpers/combat';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await installCapture(page); });

const screenshots = 'docs/screenshots';
test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });
async function enter(page: Page) {
  await openMenu(page);
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
}
async function snapshot(page: Page) { return page.evaluate(() => window.__BURNHOP__!.snapshot()); }
async function advanceTicks(page: Page, count: number) {
  const tick = (await snapshot(page)).tick;
  await page.waitForFunction(t => window.__BURNHOP__!.snapshot().tick >= t, tick + count);
}
async function aimTarget(page: Page) {
  const position = await page.evaluate(() => {
    const api = window.__BURNHOP__!;
    const target = api.snapshot().target;
    return api.toScreen(target.x + target.width / 2, target.y + target.height / 2);
  });
  await moveAim(page, position.x, position.y);
}

test('entry precedes real loading and a failed asset can be retried', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/range-banner.svg', async route => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await enterMenu(page);
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await expect(page.getByTestId('loading-screen')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await expect(page.getByTestId('loading-screen')).toBeVisible();
  await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow', '100');
  await page.screenshot({ path: `${screenshots}/01-loading.png` });
  release();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await page.unroute('**/assets/range-banner.svg');
  let fail = true;
  await page.route('**/assets/insignia.svg', route => fail ? route.abort() : route.continue());
  await page.reload();
  await enterMenu(page);
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await expect(page.getByTestId('capture-overlay')).toHaveCount(0);
});

test('menu, customization persistence, and an unobstructed practice view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('low-altitude-settings', JSON.stringify({
      cosmetics: { headgear: 1, shirt: 2, trousers: 1 },
      muted: true,
      reducedMotion: true,
    }));
  });
  await openMenu(page);
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await expect(page).toHaveTitle('Burnhop · Outpost 07');
  await expect(page.getByRole('button', { name: 'Enter practice', exact: true })).toBeVisible();
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('burnhop-settings')!));
  expect(migrated).toMatchObject({
    version: 3, appearance: { headgearColor: 'sand', topColor: 'slate', trousersColor: 'sand' },
    muted: true,
    reducedMotion: true,
  });
  await page.screenshot({ path: `${screenshots}/02-menu.png` });
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await expect(page.getByTestId('character-creator')).toBeVisible();
  await page.screenshot({ path: `${screenshots}/03-customization.png` });
  const saved = await page.evaluate(() => localStorage.getItem('burnhop-settings'));
  expect(JSON.parse(saved!).appearance.headgearColor).toBe('sand');
  await page.reload();
  await enterMenu(page);
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('burnhop-settings')!));
  expect(restored.appearance).toEqual(migrated.appearance);
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await advanceTicks(page, 20);
  await page.screenshot({ path: `${screenshots}/04-practice.png` });
  await expect(page.getByTestId('hud-health')).toHaveText('100');
  await expect(page.getByTestId('hud-ammo')).toBeVisible();
  await expect(page.getByTestId('hud-fuel')).toBeVisible();
  expect(await page.locator('.combat-hud').evaluate(el => { const r = el.getBoundingClientRect(); return r.width * r.height / (innerWidth * innerHeight); })).toBeLessThan(.04);
  expect(errors).toEqual([]);
});

test('keyboard jump, held Shift thrust, fuel depletion, landing and flight fire', async ({ page }) => {
  await enter(page);
  const start = await snapshot(page);
  await page.keyboard.down('KeyD');
  await advanceTicks(page, 18);
  await page.keyboard.up('KeyD');
  expect((await snapshot(page)).player.x).toBeGreaterThan(start.player.x + 50);
  await page.keyboard.down('Space');
  await advanceTicks(page, 14);
  const jump = await snapshot(page);
  expect(jump.player.y).toBeLessThan(start.player.y - 40);
  expect(jump.player.fuel).toBe(100);
  expect(jump.player.thrusting).toBe(false);
  await page.keyboard.up('Space');
  await advanceTicks(page, 2);
  await page.keyboard.down('ShiftLeft');
  await advanceTicks(page, 24);
  const flight = await snapshot(page);
  expect(flight.player.thrusting).toBe(true);
  expect(flight.player.fuel).toBeLessThan(95);
  // A following camera can move the ground target offscreen during flight.
  const canvas = await page.getByTestId('game-canvas').boundingBox();
  await moveAim(page, canvas!.x + canvas!.width * .7, canvas!.y + canvas!.height * .45);
  await page.mouse.down();
  await advanceTicks(page, 8);
  await page.mouse.up();
  expect((await snapshot(page)).shotsFired).toBeGreaterThan(0);
  await page.screenshot({ path: `${screenshots}/05-flight.png` });
  await advanceTicks(page, 205);
  expect((await snapshot(page)).player.thrusting).toBe(false);
  await advanceTicks(page, 35);
  const resting = await snapshot(page);
  expect(resting.player.fuel).toBeGreaterThan(0);
  expect(resting.player.thrusting).toBe(false);
  await page.keyboard.up('ShiftLeft');
});

test('early landing presses chain bunny hops without spending jet fuel', async ({ page }) => {
  await enter(page);
  const floorY = (await snapshot(page)).player.y;
  await page.keyboard.press('Space');
  for (let hop = 0; hop < 3; hop++) {
    await page.waitForFunction(floor => {
      const p = window.__BURNHOP__!.snapshot().player;
      return !p.grounded && p.vy > 100 && p.y > floor - 45;
    }, floorY);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.vy < -100);
    expect((await snapshot(page)).player.fuel).toBe(100);
  }
  await page.screenshot({ path: `${screenshots}/10-bunny-hop.png` });
});

test('aiming, target death and respawn, reload, resize, pause and focus recovery', async ({ page }) => {
  await enter(page);
  await choosePracticeLoadout(page, 'm416');
  await cycleViewTo(page, 2.5);
  await aimTarget(page);
  await page.mouse.down();
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().kills >= 1);
  await page.mouse.up();
  const killed = await snapshot(page);
  expect(killed.target.health).toBe(0);
  expect(killed.hits).toBeGreaterThanOrEqual(5);
  await page.screenshot({ path: `${screenshots}/06-target-hit.png` });
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.reloadTicks > 0);
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.ammo === 30);
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().target.health === 100);
  await page.setViewportSize({ width: 1024, height: 768 });
  await advanceTicks(page, 20);
  await aimTarget(page);
  await page.mouse.down();
  const hits = (await snapshot(page)).hits;
  await page.waitForFunction(h => window.__BURNHOP__!.snapshot().hits > h, hits);
  await page.mouse.up();
  await page.screenshot({ path: `${screenshots}/07-resized.png` });
  await page.keyboard.down('KeyA');
  await advanceTicks(page, 6);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  const paused = await snapshot(page);
  await page.waitForTimeout(150);
  expect((await snapshot(page)).tick).toBe(paused.tick);
  await page.screenshot({ path: `${screenshots}/08-pause.png` });
  await page.keyboard.up('KeyA');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await advanceTicks(page, 25);
  expect(Math.abs((await snapshot(page)).player.vx)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Restart practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__!.metrics().running);
  expect((await snapshot(page)).shotsFired).toBe(0);
  expect((await snapshot(page)).player.weapon.ammo).toBe(12);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
});

test('stable runtime through HUD rerenders and browser frame metrics', async ({ page }) => {
  await enter(page);
  await advanceTicks(page, 180);
  const metrics = await page.evaluate(() => window.__BURNHOP__!.metrics());
  expect(metrics.running).toBe(true);
  expect(metrics.tick).toBeGreaterThanOrEqual(180);
  expect(metrics.fps).toBeGreaterThan(20);
  const fps = page.getByTestId('fps');
  await expect(fps).toBeVisible();
  await expect(fps).toHaveText(/^\d+ FPS$/);
  const canvasBox = (await page.getByTestId('game-canvas').boundingBox())!;
  const fpsBox = (await fps.boundingBox())!;
  expect(fpsBox.x).toBeGreaterThan(canvasBox.x + canvasBox.width * .7);
  expect(fpsBox.y).toBeGreaterThan(canvasBox.y + canvasBox.height * .85);
  await writeFile('docs/browser-metrics.json', JSON.stringify({ browser: 'Playwright Chromium, headless', viewport: page.viewportSize(), note: 'Observed idle practice rendering; automation environment, not a multiplayer capacity benchmark.', ...metrics }, null, 2));
  await page.keyboard.press('Escape');
  await expect(fps).toHaveText('— FPS');
  expect((await page.evaluate(() => window.__BURNHOP__!.metrics())).fps).toBeNull();
});
