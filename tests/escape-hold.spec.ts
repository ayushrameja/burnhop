import { test, expect, type Page } from '@playwright/test';
import { installCapture, fixtureState, openMenu, enterPractice } from './helpers/capture';

test.beforeEach(async ({ page }) => {
  await installCapture(page);
  await page.clock.install();
});

async function freezeClock(page: Page) {
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
}

async function expectFullscreen(page: Page) {
  expect((await fixtureState(page)).fullscreen).toBe(true);
  await expect(page.getByTestId('fullscreen-gate')).not.toBeVisible();
}

async function expectExited(page: Page) {
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await expect(page.getByTestId('escape-hold-progress')).not.toBeVisible();
  expect(await fixtureState(page)).toMatchObject({ fullscreen: false, locked: false, keyboard: false });
  expect((await fixtureState(page)).calls.filter(call => call === 'exit-fullscreen')).toHaveLength(1);
}

test('short and repeated Escape taps never exit the menu or flash hold feedback', async ({ page }) => {
  await openMenu(page);
  await freezeClock(page);
  for (let tap = 0; tap < 4; tap++) {
    await page.keyboard.down('Escape');
    await page.clock.runFor(80);
    await expect(page.getByTestId('escape-hold-progress')).not.toBeVisible();
    await page.keyboard.up('Escape');
    await page.clock.runFor(250);
    await expectFullscreen(page);
  }
  await page.clock.runFor(2500);
  await expectFullscreen(page);
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect((await fixtureState(page)).calls).not.toContain('exit-fullscreen');
});

test('hold feedback advances, early release cancels, and the next hold starts from zero', async ({ page }) => {
  await openMenu(page);
  await freezeClock(page);
  const progress = page.getByRole('progressbar', { name: 'Hold Escape to exit fullscreen' });
  await page.keyboard.down('Escape');
  await page.clock.runFor(600);
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute('data-testid', 'escape-hold-progress');
  const partial = Number(await progress.getAttribute('aria-valuenow'));
  expect(partial).toBeGreaterThan(20);
  expect(partial).toBeLessThan(40);
  await expectFullscreen(page);
  await page.keyboard.up('Escape');
  await expect(progress).not.toBeVisible();
  await page.clock.runFor(2500);
  await expectFullscreen(page);

  await page.keyboard.down('Escape');
  await page.clock.runFor(250);
  await expect(progress).toBeVisible();
  expect(Number(await progress.getAttribute('aria-valuenow'))).toBeLessThan(partial);
  await page.clock.runFor(1600);
  await expectFullscreen(page);
  await page.clock.runFor(250);
  await expectExited(page);
  await page.keyboard.up('Escape');
});

test('one continuous hold pauses gameplay immediately and exits after two seconds across the pause transition', async ({ page }) => {
  await openMenu(page);
  await enterPractice(page);
  await freezeClock(page);
  await page.keyboard.down('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByText(/^Hold ESC · 2s$/)).toBeVisible();
  expect(await fixtureState(page)).toMatchObject({ fullscreen: true, locked: false, keyboard: true });
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  const frozen = await page.evaluate(() => window.__BURNHOP__!.snapshot());
  await page.clock.runFor(1000);
  await expect(page.getByTestId('escape-hold-progress')).toBeVisible();
  await expectFullscreen(page);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot())).toEqual(frozen);
  await page.clock.runFor(1100);
  await expectExited(page);
  await expect(page.getByRole('button', { name: 'Return to fullscreen', exact: true })).toBeFocused();
  await page.keyboard.up('Escape');
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot())).toEqual(frozen);
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
});

test('OS key repeats neither restart the hold nor cause an early fullscreen exit', async ({ page }) => {
  await openMenu(page);
  await freezeClock(page);
  await page.keyboard.down('Escape');
  for (let repeat = 0; repeat < 3; repeat++) {
    await page.clock.runFor(500);
    await page.keyboard.down('Escape');
    await expectFullscreen(page);
  }
  await page.clock.runFor(600);
  await expectExited(page);
  await page.clock.runFor(2500);
  expect((await fixtureState(page)).calls.filter(call => call === 'exit-fullscreen')).toHaveLength(1);
  await page.keyboard.up('Escape');
});

for (const interruption of ['blur', 'visibility', 'another key', 'pointer interaction'] as const) {
  test(`${interruption} cancels an Escape hold without a delayed exit`, async ({ page }) => {
    await openMenu(page);
    await freezeClock(page);
    await page.keyboard.down('Escape');
    await page.clock.runFor(600);
    await expect(page.getByTestId('escape-hold-progress')).toBeVisible();
    if (interruption === 'blur') {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    } else if (interruption === 'visibility') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    } else if (interruption === 'another key') {
      await page.keyboard.press('KeyQ');
    } else {
      await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
    }
    await expect(page.getByTestId('escape-hold-progress')).not.toBeVisible();
    await page.clock.runFor(2500);
    await expectFullscreen(page);
    expect((await fixtureState(page)).calls).not.toContain('exit-fullscreen');
    await page.keyboard.up('Escape');
  });
}

test('browser fullscreen loss clears hold feedback and cannot exit a restored session', async ({ page }) => {
  await openMenu(page);
  await freezeClock(page);
  await page.keyboard.down('Escape');
  await page.clock.runFor(600);
  await expect(page.getByTestId('escape-hold-progress')).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());
  await expectExited(page);
  await page.keyboard.up('Escape');
  await page.getByRole('button', { name: 'Return to fullscreen', exact: true }).click();
  await page.clock.runFor(2500);
  await expectFullscreen(page);
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect((await fixtureState(page)).calls.filter(call => call === 'exit-fullscreen')).toHaveLength(1);
});

test('Escape still cancels binding capture and backs out of settings without leaving fullscreen', async ({ page }) => {
  await openMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Change Move left primary binding', exact: true }).click();
  const saved = await page.evaluate(() => localStorage.getItem('burnhop-settings'));
  await freezeClock(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Press a key or mouse button.' })).not.toBeVisible();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('burnhop-settings'))).toBe(saved);
  await expectFullscreen(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await page.clock.runFor(2500);
  await expectFullscreen(page);
  await expect(page.getByTestId('escape-hold-progress')).not.toBeVisible();
});
