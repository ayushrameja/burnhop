import { test, expect } from '@playwright/test';
import { installCapture, fixtureState } from './helpers/capture';

test('lazy multiplayer mount preserves an entrance fullscreen request already in progress', async ({ page }) => {
  await installCapture(page);
  await page.addInitScript(() => {
    const request = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (...args) {
      return new Promise<void>(resolve => {
        (window as Window & { __FINISH_FULLSCREEN__?: () => void }).__FINISH_FULLSCREEN__ = () => {
          void request.apply(this, args).then(resolve);
        };
      });
    };
  });
  let release!: () => void;
  const moduleReady = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/MultiplayerScreen.tsx', async route => {
    await moduleReady;
    await route.continue();
  });
  try {
    await page.goto('/?online=1');
    await page.getByRole('button', { name: 'Enter game', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entering fullscreen…', exact: true })).toBeDisabled();
    release();
    await expect(page.locator('#online-nickname')).toBeAttached();
    // Let the mounted screen's effects run before the browser grants fullscreen.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => (window as Window & { __FINISH_FULLSCREEN__?: () => void }).__FINISH_FULLSCREEN__!());
    await expect(page.getByTestId('fullscreen-gate')).not.toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Nickname', exact: true })).toBeVisible();
    expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: false, keyboard: true });
  } finally {
    release();
  }
});
