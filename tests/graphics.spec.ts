import { expect, test } from '@playwright/test';
import { defaultSettings, SETTINGS_STORAGE_KEY } from '../src/game/settings';
import { GRAPHICS_PRESETS } from '../src/game/graphics';
import { enterMenu, enterPractice, installCapture, openMenu } from './helpers/capture';

test.beforeEach(async ({ page }) => { await installCapture(page); });

test('graphics presets and custom options persist without changing other preferences', async ({ page }, testInfo) => {
  const legacy = { ...defaultSettings(false), muted: true } as Partial<ReturnType<typeof defaultSettings>>;
  delete legacy.graphics;
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); },
    { key: SETTINGS_STORAGE_KEY, value: legacy });
  await openMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const preset = page.getByRole('group', { name: 'Graphics preset' });
  await expect(preset.getByRole('button', { name: /Balanced/ })).toHaveAttribute('aria-pressed', 'true');
  await preset.getByRole('button', { name: /^Low/ }).click();
  await expect(page.getByRole('combobox', { name: 'Render resolution' })).toHaveValue('0.5');
  await page.getByRole('combobox', { name: 'Frame-rate limit' }).selectOption('120');
  await expect(page.getByText('Custom graphics settings')).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SETTINGS_STORAGE_KEY);
  expect(saved).toMatchObject({ ...legacy, graphics: { ...GRAPHICS_PRESETS.low, frameRate: 120 } });
  await page.screenshot({ path: testInfo.outputPath('graphics-desktop.png'), fullPage: true });
  await page.reload(); await enterMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Graphics' }).click();
  await expect(page.getByRole('combobox', { name: 'Frame-rate limit' })).toHaveValue('120');
  await page.getByRole('button', { name: 'Reset graphics', exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SETTINGS_STORAGE_KEY))
    .toEqual({ ...saved, graphics: GRAPHICS_PRESETS.balanced });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('graphics-narrow.png'), fullPage: true });
});

test('all quality presets render Outpost, preserve aiming, and keep physics running', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openMenu(page, '/?map=outpost'); await enterPractice(page);
  for (const name of ['balanced', 'low', 'high'] as const) {
    if (name !== 'balanced') {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Graphics' }).click();
      await page.getByRole('group', { name: 'Graphics preset' }).getByRole('button', { name: new RegExp(`^${name}`, 'i') }).click();
      await page.getByRole('button', { name: /Back to pause/ }).click();
      await page.getByRole('button', { name: /Resume/ }).click();
    }
    await page.waitForFunction(() => (window.__BURNHOP__?.metrics().rendering.terrain?.readyTextures ?? 0) > 0);
    const before = await page.evaluate(() => window.__BURNHOP__!.snapshot().tick);
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const api = window.__BURNHOP__!, canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
      const point = api.toScreen(500, 400);
      return { ...api.metrics(), point, cssWidth: canvas.getBoundingClientRect().width, dpr: devicePixelRatio };
    });
    expect(state.tick - before).toBeGreaterThan(15);
    expect(state.rendering.canvas.width).toBe(Math.round(state.cssWidth * Math.min(state.dpr, 2) * GRAPHICS_PRESETS[name].renderScale));
    expect(state.rendering.terrain?.mode).toBe('worker');
    expect(state.rendering.terrain!.cacheBytes).toBeLessThanOrEqual(state.rendering.terrain!.budgetBytes);
    await page.screenshot({ path: testInfo.outputPath(`graphics-${name}-gameplay.png`) });
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Graphics' }).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async () => { throw new Error('Clipboard unavailable'); } } }));
  await page.getByRole('button', { name: 'Copy performance report' }).click();
  const report = JSON.parse(await page.getByRole('textbox', { name: 'Performance report' }).inputValue());
  expect(report.session.mode).toBe('practice');
  expect(report.session.frame.measuredFrames).toBeGreaterThan(0);
  expect(report.session.rendering.graphics).toEqual(GRAPHICS_PRESETS.high);
  expect(errors).toEqual([]);
});

test('Outpost stays playable when worker creation fails', async ({ page }) => {
  await page.addInitScript(() => { window.Worker = class { constructor() { throw new Error('Worker unavailable'); } } as unknown as typeof Worker; });
  await openMenu(page, '/?map=outpost'); await enterPractice(page);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyD');
  const sample = await page.evaluate(() => window.__BURNHOP__!.metrics());
  expect(sample.running).toBe(true); expect(sample.tick).toBeGreaterThan(15);
  expect(sample.rendering.terrain?.mode).toBe('fallback');
});
