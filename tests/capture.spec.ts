import { test, expect, type Page } from '@playwright/test';
import { installCapture, fixtureState, openMenu, enterPractice } from './helpers/capture';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter game', exact: true })).toBeEnabled();
}

async function ticks(page: Page, count = 3) {
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  const target = await page.evaluate(count => window.__BURNHOP__!.snapshot().tick + count, count);
  await page.waitForFunction(target => window.__BURNHOP__!.snapshot().tick >= target, target);
}

async function captureState(page: Page) {
  return page.evaluate(() => ({
    fullscreen: document.fullscreenElement !== null,
    locked: document.pointerLockElement === document.querySelector('[data-testid="game-canvas"]'),
    aim: window.__BURNHOP__?.aim(),
    metrics: window.__BURNHOP__?.metrics(),
    world: window.__BURNHOP__?.snapshot(),
  }));
}

test('deliberate fullscreen entry and practice pause expose correct live FPS', async ({ page }) => {
  await installCapture(page);
  await ready(page);
  expect((await captureState(page)).metrics).toBeUndefined();
  await page.waitForTimeout(100);
  expect((await captureState(page)).world).toBeUndefined();
  await page.getByRole('button', { name: 'Enter game', exact: true }).click();
  expect((await captureState(page)).metrics).toBeUndefined();
  await enterPractice(page);
  await ticks(page);
  expect(await captureState(page)).toMatchObject({ fullscreen: true, locked: true, metrics: { running: true } });
  await expect(page.getByTestId('fps')).toHaveText(/^\d+ FPS$/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect((await captureState(page)).metrics).toMatchObject({ running: false, fps: null });
  await expect(page.getByTestId('fps')).toHaveText('— FPS');
});

test('native fullscreen and pointer lock preserve relative aim, button chords and capture lifecycle', async ({ page }, testInfo) => {
  // Bundled Chromium on this host rejects even isolated native pointer lock with
  // WrongDocumentError. Keep native assertions opt-in; Arc is verified through desktop UI.
  test.skip(process.env.BURNHOP_NATIVE_CAPTURE !== '1', 'Set BURNHOP_NATIVE_CAPTURE=1 in an environment with working native pointer capture.');
  await ready(page);
  const available = await page.evaluate(() => typeof Element.prototype.requestFullscreen === 'function'
    && typeof HTMLCanvasElement.prototype.requestPointerLock === 'function');
  test.skip(!available, 'This browser does not implement fullscreen and pointer lock; failure paths are covered separately.');
  await page.getByRole('button', { name: 'Enter game', exact: true }).click();
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await ticks(page);
  await expect.poll(async () => (await captureState(page)).locked, { timeout: 10000 }).toBe(true);
  const captured = await captureState(page);
  expect(captured).toMatchObject({ fullscreen: true, locked: true, aim: { locked: true, mode: 'radial', firing: false }, metrics: { running: true } });

  // Read real DOM movement deltas, rather than assuming DevTools' absolute move maps 1:1 under lock.
  const beforeMove = await page.evaluate(() => {
    const records: { x: number; y: number }[] = [];
    (window as Window & { captureMoves?: typeof records }).captureMoves = records;
    window.addEventListener('pointermove', event => records.push({ x: event.movementX, y: event.movementY }));
    const rect = document.querySelector('[data-testid="game-canvas"]')!.getBoundingClientRect();
    const scale = Math.min(rect.width / 1280, rect.height / 720);
    const left = rect.left + (rect.width - 1280 * scale) / 2;
    const top = rect.top + (rect.height - 720 * scale) / 2;
    return { pointer: window.__BURNHOP__!.aim().pointer, bounds: { left, top, right: left + 1280 * scale, bottom: top + 720 * scale } };
  });
  await page.mouse.move(640, 360);
  await page.mouse.move(580, 320, { steps: 2 });
  await ticks(page);
  const moved = await captureState(page);
  const moves = await page.evaluate(() => (window as Window & { captureMoves?: { x: number; y: number }[] }).captureMoves!);
  expect(moves.some(move => Math.hypot(move.x, move.y) > 0)).toBe(true);
  const expected = moves.reduce((point, move) => ({
    x: Math.max(beforeMove.bounds.left, Math.min(beforeMove.bounds.right, point.x + move.x)),
    y: Math.max(beforeMove.bounds.top, Math.min(beforeMove.bounds.bottom, point.y + move.y)),
  }), beforeMove.pointer);
  expect(moved.aim!.pointer.x).toBeCloseTo(expected.x, 5);
  expect(moved.aim!.pointer.y).toBeCloseTo(expected.y, 5);
  expect(Math.hypot(moved.aim!.pointer.x - beforeMove.pointer.x, moved.aim!.pointer.y - beforeMove.pointer.y)).toBeGreaterThan(0);

  const pointBeforeButtons = moved.aim!.pointer;
  await page.mouse.down({ button: 'right' });
  await ticks(page);
  let value = await captureState(page);
  expect(value.aim).toMatchObject({ mode: 'pointer', locked: true, firing: false, pointer: pointBeforeButtons });
  expect(value.world!.shotsFired).toBe(moved.world!.shotsFired);
  const crosshair = await page.evaluate(() => {
    const api = window.__BURNHOP__!, reticle = api.aim().reticle!;
    return api.toScreen(reticle.start.x, reticle.start.y);
  });
  expect(crosshair.x).toBeCloseTo(pointBeforeButtons.x, 5);
  expect(crosshair.y).toBeCloseTo(pointBeforeButtons.y, 5);
  await page.mouse.down({ button: 'left' });
  await ticks(page, 8);
  value = await captureState(page);
  expect(value.aim).toMatchObject({ firing: true, mode: 'pointer', pointer: pointBeforeButtons });
  expect(value.world!.shotsFired).toBeGreaterThan(moved.world!.shotsFired);
  await page.mouse.up({ button: 'right' });
  await ticks(page, 8);
  const releasedRight = await captureState(page);
  expect(releasedRight.aim).toMatchObject({ mode: 'radial', firing: true, pointer: pointBeforeButtons });
  expect(releasedRight.world!.shotsFired).toBeGreaterThan(value.world!.shotsFired);
  await page.mouse.up({ button: 'left' });
  await ticks(page);
  expect((await captureState(page)).aim!.firing).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('fullscreen-locked-aim.png') });

  await page.keyboard.press('Escape');
  await expect.poll(async () => {
    const value = await captureState(page);
    return !value.locked && !value.metrics!.running;
  }).toBe(true);
  // Keyboard Lock preserves fullscreen after the first press when permission is granted.
  // Browsers without it retain their native Escape exit behavior.
  if ((await captureState(page)).fullscreen) {
    await page.keyboard.down('Escape');
    await expect.poll(async () => (await captureState(page)).fullscreen).toBe(false);
    await page.keyboard.up('Escape');
  }
  expect((await captureState(page)).aim).toMatchObject({ mode: 'radial', firing: false, locked: false });
  await expect(page.getByTestId('fps')).toHaveText('— FPS');
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => (await captureState(page)).locked).toBe(true);
  await ticks(page);
  expect((await captureState(page)).metrics!.running).toBe(true);

  // Native fullscreen exit can happen independently of the game's Escape handler.
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await expect.poll(async () => (await captureState(page)).locked).toBe(false);
  expect((await captureState(page)).metrics!.running).toBe(false);
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(await captureState(page)).toMatchObject({ fullscreen: true, locked: false, metrics: undefined });
});

test('denied fullscreen stays behind the gate after retries without a windowed fallback', async ({ page }) => {
  await installCapture(page);
  await ready(page);
  await page.evaluate(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Fullscreen denied for this test.', 'NotAllowedError'));
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Enter game', exact: true }).click();
    await expect(page.getByTestId('fullscreen-error')).toBeVisible();
    await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
    expect(await captureState(page)).toMatchObject({ fullscreen: false, locked: false, metrics: undefined });
  }
  await expect(page.getByRole('button', { name: /Play windowed|Resume windowed|Enter practice/ })).not.toBeVisible();
  expect((await fixtureState(page)).calls.filter(call => call === 'pointerlock')).toHaveLength(0);
});

test('denied pointer lock keeps fullscreen menu available and a fresh practice gesture retries capture', async ({ page }) => {
  await installCapture(page);
  await openMenu(page);
  await page.evaluate(() => {
    const granted = HTMLCanvasElement.prototype.requestPointerLock;
    HTMLCanvasElement.prototype.requestPointerLock = function () {
      HTMLCanvasElement.prototype.requestPointerLock = granted;
      return Promise.reject(new DOMException('Pointer lock denied for this test.', 'NotAllowedError'));
    };
  });
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await expect(page.getByTestId('capture-error')).toBeVisible();
  expect(await captureState(page)).toMatchObject({ fullscreen: true, locked: false, metrics: undefined });
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: /Play windowed|Resume windowed/ })).toHaveCount(0);
  await enterPractice(page);
  expect(await captureState(page)).toMatchObject({ fullscreen: true, locked: true, metrics: { running: true } });
});

test('unsupported fullscreen stays blocked with an explanation and never loads gameplay', async ({ page }) => {
  await installCapture(page);
  await ready(page);
  await page.evaluate(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined, configurable: true });
  });
  await page.getByRole('button', { name: 'Enter game', exact: true }).click();
  await expect(page.getByTestId('fullscreen-error')).toBeVisible();
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  expect((await captureState(page)).metrics).toBeUndefined();
  await expect(page.getByRole('button', { name: /Play windowed|Resume windowed|Enter practice/ })).not.toBeVisible();
});

test('locked relative deltas move aim independently of client coordinates', async ({ page }) => {
  await installCapture(page);
  await openMenu(page);
  await enterPractice(page);
  const before = (await captureState(page)).aim!.pointer;
  await page.getByTestId('game-canvas').dispatchEvent('pointermove', {
    movementX: -37, movementY: -21, clientX: 0, clientY: 0, pointerType: 'mouse',
  });
  await ticks(page);
  expect((await captureState(page)).aim!.pointer).toEqual({ x: before.x - 37, y: before.y - 21 });
  await page.mouse.down({ button: 'right' });
  await ticks(page);
  expect((await captureState(page)).aim).toMatchObject({ mode: 'pointer', locked: true, firing: false });
  await page.mouse.down({ button: 'left' });
  await ticks(page, 8);
  expect((await captureState(page)).aim!.firing).toBe(true);
  const shots = (await captureState(page)).world!.shotsFired;
  await page.mouse.up({ button: 'right' });
  await ticks(page, 8);
  expect((await captureState(page)).aim).toMatchObject({ mode: 'radial', locked: true, firing: true });
  expect((await captureState(page)).world!.shotsFired).toBeGreaterThan(shots);
  await page.mouse.up({ button: 'left' });
});
