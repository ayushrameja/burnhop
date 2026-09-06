import { installCapture, openMenu, moveAim } from './helpers/capture';
import { test, expect, type Page } from '@playwright/test';
import { CONFIG, getWeaponOrigin } from '../src/game/simulation';
import { AIM_DASH_DISTANCE, AIM_DASH_LENGTH } from '../src/game/aim';
import type { Vec2 } from '../src/game/types';

test.beforeEach(async ({ page }) => { await installCapture(page); });

async function enter(page: Page) {
  await openMenu(page);
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running, undefined, { timeout: 10000 });
  await ticks(page, 3);
}

async function ticks(page: Page, count: number) {
  const until = await page.evaluate(count => window.__BURNHOP__!.snapshot().tick + count, count);
  await page.waitForFunction(until => window.__BURNHOP__!.snapshot().tick >= until, until, { timeout: 10000 });
}

async function state(page: Page) {
  return page.evaluate(() => ({ world: window.__BURNHOP__!.snapshot(), aim: window.__BURNHOP__!.aim() }));
}

async function origin(page: Page): Promise<Vec2> {
  const player = (await state(page)).world.player;
  return page.evaluate(point => window.__BURNHOP__!.toScreen(point.x, point.y), getWeaponOrigin(player));
}

async function safePointer(page: Page) {
  const box = await page.getByTestId('game-canvas').boundingBox();
  const point = { x: Math.round(box!.x + box!.width * .65), y: Math.round(box!.y + box!.height * .45) };
  await moveAim(page, point.x, point.y);
  return point;
}

function checkRadial(value: Awaited<ReturnType<typeof state>>) {
  const { aim } = value;
  const reticle = aim.reticle!;
  expect(aim.mode).toBe('radial');
  expect(reticle?.mode).toBe('radial');
  expect(Math.hypot(reticle.start.x - reticle.pivot.x, reticle.start.y - reticle.pivot.y)).toBeCloseTo(AIM_DASH_DISTANCE, 6);
  expect(Math.hypot(reticle.end.x - reticle.start.x, reticle.end.y - reticle.start.y)).toBeCloseTo(AIM_DASH_LENGTH, 6);
  expect((reticle.end.x - reticle.start.x) / AIM_DASH_LENGTH).toBeCloseTo(Math.cos(aim.visualAngle), 6);
  expect((reticle.end.y - reticle.start.y) / AIM_DASH_LENGTH).toBeCloseTo(Math.sin(aim.visualAngle), 6);
}

async function checkPointer(page: Page, point: Vec2) {
  await ticks(page, 2);
  const marker = await page.evaluate(() => {
    const api = window.__BURNHOP__!;
    const aim = api.aim();
    return { mode: aim.mode, reticle: aim.reticle, screen: aim.reticle ? api.toScreen(aim.reticle.start.x, aim.reticle.start.y) : null };
  });
  expect(marker.mode).toBe('pointer');
  expect(marker.reticle?.mode).toBe('pointer');
  expect(marker.reticle?.start).toEqual(marker.reticle?.end);
  expect(marker.screen!.x).toBeCloseTo(point.x, 4);
  expect(marker.screen!.y).toBeCloseTo(point.y, 4);
}

test('radial aim covers the full circle, stays fixed, and retains the latest angle at the pivot', async ({ page }) => {
  await enter(page);
  const pivot = await origin(page);
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    await moveAim(page, pivot.x + Math.cos(angle) * 40, pivot.y + Math.sin(angle) * 40);
    await ticks(page, 2);
    const value = await state(page);
    checkRadial(value);
    expect(Math.cos(value.aim.angle)).toBeCloseTo(Math.cos(angle), 4);
    expect(Math.sin(value.aim.angle)).toBeCloseTo(Math.sin(angle), 4);
  }
  await moveAim(page, pivot.x + 30, pivot.y);
  await ticks(page, 2);
  const nearDash = (await state(page)).aim.reticle;
  await moveAim(page, pivot.x + 100, pivot.y);
  await ticks(page, 2);
  const farDash = (await state(page)).aim.reticle!;
  // Fractional pointer coordinates lose a little precision in browser input.
  // The same tiny Y error produces different angles at 30 and 100 pixels away.
  // Keep the visual comparison below a thousandth of a world pixel; exact dash
  // distances and lengths are checked separately by checkRadial and unit tests.
  for (const end of ['start', 'end'] as const) {
    expect(farDash[end].x).toBeCloseTo(nearDash![end].x, 3);
    expect(farDash[end].y).toBeCloseTo(nearDash![end].y, 3);
  }

  // Mouse button coordinates are integer CSS pixels in Chromium, unlike pointer movement.
  const nearCenter = { x: Math.round(pivot.x), y: Math.round(pivot.y) + 4 };
  await moveAim(page, nearCenter.x, nearCenter.y);
  await ticks(page, 2);
  expect((await state(page)).aim.angle).toBeCloseTo(0, 6);
  await page.mouse.down({ button: 'right' });
  await checkPointer(page, nearCenter);
  const directAngle = (await state(page)).aim.angle;
  expect(directAngle).toBeCloseTo(Math.atan2(nearCenter.y - pivot.y, nearCenter.x - pivot.x), 5);
  await page.mouse.up({ button: 'right' });
  await ticks(page, 2);
  expect((await state(page)).aim.angle).toBe(directAngle);
  await moveAim(page, pivot.x, pivot.y);
  await ticks(page, 2);
  checkRadial(await state(page));
  expect((await state(page)).aim.angle).toBe(directAngle);

  expect(await page.evaluate(() => {
    const api = window.__BURNHOP__!;
    const first = api.aim();
    first.reticle!.start.x += 1000;
    first.reticle!.pivot.y += 1000;
    const second = api.aim();
    return first.reticle!.start.x !== second.reticle!.start.x && first.reticle!.pivot.y !== second.reticle!.pivot.y;
  })).toBe(true);
});

test('both mouse button orders preserve independent firing and pointer aim', async ({ page }) => {
  await enter(page);
  const point = await safePointer(page);
  await expect(page.getByTestId('game-canvas')).toHaveCSS('cursor', 'none');
  expect(await page.getByTestId('game-canvas').evaluate(canvas => !canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);

  for (const firstDown of ['left', 'right'] as const) {
    for (const firstUp of ['left', 'right'] as const) {
      const secondDown = firstDown === 'left' ? 'right' : 'left';
      const secondUp = firstUp === 'left' ? 'right' : 'left';
      const before = (await state(page)).world.shotsFired;
      await page.mouse.down({ button: firstDown });
      await ticks(page, 3);
      let value = await state(page);
      expect(value.aim.firing).toBe(firstDown === 'left');
      expect(value.aim.mode).toBe(firstDown === 'right' ? 'pointer' : 'radial');
      if (firstDown === 'right') expect(value.world.shotsFired).toBe(before);
      await page.mouse.down({ button: secondDown });
      await checkPointer(page, point);
      expect((await state(page)).aim.firing).toBe(true);
      await page.mouse.up({ button: firstUp });
      await ticks(page, 2);
      value = await state(page);
      expect(value.aim.firing).toBe(firstUp === 'right');
      expect(value.aim.mode).toBe(firstUp === 'left' ? 'pointer' : 'radial');
      const shots = value.world.shotsFired;
      await ticks(page, 8);
      if (firstUp === 'right') expect((await state(page)).world.shotsFired).toBeGreaterThan(shots);
      else expect((await state(page)).world.shotsFired).toBe(shots);
      await page.mouse.up({ button: secondUp });
      await ticks(page, 2);
      value = await state(page);
      expect(value.aim.firing).toBe(false);
      checkRadial(value);
    }
  }
});

test('pause, lost focus, cancellation, visibility, restart and teardown clear held mouse controls', async ({ page }) => {
  await enter(page);
  for (const reason of ['cancel', 'pause', 'blur', 'visibility'] as const) {
    await safePointer(page);
    await page.mouse.down({ button: 'left' });
    await page.mouse.down({ button: 'right' });
    await ticks(page, 2);
    expect((await state(page)).aim).toMatchObject({ mode: 'pointer', firing: true });
    if (reason === 'cancel') await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')));
    if (reason === 'pause') await page.keyboard.press('Escape');
    if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (reason === 'visibility') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Reflect.deleteProperty(document, 'hidden');
    });
    expect((await state(page)).aim).toMatchObject({ mode: 'radial', firing: false });
    await page.mouse.up({ button: 'left' });
    await page.mouse.up({ button: 'right' });
    if (reason !== 'cancel') {
      await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
      const tick = (await state(page)).world.tick;
      await page.waitForTimeout(100);
      expect((await state(page)).world.tick).toBe(tick);
      expect(await page.getByTestId('game-canvas').evaluate(canvas => canvas.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true })))).toBe(true);
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
    }
    await ticks(page, 3);
    checkRadial(await state(page));
    expect((await state(page)).aim.firing).toBe(false);
  }
  await safePointer(page);
  await page.mouse.down({ button: 'right' });
  await page.mouse.down({ button: 'left' });
  await ticks(page, 2);
  await page.keyboard.press('Escape');
  await page.mouse.up({ button: 'left' });
  await page.mouse.up({ button: 'right' });
  await page.getByRole('button', { name: 'Restart practice', exact: true }).click();
  await ticks(page, 3);
  const restarted = await state(page);
  expect(restarted.aim).toMatchObject({ mode: 'radial', firing: false });
  expect(restarted.world.shotsFired).toBe(0);
  expect(restarted.world.player.weapon.ammo).toBe(CONFIG.magazineSize);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
});

test('held fire keeps hitting the target while switching aim modes', async ({ page }, testInfo) => {
  await enter(page);
  // The spawn target is outside the close default view; use the medium view to shoot it.
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('zoom-level')).toContainText('3x');
  const target = await page.evaluate(() => {
    const api = window.__BURNHOP__!;
    const target = api.snapshot().target;
    const point = api.toScreen(target.x + target.width / 2, target.y + target.height / 2);
    return { x: Math.round(point.x), y: Math.round(point.y) };
  });
  await moveAim(page, target.x, target.y);
  await page.mouse.down({ button: 'left' });
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().hits >= 1, undefined, { timeout: 10000 });
  const firstHits = (await state(page)).world.hits;
  await page.mouse.down({ button: 'right' });
  await checkPointer(page, target);
  await page.waitForFunction(hits => window.__BURNHOP__!.snapshot().hits > hits, firstHits, { timeout: 10000 });
  const pointerHits = (await state(page)).world.hits;
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(hits => window.__BURNHOP__!.snapshot().hits > hits, pointerHits, { timeout: 10000 });
  expect((await state(page)).aim.firing).toBe(true);
  checkRadial(await state(page));
  await page.mouse.up({ button: 'left' });
  await page.screenshot({ path: testInfo.outputPath('switching-aim-target-hit.png') });
});

test.describe('high density displays', () => {
  test.use({ deviceScaleFactor: 2 });

  test('reticle remains aligned through resize, movement and the following camera at 2x DPR', async ({ page }, testInfo) => {
    await enter(page);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await ticks(page, 3);
      const scale = await page.evaluate(() => window.__BURNHOP__!.metrics().rendering.graphics.renderScale);
      expect(await page.getByTestId('game-canvas').evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBe(Math.round((await page.getByTestId('game-canvas').boundingBox())!.width * 2 * scale));
      const point = await safePointer(page);
      await ticks(page, 2);
      checkRadial(await state(page));
      await page.mouse.down({ button: 'right' });
      await checkPointer(page, point);
      await page.mouse.up({ button: 'right' });
    }
    const point = await safePointer(page);
    await ticks(page, 2);
    const initial = await state(page);
    const referenceBefore = await page.evaluate(() => window.__BURNHOP__!.toScreen(0, 0));
    await page.keyboard.down('KeyD');
    for (let i = 0; i < 10; i++) {
      await ticks(page, 10);
      const value = await state(page);
      checkRadial(value);
      const p = value.world.player;
      const pivot = value.aim.reticle!.pivot;
      const authoritativeX = p.x + p.width / 2;
      expect(pivot.x).toBeLessThanOrEqual(authoritativeX + .001);
      expect(pivot.x).toBeGreaterThanOrEqual(authoritativeX - Math.abs(p.vx) * CONFIG.fixedDt - .01);
      expect(pivot.y).toBeCloseTo(getWeaponOrigin(p).y, 6);
    }
    await page.keyboard.up('KeyD');
    await ticks(page, 20);
    const moved = await state(page);
    const referenceAfter = await page.evaluate(() => window.__BURNHOP__!.toScreen(0, 0));
    expect(moved.world.player.x).toBeGreaterThan(initial.world.player.x + 400);
    expect(referenceAfter.x).toBeLessThan(referenceBefore.x - 200);
    expect(Math.abs(moved.aim.angle - initial.aim.angle)).toBeGreaterThan(.02);
    const pivot = await origin(page);
    expect(moved.aim.angle).toBeCloseTo(Math.atan2(point.y - pivot.y, point.x - pivot.x), 2);
    await page.mouse.down({ button: 'right' });
    await checkPointer(page, point);
    await page.mouse.up({ button: 'right' });
    await ticks(page, 2);
    checkRadial(await state(page));
    await page.screenshot({ path: testInfo.outputPath('radial-aim-camera-2x-dpr.png') });
  });
});
