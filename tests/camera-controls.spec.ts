import { installCapture, openMenu, moveAim } from './helpers/capture';
import { choosePracticeLoadout, cycleViewTo } from './helpers/combat';
import { test, expect, type Page } from '@playwright/test';
import { ZOOM_SCALES, type ZoomLevel } from '../src/game/camera';
import { proposeBinding } from '../src/game/controls';
import { defaultSettings } from '../src/game/settings';

test.beforeEach(async ({ page }) => { await installCapture(page); });

async function startFromMenu(page: Page) {
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await expect(page.getByTestId('game-canvas')).toBeFocused();
}

async function enter(page: Page) {
  await openMenu(page);
  await startFromMenu(page);
}

async function ticks(page: Page, count: number) {
  const until = await page.evaluate(count => window.__BURNHOP__!.snapshot().tick + count, count);
  await page.waitForFunction(until => window.__BURNHOP__!.snapshot().tick >= until, until);
}

async function expectZoom(page: Page, level: ZoomLevel) {
  await expect(page.getByTestId('zoom-level')).toContainText(`${level}x`);
  expect(await page.evaluate(() => window.__BURNHOP__!.camera())).toMatchObject({
    zoomLevel: level,
    scale: ZOOM_SCALES[level],
  });
}

async function projectedPilotHeight(page: Page) {
  return page.evaluate(() => {
    const api = window.__BURNHOP__!;
    const player = api.snapshot().player;
    const top = api.toScreen(player.x, player.y);
    const feet = api.toScreen(player.x, player.y + player.height);
    const rect = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!.getBoundingClientRect();
    return (feet.y - top.y) / Math.min(rect.width / 1280, rect.height / 720) / player.height;
  });
}

test('Tab respects pistol view and cycles rifle tiers once per press without moving focus', async ({ page }) => {
  await enter(page);
  await page.keyboard.press('Tab');
  await expectZoom(page, 1);
  expect(await projectedPilotHeight(page)).toBeCloseTo(1.5);
  await choosePracticeLoadout(page, 'ak47');
  await page.keyboard.down('Tab');
  await expectZoom(page, 1.5);
  await page.keyboard.down('Tab'); await page.keyboard.down('Tab');
  await ticks(page, 3); await expectZoom(page, 1.5);
  await expect(page.getByTestId('game-canvas')).toBeFocused();
  await page.keyboard.up('Tab');
  for (const level of [2, 2.5, 1, 1.5] as ZoomLevel[]) {
    await page.keyboard.press('Tab'); await expectZoom(page, level);
    expect(await projectedPilotHeight(page)).toBeCloseTo(ZOOM_SCALES[level]);
    await expect(page.getByTestId('game-canvas')).toBeFocused();
  }
});

test('Escape still pauses from HUD focus after Tab is freed by remapping zoom', async ({ page }) => {
  await openMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Change Cycle view range primary binding', exact: true }).click();
  await page.keyboard.press('KeyZ');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await startFromMenu(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Pause practice', exact: true })).toBeFocused();
  await expectZoom(page, 1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
});

async function enterWithMousePause(page: Page, binding: 'Mouse0' | 'Mouse3') {
  const settings = defaultSettings(false);
  settings.controls = proposeBinding(settings.controls, 'pause', 0, binding).controls;
  await page.addInitScript(value => localStorage.setItem('burnhop-settings', JSON.stringify(value)), settings);
  await enter(page);
}

test('mouse-back pause consumes its release without navigating history and allows a fresh Resume click', async ({ page }) => {
  await enterWithMousePause(page, 'Mouse3');
  await page.evaluate(() => history.pushState({}, '', '?mouse-pause-test'));
  const originalUrl = page.url();
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'back', buttons: 8, clickCount: 1 });
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'back', buttons: 0, clickCount: 1 });
  // Browser history traversal is queued after the native mouse release.
  await page.waitForTimeout(150);
  await expect(page).toHaveURL(originalUrl);
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await ticks(page, 3);
  await expect(page.getByTestId('game-canvas')).toBeFocused();
  await expect(page).toHaveURL(originalUrl);
});

test('left-mouse pause release cannot activate the new overlay but a fresh Resume click works', async ({ page }) => {
  await enterWithMousePause(page, 'Mouse0');
  // Measure the paused Resume position, then press the gameplay canvas at that spot.
  await page.keyboard.press('Escape');
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  const box = (await resume.boundingBox())!;
  await resume.click();
  await ticks(page, 2);
  await moveAim(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'left' });
  await expect(resume).toBeVisible();
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(100);
  await expect(resume).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  await resume.click();
  await ticks(page, 3);
  await expect(page.getByTestId('game-canvas')).toBeFocused();
});

test('pause preserves view, while restart restores the default pistol and close view', async ({ page }) => {
  await enter(page); await choosePracticeLoadout(page, 'sniper'); await cycleViewTo(page, 4);
  await expectZoom(page, 4);
  await page.keyboard.press('Escape');
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  await expect(resume).toBeFocused();
  await page.keyboard.press('Tab'); await expect(resume).not.toBeFocused();
  await expectZoom(page, 4);
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  await resume.click(); await ticks(page, 3); await expectZoom(page, 4);
  expect(await projectedPilotHeight(page)).toBeCloseTo(.75);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Restart practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__!.metrics().running);
  await expectZoom(page, 1);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.weapon.weaponId)).toBe('pistol');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await startFromMenu(page); await expectZoom(page, 1);
  expect(await projectedPilotHeight(page)).toBeCloseTo(1.5);
});

async function expectVisualAim(page: Page, mode: 'radial' | 'pointer') {
  const frame = await page.evaluate(() => {
    const api = window.__BURNHOP__!;
    const aim = api.aim();
    const reticle = aim.reticle!;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
    const rect = canvas.getBoundingClientRect();
    const origin = api.toScreen(0, 0);
    const unit = api.toScreen(1, 0);
    return {
      aim,
      pivot: api.toScreen(reticle.pivot.x, reticle.pivot.y),
      end: api.toScreen(reticle.end.x, reticle.end.y),
      projectedUnit: unit.x - origin.x,
      viewportScale: Math.min(rect.width / 1280, rect.height / 720),
      worldScale: api.camera().scale,
      canvasWidth: canvas.width,
      renderScale: api.metrics().rendering.graphics.renderScale,
      cssWidth: rect.width,
    };
  });
  expect(frame.aim.mode).toBe(mode);
  expect(frame.aim.reticle!.mode).toBe(mode);
  expect(frame.aim.firing).toBe(true);
  expect(frame.aim.visualAngle).toBeCloseTo(Math.atan2(frame.aim.pointer.y - frame.pivot.y, frame.aim.pointer.x - frame.pivot.x), 9);
  expect(frame.projectedUnit).toBeCloseTo(frame.worldScale * frame.viewportScale, 9);
  expect(frame.canvasWidth).toBe(Math.round(frame.cssWidth * 2 * frame.renderScale));
  if (mode === 'pointer') {
    expect(frame.end.x).toBeCloseTo(frame.aim.pointer.x, 9);
    expect(frame.end.y).toBeCloseTo(frame.aim.pointer.y, 9);
  }
}

test.describe('zoom on high density displays', () => {
  test.use({ deviceScaleFactor: 2 });

  test('both aim styles track the displayed character while zooming, moving and firing', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await enter(page);
    await choosePracticeLoadout(page, 'm416');
    const before = await page.evaluate(() => window.__BURNHOP__!.snapshot());
    await page.keyboard.down('KeyD');
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      const box = (await page.getByTestId('game-canvas').boundingBox())!;
      await moveAim(page, Math.round(box.x + box.width * .76), Math.round(box.y + box.height * .42));
      await page.mouse.down({ button: 'left' });
      for (const level of [1.5, 2, 2.5, 1] as ZoomLevel[]) {
        await page.keyboard.press('Tab');
        await expectZoom(page, level);
        await ticks(page, 3);
        await expectVisualAim(page, 'radial');
        await page.mouse.down({ button: 'right' });
        await ticks(page, 3);
        await expectVisualAim(page, 'pointer');
        await page.mouse.up({ button: 'right' });
        if (viewport.width === 1024) {
          await page.screenshot({ path: testInfo.outputPath(`camera-${level}x-2x-dpr.png`) });
        }
      }
      await page.mouse.up({ button: 'left' });
    }
    await page.keyboard.up('KeyD');
    const after = await page.evaluate(() => window.__BURNHOP__!.snapshot());
    expect(after.player.x).toBeGreaterThan(before.player.x + 100);
    expect(after.shotsFired).toBeGreaterThan(before.shotsFired);
    expect(errors).toEqual([]);
  });
});
