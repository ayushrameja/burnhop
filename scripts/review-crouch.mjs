import { installCapture, enterFullscreen } from '../tests/helpers/capture.ts';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Run with the local dev server running: node scripts/review-crouch.mjs.
const browser = await chromium.launch();
const baseURL = process.env.BURNHOP_PREVIEW_URL ?? 'http://127.0.0.1:5173';
const directory = 'docs/screenshots';
await mkdir(directory, { recursive: true });
const errors = [];
const capture = async (page, name) => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  page.on('pageerror', error => errors.push(error.message));
  await installCapture(page);
  await page.goto(`${baseURL}/?preview=crouch`);
  await enterFullscreen(page);
  await expect(page.getByTestId('crouch-preview')).toBeVisible();
  const slider = page.getByRole('slider', { name: 'Crouch depth' });
  await expect(slider).toHaveValue('100');
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  await capture(page, '20-crouch-preview');
  await page.locator('.crouch-comparison').screenshot({ path: `${directory}/20-crouch-comparison.png` });
  console.log('Saved the standing/crouching comparison.');

  const look = page.getByRole('slider', { name: 'Look direction' });
  await expect(look).toHaveValue('0');
  for (const facing of ['right', 'left']) {
    if (facing === 'left') await page.getByRole('button', { name: 'Face left', exact: true }).click();
    for (const [direction, pitch, number] of [['up', '-90', facing === 'right' ? 26 : 28], ['down', '90', facing === 'right' ? 27 : 29]]) {
      const button = page.getByRole('button', { name: `Look ${direction}`, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(look).toHaveValue(pitch);
      await expect(slider).toHaveValue('100');
      await capture(page, `${number}-crouch-${facing}-${direction}`);
      await page.locator('.crouch-comparison').screenshot({ path: `${directory}/${number}-aim-comparison.png` });
    }
    for (const pitch of ['-90', '90']) {
      await look.fill(pitch);
      await expect(look).toHaveValue(pitch);
    }
  }
  await page.getByRole('button', { name: 'Face right', exact: true }).click();
  await page.getByRole('button', { name: 'Level', exact: true }).click();
  await expect(look).toHaveValue('0');
  await look.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(look).toHaveValue('-1');
  await look.fill('0');

  await page.getByRole('button', { name: 'Face left', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show joints' }).check();
  await capture(page, '21-crouch-left-joints');
  await slider.fill('50');
  await expect(page.getByRole('heading', { name: 'Between poses' })).toBeVisible();
  await capture(page, '22-crouch-transition');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('51');

  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(slider).toHaveValue('0');
  await page.getByRole('button', { name: 'Crouch', exact: true }).click();
  await expect(slider).toHaveValue('100');
  await page.getByRole('button', { name: 'Replay transition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop transition' })).toBeVisible();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(10);
  await expect(page.getByRole('button', { name: 'Replay transition' })).toBeVisible();
  await expect(slider).toHaveValue('0');

  await page.getByRole('button', { name: 'Back to menu' }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('preview')).toBe(false);
  await page.getByText('Studio', { exact: true }).click();
  await page.getByRole('button', { name: 'Crouch preview', exact: true }).click();
  await expect(page.getByTestId('crouch-preview')).toBeVisible();
  await page.reload();
  await enterFullscreen(page);
  await expect(page.getByTestId('crouch-preview')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await look.fill('-55');
  await capture(page, '23-crouch-mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const drawingBoxes = await page.locator('.crouch-pose-canvas').evaluateAll(canvases => canvases.map(canvas => {
    const box = canvas.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  }));
  expect(drawingBoxes[0]).toEqual(drawingBoxes[1]);
  const native = await page.locator('.crouch-native-canvas').first().boundingBox();
  expect(native.width).toBe(90);
  expect(native.height).toBe(100);
  await page.setViewportSize({ width: 320, height: 740 });
  await slider.fill('50');
  await capture(page, '25-crouch-small-screen');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  const reduced = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  reduced.on('pageerror', error => errors.push(error.message));
  await installCapture(reduced);
  await reduced.goto(`${baseURL}/?preview=crouch`);
  await enterFullscreen(reduced);
  await expect(reduced.getByRole('button', { name: 'Replay transition' })).toBeDisabled();
  await reduced.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(reduced.getByRole('slider', { name: 'Crouch depth' })).toHaveValue('0');
  await reduced.getByRole('slider', { name: 'Crouch depth' }).fill('75');
  await expect(reduced.getByRole('slider', { name: 'Crouch depth' })).toHaveValue('75');
  await reduced.getByRole('button', { name: 'Look down', exact: true }).click();
  await expect(reduced.getByRole('slider', { name: 'Look direction' })).toHaveValue('90');
  await reduced.getByRole('button', { name: 'Level', exact: true }).click();
  await expect(reduced.getByRole('slider', { name: 'Look direction' })).toHaveValue('0');
  await capture(reduced, '24-crouch-reduced-motion');
  await reduced.getByRole('button', { name: 'Try in practice', exact: true }).click();
  expect(new URL(reduced.url()).searchParams.has('preview')).toBe(false);
  await expect(reduced.getByTestId('game-canvas')).toBeFocused();
  await expect(reduced.getByTestId('fps')).toHaveText(/^\d+ FPS$/);
  expect(errors).toEqual([]);
  console.log('Crouch review passed: desktop/mobile, crouch and look sliders, up/down in both facings, vertical extremes, keyboard, joints, replay, menu navigation, reload, reduced motion, direct practice entry; zero browser errors.');
} finally {
  await browser.close();
}
