import { test, expect, type Page } from '@playwright/test';
import { installCapture, fixtureState, openMenu, enterPractice } from './helpers/capture';

test.beforeEach(async ({ page }) => { await installCapture(page); });

async function holdArena(page: Page) {
  let release!: () => void;
  let requested = false;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/arena.json', async route => {
    requested = true;
    await hold;
    await route.continue();
  });
  return { release, requested: () => requested };
}

async function running(page: Page) {
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await expect(page.getByTestId('loading-screen')).not.toBeVisible();
  await expect(page.getByTestId('capture-overlay')).not.toBeVisible();
  await expect(page.getByTestId('fullscreen-gate')).not.toBeVisible();
}

test('scenic entry opens only the fullscreen main menu; practice alone captures input and loads the range', async ({ page }) => {
  const arena = await holdArena(page);
  await page.goto('/');
  const gate = page.getByTestId('fullscreen-gate');
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('button', { name: 'Enter game', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Enter practice', exact: true })).not.toBeVisible();
  await expect(page.getByTestId('loading-screen')).not.toBeVisible();
  expect(arena.requested()).toBe(false);
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();

  await gate.getByRole('button', { name: 'Enter game', exact: true }).click();
  await expect(gate).not.toBeVisible();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Multiplayer', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Enter game|Play windowed|Resume windowed/ })).toHaveCount(0);
  expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: false, keyboard: true });
  expect((await fixtureState(page)).calls.filter(call => call === 'pointerlock')).toHaveLength(0);
  expect(arena.requested()).toBe(false);
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();

  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await expect(page.getByTestId('loading-screen')).toBeVisible();
  await expect.poll(arena.requested).toBe(true);
  expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: true });
  const calls = (await fixtureState(page)).calls;
  expect(calls.indexOf('fullscreen')).toBeLessThan(calls.indexOf('pointerlock'));
  expect(calls.indexOf('fetch:/assets/arena.json')).toBeGreaterThan(calls.indexOf('pointerlock'));
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  arena.release();
  await running(page);
  expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: true, keyboard: true, sameCanvas: true });
});

test('Escape taps pause without leaving fullscreen, Resume recaptures only the pointer, and explicit exit shows the permanent gate', async ({ page }) => {
  await openMenu(page);
  await enterPractice(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: false, keyboard: true });
  const pausedTick = await page.evaluate(() => window.__BURNHOP__!.snapshot().tick);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().tick)).toBe(pausedTick);
  await expect(page.getByTestId('fps')).toHaveText('— FPS');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await running(page);
  const resumed = await fixtureState(page);
  expect(resumed.calls.filter(call => call === 'fullscreen')).toHaveLength(1);
  expect(resumed.calls.filter(call => call === 'pointerlock')).toHaveLength(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.waitForTimeout(180);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: false, keyboard: true });
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  expect(await fixtureState(page)).toMatchObject({ fullscreen: false, locked: false, keyboard: false });
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to fullscreen', exact: true })).toBeFocused();
});

test('fullscreen loss during loading cancels entry and delayed assets cannot start gameplay', async ({ page }) => {
  const arena = await holdArena(page);
  await openMenu(page);
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await expect(page.getByTestId('loading-screen')).toBeVisible();
  await expect.poll(arena.requested).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  expect((await fixtureState(page)).locked).toBe(false);
  const response = page.waitForResponse('**/assets/arena.json');
  arena.release();
  await response;
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  await enterPractice(page);
  await running(page);
});

test('fullscreen loss in menu and settings blocks interaction and restores the same settings view', async ({ page }) => {
  await openMenu(page);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect((await fixtureState(page)).locked).toBe(false);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Motion' }).click();
  await page.getByRole('checkbox', { name: 'Reduced motion' }).check();
  const saved = await page.evaluate(() => localStorage.getItem('burnhop-settings'));
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  for (const key of ['Escape', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="fullscreen-gate"]') !== null)).toBe(true);
  }
  expect(await page.evaluate(() => localStorage.getItem('burnhop-settings'))).toBe(saved);
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Reduced motion' })).toBeChecked();
  expect((await fixtureState(page)).locked).toBe(false);
});

test('fullscreen restoration preserves a frozen practice session until explicit Resume, and menu return tears down runtime', async ({ page }) => {
  await openMenu(page);
  await enterPractice(page);
  const startX = await page.evaluate(() => window.__BURNHOP__!.snapshot().player.x);
  await page.keyboard.down('KeyD');
  await page.waitForFunction(start => window.__BURNHOP__!.snapshot().player.x > start + 60, startX);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Tab');
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  const paused = await page.evaluate(() => ({ world: window.__BURNHOP__!.snapshot(), camera: window.__BURNHOP__!.camera() }));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot())).toEqual(paused.world);
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: false, keyboard: true });
  expect(await page.evaluate(() => ({ world: window.__BURNHOP__!.snapshot(), camera: window.__BURNHOP__!.camera() }))).toEqual(paused);
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await running(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: false, keyboard: true });
});


test('fullscreen gate suspends an in-progress binding capture until settings return', async ({ page }) => {
  await openMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Change Move left primary binding', exact: true }).click();
  const saved = await page.evaluate(() => localStorage.getItem('burnhop-settings'));
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => localStorage.getItem('burnhop-settings'))).toBe(saved);
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Press a key or mouse button.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('burnhop-settings'))).toBe(saved);
  await page.keyboard.press('KeyJ');
  await expect(page.getByRole('button', { name: 'Change Move left primary binding', exact: true })).toContainText('J');
});
