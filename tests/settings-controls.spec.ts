import { installCapture, openMenu, enterMenu } from './helpers/capture';
import { test, expect, type Page } from '@playwright/test';
import { defaultSettings, SETTINGS_STORAGE_KEY, type Settings } from '../src/game/settings';

test.beforeEach(async ({ page }) => { await installCapture(page); });

async function openSettings(page: Page) {
  await openMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
}

async function saved(page: Page): Promise<Settings> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SETTINGS_STORAGE_KEY);
}

async function bind(page: Page, label: string, key: string) {
  await page.getByRole('button', { name: `Change ${label} binding`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Press a key or mouse button.' })).toBeVisible();
  await page.keyboard.press(key);
  await expect(page.getByRole('heading', { name: 'Press a key or mouse button.' })).toBeHidden();
}

async function enter(page: Page) {
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await ticks(page, 3);
}

async function ticks(page: Page, count = 3) {
  const target = await page.evaluate(count => window.__BURNHOP__!.snapshot().tick + count, count);
  await page.waitForFunction(target => window.__BURNHOP__!.snapshot().tick >= target, target);
}

test('v2 saves migrate intact and all settings persist after reloading', async ({ page }, testInfo) => {
  const legacy = { ...defaultSettings(false), version: 2 } as Record<string, unknown>;
  delete legacy.controls;
  delete legacy.audio;
  legacy.appearance = { ...defaultSettings(false).appearance, hair: 'tied-back', topColor: 'navy' };
  legacy.savedLooks = [{ id: 'night-shift', name: 'Night shift', appearance: legacy.appearance }];
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: SETTINGS_STORAGE_KEY, value: legacy });
  await openSettings(page);
  const migrated = await saved(page);
  expect(migrated.version).toBe(3);
  expect(migrated.appearance).toEqual(legacy.appearance);
  expect(migrated.savedLooks).toEqual(legacy.savedLooks);
  expect(migrated.controls).toEqual(defaultSettings(false).controls);
  expect(migrated.audio).toEqual(defaultSettings(false).audio);
  await bind(page, 'Move left primary', 'KeyJ');
  await page.getByRole('combobox', { name: 'Crouch behavior', exact: true }).selectOption('toggle');
  await page.screenshot({ path: testInfo.outputPath('settings-bindings-desktop.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Aiming' }).click();
  await page.getByRole('button', { name: 'Default aim: pointer crosshair' }).click();
  await page.getByRole('combobox', { name: 'Alternate aim behavior' }).selectOption('toggle');
  await page.getByRole('tab', { name: 'Audio' }).click();
  await page.getByRole('checkbox', { name: 'Master sound' }).uncheck();
  await page.getByRole('tab', { name: 'Motion' }).click();
  await page.getByRole('checkbox', { name: 'Reduced motion' }).check();
  const chosen = await saved(page);
  expect(chosen).toMatchObject({ muted: true, reducedMotion: true, controls: {
    bindings: { moveLeft: ['KeyJ', null] }, behavior: { crouch: 'toggle', aimSwitch: 'toggle' }, defaultAimMode: 'pointer',
  } });
  expect(chosen.appearance).toEqual(legacy.appearance);
  expect(chosen.savedLooks).toEqual(legacy.savedLooks);
  await page.reload();
  await enterMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change Move left primary binding' })).toContainText('J');
  await expect(page.getByRole('combobox', { name: 'Crouch behavior', exact: true })).toHaveValue('toggle');
  await page.getByRole('tab', { name: 'Aiming' }).click();
  await expect(page.getByRole('button', { name: 'Default aim: pointer crosshair' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Alternate aim behavior' })).toHaveValue('toggle');
  expect(await saved(page)).toEqual(chosen);
});

test('capture owns Escape and Tab, conflict review swaps atomically, and resets preserve other settings', async ({ page }) => {
  await openSettings(page);
  const changeLeft = page.getByRole('button', { name: 'Change Move left primary binding', exact: true });
  await changeLeft.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(changeLeft).toBeFocused();
  expect((await saved(page)).controls.bindings.moveLeft).toEqual(['KeyA', null]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Clear Move left primary binding' })).toBeFocused();
  await bind(page, 'Reload secondary', 'Tab');
  const review = page.getByRole('dialog', { name: 'This binding is already in use.' });
  await expect(review).toBeVisible();
  await expect(review).toContainText('Cycle view range');
  await expect(review).toContainText('Unbound');
  expect((await saved(page)).controls.bindings.zoom).toEqual(['Tab', null]);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await bind(page, 'Move left primary', 'KeyD');
  await expect(review).toContainText('Move right');
  expect((await saved(page)).controls.bindings.moveLeft).toEqual(['KeyA', null]);
  await review.getByRole('button', { name: 'Swap bindings' }).click();
  expect((await saved(page)).controls.bindings).toMatchObject({ moveLeft: ['KeyD', null], moveRight: ['KeyA', null] });
  await page.getByRole('button', { name: 'Reset Move left controls', exact: true }).click();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Swap bindings' }).click();
  expect((await saved(page)).controls.bindings).toMatchObject({ moveLeft: ['KeyA', null], moveRight: ['KeyD', null] });
  await bind(page, 'Move left primary', 'KeyJ');
  await page.getByRole('combobox', { name: 'Fire behavior', exact: true }).selectOption('toggle');
  await page.getByRole('tab', { name: 'Audio' }).click();
  await page.getByRole('checkbox', { name: 'Master sound' }).uncheck();
  const beforeReset = await saved(page);
  await page.getByRole('tab', { name: 'Bindings' }).click();
  await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  const reset = page.getByRole('dialog', { name: 'Restore default controls?' });
  await expect(reset).toContainText('Move left');
  await reset.getByRole('button', { name: 'Reset controls', exact: true }).click();
  const result = await saved(page);
  expect(result.controls).toEqual(defaultSettings(false).controls);
  expect({ ...result, controls: beforeReset.controls }).toEqual(beforeReset);
});

test('mouse side buttons can be captured without clicking through or invoking browser defaults', async ({ page }) => {
  await openSettings(page);
  for (const button of [3, 4]) {
    await page.getByRole('button', { name: 'Change Reload secondary binding', exact: true }).click();
    const prevented = await page.evaluate(button => {
      const target = document.getElementById('binding-capture-title')!;
      const values = [];
      for (const type of ['mousedown', 'mouseup', 'auxclick']) {
        const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        values.push(event.defaultPrevented);
      }
      return values;
    }, button);
    expect(prevented).toEqual([true, true, true]);
    await expect(page.getByRole('heading', { name: 'Press a key or mouse button.' })).toBeHidden();
    expect((await saved(page)).controls.bindings.reload[1]).toBe(`Mouse${button}`);
    await expect(page.getByTestId('settings-screen')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Change Reload secondary binding', exact: true }).click();
  await page.mouse.click(600, 450, { button: 'middle' });
  await expect(page.getByRole('heading', { name: 'Press a key or mouse button.' })).toBeHidden();
  expect((await saved(page)).controls.bindings.reload[1]).toBe('Mouse1');
});

test('pause settings retain the session, contain focus, and apply new bindings only after resume', async ({ page }) => {
  await openMenu(page);
  await enter(page);
  await page.keyboard.down('KeyD');
  await ticks(page, 15);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const before = await page.evaluate(() => window.__BURNHOP__!.snapshot());
  await expect(page.getByRole('heading', { name: 'SETTINGS', exact: true })).toBeFocused();
  await bind(page, 'Move right primary', 'KeyL');
  await expect(page.getByRole('button', { name: 'Change Move right primary binding', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Back to pause', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Reset Pause controls', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Back to pause', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot())).toEqual(before);
  expect(await page.evaluate(() => ({ running: window.__BURNHOP__!.metrics().running, fullscreen: document.fullscreenElement !== null, lock: document.pointerLockElement })))
    .toEqual({ running: false, fullscreen: true, lock: null });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await ticks(page, 8);
  const start = await page.evaluate(() => window.__BURNHOP__!.snapshot().player.x);
  await page.keyboard.down('KeyD');
  await ticks(page, 10);
  await page.keyboard.up('KeyD');
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.x)).toBeCloseTo(start, 4);
  await page.keyboard.down('KeyL');
  await ticks(page, 10);
  await page.keyboard.up('KeyL');
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.x)).toBeGreaterThan(start + 10);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().tick)).toBeGreaterThan(before.tick);
});

test('pointer default, toggled aiming and firing, and separate jetpack work in the resumed game', async ({ page }) => {
  await openSettings(page);
  await bind(page, 'Switch aim style primary', 'KeyQ');
  await expect(page.getByRole('dialog', { name: 'This binding is already in use.' })).toContainText('Pair weapon');
  await page.getByRole('button', { name: 'Swap bindings', exact: true }).click();
  await bind(page, 'Fire primary', 'KeyF');
  await expect(page.getByRole('dialog', { name: 'This binding is already in use.' })).toContainText('Punch');
  await page.getByRole('button', { name: 'Swap bindings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Fire behavior', exact: true }).selectOption('toggle');
  await page.getByRole('combobox', { name: 'Jump and jetpack controls' }).selectOption('separate');
  await expect(page.getByRole('button', { name: 'Change Jetpack primary binding' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Change Jetpack primary binding' })).toContainText('W');
  await page.getByRole('tab', { name: 'Aiming' }).click();
  await page.getByRole('button', { name: 'Default aim: pointer crosshair' }).click();
  await page.getByRole('combobox', { name: 'Alternate aim behavior' }).selectOption('toggle');
  await page.getByRole('button', { name: 'Back to menu' }).click();
  await enter(page);
  expect(await page.evaluate(() => window.__BURNHOP__!.aim().mode)).toBe('pointer');
  await page.keyboard.press('KeyQ');
  await ticks(page);
  expect(await page.evaluate(() => window.__BURNHOP__!.aim().mode)).toBe('radial');
  await page.keyboard.press('KeyQ');
  await ticks(page);
  expect(await page.evaluate(() => window.__BURNHOP__!.aim().mode)).toBe('pointer');
  await page.keyboard.press('KeyF');
  await ticks(page, 8);
  expect(await page.evaluate(() => window.__BURNHOP__!.aim().firing)).toBe(true);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().shotsFired)).toBeGreaterThan(0);
  await page.keyboard.press('KeyF');
  await ticks(page);
  expect(await page.evaluate(() => window.__BURNHOP__!.aim().firing)).toBe(false);
  await page.keyboard.down('KeyW');
  await ticks(page, 10);
  const flying = await page.evaluate(() => window.__BURNHOP__!.snapshot().player);
  expect(flying.grounded).toBe(false);
  expect(flying.thrusting).toBe(true);
  expect(flying.fuel).toBeLessThan(100);
  await page.keyboard.up('KeyW');
  await ticks(page);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.thrusting)).toBe(false);
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyF');
  await ticks(page);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__BURNHOP__!.aim())).toMatchObject({ mode: 'pointer', firing: false });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await ticks(page);
  expect(await page.evaluate(() => window.__BURNHOP__!.aim())).toMatchObject({ mode: 'pointer', firing: false });
});

test('narrow settings remain usable without horizontal overflow and report unavailable saving', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Saving denied for this test'); }; });
  await openSettings(page);
  await expect(page.getByText('Changes work for this visit; local saving is unavailable.')).toBeVisible();
  await bind(page, 'Move left primary', 'KeyJ');
  await expect(page.getByRole('button', { name: 'Change Move left primary binding' })).toContainText('J');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-bindings-narrow.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Aiming' }).click();
  await page.getByRole('button', { name: 'Default aim: pointer crosshair' }).click();
  await expect(page.getByRole('button', { name: 'Default aim: pointer crosshair' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-aiming-narrow.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Audio' }).click();
  const music = page.getByRole('slider', { name: 'Menu music volume' });
  await music.focus();
  await page.keyboard.press('ArrowRight');
  await expect(music).toHaveValue('11');
  await expect(music).toHaveAttribute('aria-valuetext', '11%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-audio-narrow.png'), fullPage: true });
});

test('audio sliders save keyboard edits, restore after reload and reset only the mix', async ({ page }, testInfo) => {
  await openSettings(page);
  await bind(page, 'Move left primary', 'KeyJ');
  await page.getByRole('tab', { name: 'Motion' }).click();
  await page.getByRole('checkbox', { name: 'Reduced motion' }).check();
  await page.getByRole('tab', { name: 'Audio' }).click();
  const channels = [
    ['Master volume', '74'], ['Menu music volume', '6'], ['Weapons & reload volume', '0'],
    ['Movement & jetpack volume', '67'], ['Menu effects volume', '29'],
  ];
  await expect(page.getByRole('slider', { name: 'Menu music volume' })).toHaveValue('10');
  for (const [name, value] of channels) {
    const slider = page.getByRole('slider', { name, exact: true });
    await slider.fill(value);
    await expect(slider).toHaveAttribute('aria-valuetext', `${value}%`);
  }
  const music = page.getByRole('slider', { name: 'Menu music volume' });
  await music.focus();
  await page.keyboard.press('ArrowRight');
  await expect(music).toHaveValue('7');
  await page.getByRole('checkbox', { name: 'Master sound' }).uncheck();
  const chosen = await saved(page);
  expect(chosen.audio).toEqual({ masterVolume: 0.74, musicVolume: 0.07, weaponsVolume: 0, movementVolume: 0.67, uiVolume: 0.29, feedbackVolume: 0.8 });
  expect(chosen).toMatchObject({ muted: true, reducedMotion: true, controls: { bindings: { moveLeft: ['KeyJ', null] } } });
  await page.screenshot({ path: testInfo.outputPath('settings-audio-desktop.png'), fullPage: true });
  await page.reload();
  await enterMenu(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Audio' }).click();
  expect(await saved(page)).toEqual(chosen);
  await expect(page.getByRole('checkbox', { name: 'Master sound' })).not.toBeChecked();
  await expect(music).toHaveValue('7');
  await page.getByRole('button', { name: 'Reset audio to defaults' }).click();
  const reset = await saved(page);
  expect(reset.audio).toEqual(defaultSettings(false).audio);
  expect({ ...reset, audio: chosen.audio }).toEqual(chosen);
  await expect(music).toHaveValue('10');
  await expect(page.getByRole('slider', { name: 'Weapons & reload volume' })).toHaveValue('80');
  await expect(page.getByRole('checkbox', { name: 'Master sound' })).not.toBeChecked();
});
