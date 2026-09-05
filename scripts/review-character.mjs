import { installCapture, enterFullscreen } from '../tests/helpers/capture.ts';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// With Vite running: node scripts/review-character.mjs
// With the built app served: BURNHOP_PREVIEW_URL=http://127.0.0.1:4173 node scripts/review-character.mjs
const baseURL = process.env.BURNHOP_PREVIEW_URL ?? 'http://127.0.0.1:5173';
const directory = 'docs/screenshots';
const output = process.env.BURNHOP_PREVIEW_URL ? '41-character-production' : '41-character-development';
const browser = await chromium.launch();
await mkdir(directory, { recursive: true });
const errors = [];
const stored = {
  'burnhop-settings': '{ "cosmetics": { "headgear": 2, "shirt": 1, "trousers": 0 }, "muted": true, "reducedMotion": false, "keep": "unchanged" }',
  'low-altitude-settings': '{ "cosmetics": { "headgear": 1, "shirt": 2, "trousers": 1 }, "muted": false, "reducedMotion": false, "keep": "legacy unchanged" }',
};
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const choose = async (page, name) => {
  const button = page.getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await paint(page);
};
const storage = page => page.evaluate(() => ({
  entries: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
  writes: window.__previewStorageWrites,
}));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(seed => {
    if (!sessionStorage.getItem('preview-smoke-seeded')) {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      sessionStorage.setItem('preview-smoke-seeded', 'true');
    }
    const original = Storage.prototype.setItem;
    window.__previewStorageWrites = [];
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) window.__previewStorageWrites.push(key);
      return original.call(this, key, value);
    };
  }, stored);
  await installCapture(page);
  await page.goto(`${baseURL}/?preview=character`);
  await enterFullscreen(page);
  await expect(page.getByTestId('character-preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Base', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('game-canvas')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  expect(await storage(page)).toEqual({ entries: stored, writes: [] });

  await choose(page, 'Field');
  await page.screenshot({ path: `${directory}/${output}.png`, fullPage: true });
  await page.locator('.character-stage').screenshot({ path: `${directory}/${output}-stage.png` });
  await choose(page, 'Heavy');
  await choose(page, 'Crouch');
  await expect(page.getByRole('slider', { name: 'Crouch depth', exact: true })).toHaveValue('100');
  await choose(page, 'Look up');
  await expect(page.getByRole('slider', { name: 'Look direction', exact: true })).toHaveValue('-90');
  await page.getByRole('button', { name: 'Face left', exact: true }).click();
  await choose(page, 'Look down');
  await expect(page.getByRole('slider', { name: 'Look direction', exact: true })).toHaveValue('90');
  await page.getByRole('checkbox', { name: 'Show face clearly', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Show joints', exact: true }).check();
  await choose(page, 'Walk');
  await page.getByRole('slider', { name: 'Animation phase', exact: true }).fill('35');
  await page.getByRole('checkbox', { name: 'Walk backwards', exact: true }).check();
  await paint(page);
  await page.getByRole('img', { name: /^Enlarged / }).screenshot({ path: `${directory}/${output}-crouch.png` });
  await expect(page.getByTestId('game-canvas')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  expect(await storage(page)).toEqual({ entries: stored, writes: [] });

  await page.reload();
  await enterFullscreen(page);
  await expect(page.getByTestId('character-preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Base', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await storage(page)).toEqual({ entries: stored, writes: [] });
  await page.setViewportSize({ width: 320, height: 844 });
  await paint(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('preview')).toBe(false);
  await expect(page.getByRole('button', { name: 'Enter practice', exact: true })).toBeVisible();
  await page.getByText('Studio', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crouch preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Character preview', exact: true }).click();
  await expect(page.getByTestId('character-preview')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('preview')).toBe('character');
  expect(errors).toEqual([]);
  console.log(`Character preview smoke passed at ${baseURL}: sample looks, both vertical extremes, facing, crouch walk, joints, temporary face inspection, storage/runtime isolation, reload, 320px width, and menu navigation. Zero browser errors.`);
} finally {
  await browser.close();
}
