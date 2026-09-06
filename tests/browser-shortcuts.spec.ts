import { expect, test } from '@playwright/test';
import { defaultSettings, SETTINGS_STORAGE_KEY } from '../src/game/settings';
import { enterMenu, enterPractice, fixtureState, installCapture, openMenu } from './helpers/capture';

test.beforeEach(async ({ page }) => { await installCapture(page); });

test('Ctrl crouch and W movement reach gameplay together, with shortcut capture scoped to play', async ({ page }) => {
  const settings = defaultSettings(false);
  settings.controls.bindings.crouch = ['ControlLeft', 'ControlRight'];
  settings.controls.bindings.moveRight = ['KeyW', null];
  settings.controls.bindings.jetpack = [null, null];
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETTINGS_STORAGE_KEY, value: settings });
  await openMenu(page);
  expect((await fixtureState(page)).keyboardKeys).toEqual(['Escape']);
  await enterPractice(page);
  expect((await fixtureState(page)).keyboardKeys).toEqual(['Escape', 'KeyW']);
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.grounded);
  for (const control of ['ControlLeft', 'ControlRight']) {
    const x = await page.evaluate(() => window.__BURNHOP__!.snapshot().player.x);
    await page.keyboard.down(control); await page.keyboard.down('KeyW');
    await page.waitForFunction(x => {
      const p = window.__BURNHOP__!.snapshot().player; return p.crouchAmount > .9 && p.x > x + 10;
    }, x);
    await page.keyboard.up('KeyW'); await page.keyboard.up(control);
    expect(page.isClosed()).toBe(false);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'PAUSED', exact: true })).toBeVisible();
  expect((await fixtureState(page)).keyboardKeys).toEqual(['Escape']);
  expect((await fixtureState(page)).fullscreen).toBe(true);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  expect((await fixtureState(page)).keyboardKeys).toEqual(['Escape', 'KeyW']);
});

test('an unbound Ctrl+W or Cmd+W is cancelled when delivered to gameplay', async ({ page }) => {
  await openMenu(page); await enterPractice(page);
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const cancelled = await page.evaluate(modifier => {
      const event = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', [modifier]: true, bubbles: true, cancelable: true });
      document.querySelector('[data-testid="game-canvas"]')!.dispatchEvent(event);
      return event.defaultPrevented;
    }, modifier);
    expect(cancelled).toBe(true);
  }
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(true);
});

test('cancelling a real tab-close dialog preserves practice; leaving through the menu removes the guard', async ({ page }, testInfo) => {
  await openMenu(page); await enterPractice(page);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(200);
  const dialogPromise = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss(); await page.keyboard.up('KeyD');
  expect(page.isClosed()).toBe(false);
  await expect(page.getByRole('heading', { name: 'PAUSED', exact: true })).toBeVisible();
  const paused = await page.evaluate(() => window.__BURNHOP__!.snapshot());
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot())).toEqual(paused);
  await page.screenshot({ path: testInfo.outputPath('cancelled-close-preserves-practice.png') });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(tick => window.__BURNHOP__!.snapshot().tick > tick, paused.tick);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  const closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true }); await closed;
});

test('paused practice still confirms a reload and an explicit confirmation is allowed', async ({ page }) => {
  await openMenu(page); await enterPractice(page); await page.keyboard.press('Escape');
  const dialogPromise = page.waitForEvent('dialog');
  const reload = page.reload().catch(() => undefined);
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.accept(); await reload;
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
});

test('a denied initial keyboard request retries at play entry and Escape pauses without a fullscreen exit', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const keyboard = (navigator as Navigator & { keyboard: { lock: (keys: string[]) => Promise<void> } }).keyboard;
    const original = keyboard.lock.bind(keyboard);
    let attempts = 0;
    keyboard.lock = keys => ++attempts === 1 ? Promise.reject(new Error('Blocked initially')) : original(keys);
  });
  await enterMenu(page);
  await expect(page.getByRole('button', { name: 'Retry keyboard controls' })).toBeVisible();
  await enterPractice(page);
  expect((await fixtureState(page)).keyboardKeys).toEqual(['Escape', 'KeyW']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'PAUSED', exact: true })).toBeVisible();
  expect((await fixtureState(page)).fullscreen).toBe(true);
  await expect(page.getByRole('button', { name: 'Retry keyboard controls' })).toHaveCount(0);
});

test('failed keyboard capture is explained and can be retried without restarting practice', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(() => {
    const keyboard = (navigator as Navigator & { keyboard: { lock: (keys: string[]) => Promise<void> } }).keyboard;
    const original = keyboard.lock.bind(keyboard);
    (window as Window & { restoreKeyboard?: () => void }).restoreKeyboard = () => { keyboard.lock = original; };
    keyboard.lock = () => Promise.reject(new Error('Keyboard unavailable'));
  });
  await enterMenu(page); await enterPractice(page);
  // The browser can consume Escape without dispatching a DOM key event.
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  const paused = await page.evaluate(() => window.__BURNHOP__!.snapshot());
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  await expect(page.getByText('Your practice session is paused and ready to resume.')).toBeVisible();
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry keyboard controls' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('keyboard-capture-fallback.png') });
  await page.evaluate(() => (window as Window & { restoreKeyboard?: () => void }).restoreKeyboard!());
  await page.getByRole('button', { name: 'Retry keyboard controls' }).click();
  await expect(page.getByRole('button', { name: 'Retry keyboard controls' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot())).toEqual(paused);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  expect((await fixtureState(page)).keyboardKeys).toEqual(['Escape', 'KeyW']);
});

test('an unsupported keyboard API preserves the paused session after browser fullscreen exit', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(() => {
    const keyboard = (navigator as Navigator & { keyboard: object }).keyboard;
    Object.defineProperty(keyboard, 'lock', { configurable: true, value: undefined });
  });
  await enterMenu(page);
  await expect(page.getByText(/Keyboard capture is unavailable/)).toBeVisible();
  await enterPractice(page);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('unsupported-keyboard-narrow.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PAUSED', exact: true })).toBeVisible();
});
