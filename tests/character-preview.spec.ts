import { installCapture, enterFullscreen } from './helpers/capture';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await installCapture(page); });

const screenshots = 'docs/screenshots';
const currentSettings = '{ "cosmetics": { "headgear": 2, "shirt": 1, "trousers": 0 }, "muted": true, "reducedMotion": false, "keep": "current settings unchanged" }';
const legacySettings = '{ "cosmetics": { "headgear": 1, "shirt": 2, "trousers": 1 }, "muted": false, "reducedMotion": false, "keep": "legacy settings unchanged" }';
type StorageProbeWindow = Window & { __previewStorageWrites?: string[] };

test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });

function browserErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function paint(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function artwork(canvas: Locator) {
  return canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL());
}

function enlarged(page: Page) { return page.getByRole('img', { name: /^Enlarged / }); }
function native(page: Page, look = 'Base') { return page.getByRole('img', { name: new RegExp(`^Gameplay size ${look}[, ]`) }); }

async function openPreview(page: Page) {
  await page.goto('/?preview=character');
  await enterFullscreen(page);
  await expect(page.getByTestId('character-preview')).toBeVisible();
  await expect(enlarged(page)).toBeVisible();
  await expect(native(page)).toBeVisible();
  await paint(page);
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
}

async function choose(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await paint(page);
}

async function seedStorage(page: Page, legacyOnly: boolean) {
  const entries: Record<string, string> = {
    'low-altitude-settings': legacySettings,
    'preview-qa-sentinel': 'Keep unrelated local data.',
    ...(!legacyOnly ? { 'burnhop-settings': currentSettings } : {}),
  };
  await page.addInitScript(seed => {
    // Seed once, so a reload cannot conceal an accidental write or migration.
    if (!sessionStorage.getItem('preview-qa-seeded')) {
      localStorage.clear();
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      sessionStorage.setItem('preview-qa-seeded', 'true');
    }
    const writes: string[] = [];
    (window as StorageProbeWindow).__previewStorageWrites = writes;
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    const clear = Storage.prototype.clear;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) writes.push(`set:${key}`);
      return setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === localStorage) writes.push(`remove:${key}`);
      return removeItem.call(this, key);
    };
    Storage.prototype.clear = function () {
      if (this === localStorage) writes.push('clear');
      return clear.call(this);
    };
  }, entries);
  return entries;
}

async function assertStorageUntouched(page: Page, expected: Record<string, string>) {
  const result = await page.evaluate(() => ({
    entries: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
    writes: (window as StorageProbeWindow).__previewStorageWrites,
  }));
  expect(result.entries).toEqual(expected);
  expect(result.writes).toEqual([]);
}

for (const legacyOnly of [false, true]) {
  test(`character preview does not save, migrate, or start gameplay with ${legacyOnly ? 'legacy-only' : 'current and legacy'} settings`, async ({ page }) => {
    const errors = browserErrors(page);
    const entries = await seedStorage(page, legacyOnly);
    await openPreview(page);
    await assertStorageUntouched(page, entries);
    await choose(page, 'Heavy');
    await choose(page, 'Crouch');
    await page.getByRole('slider', { name: 'Crouch depth', exact: true }).fill('53');
    await page.getByRole('slider', { name: 'Look direction', exact: true }).fill('-67');
    await page.getByRole('button', { name: 'Face left', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Show face clearly', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Show joints', exact: true }).check();
    await choose(page, 'Walk');
    await page.getByRole('slider', { name: 'Animation phase', exact: true }).fill('37');
    await page.getByRole('button', { name: 'Play motion', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause motion', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
    await assertStorageUntouched(page, entries);

    await page.reload();
    await enterFullscreen(page);
    await expect(page.getByTestId('character-preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Base', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('slider', { name: 'Look direction', exact: true })).toHaveValue('0');
    await expect(page.getByRole('checkbox', { name: 'Show face clearly', exact: true })).not.toBeChecked();
    await assertStorageUntouched(page, entries);
    expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
    expect(errors).toEqual([]);
  });
}

test('all sample looks render at both scales through poses, vertical aim, facing, and accessory inspection', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = browserErrors(page);
  const assetRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/assets/')) assetRequests.push(request.url()); });
  await openPreview(page);
  const initialAssetCount = assetRequests.length;
  const looks = ['Base', 'Field', 'Scout', 'Heavy'];
  const renderedLooks = new Set<string>();

  for (const [index, look] of looks.entries()) {
    await choose(page, look);
    const image = await artwork(enlarged(page));
    renderedLooks.add(image);
    expect(await enlarged(page).evaluate(element => (element as HTMLCanvasElement).width)).toBeGreaterThan(200);
    expect(await native(page, look).evaluate(element => (element as HTMLCanvasElement).height)).toBeGreaterThan(68);
    await page.screenshot({ path: `${screenshots}/${33 + index}-character-${look.toLowerCase()}.png`, fullPage: true });
    await enlarged(page).screenshot({ path: `${screenshots}/${33 + index}-character-${look.toLowerCase()}-detail.png` });
    await native(page, look).screenshot({ path: `${screenshots}/${33 + index}-character-${look.toLowerCase()}-gameplay-size.png` });
  }
  expect(renderedLooks.size).toBe(4);

  // The inspection switch must restore the selected helmet after it is removed.
  await choose(page, 'Field');
  const helmet = await artwork(enlarged(page));
  await page.getByRole('checkbox', { name: 'Show face clearly', exact: true }).check();
  await expect.poll(() => artwork(enlarged(page))).not.toBe(helmet);
  await page.getByRole('checkbox', { name: 'Show face clearly', exact: true }).uncheck();
  await expect.poll(() => artwork(enlarged(page))).toBe(helmet);
  await expect(page.getByRole('button', { name: 'Field', exact: true })).toHaveAttribute('aria-pressed', 'true');

  for (const look of ['Field', 'Scout', 'Heavy']) {
    await choose(page, look);
    for (const facing of ['right', 'left']) {
      if (facing === 'left') await page.getByRole('button', { name: 'Face left', exact: true }).click();
      for (const [direction, pitch] of [['up', '-90'], ['down', '90']] as const) {
        await choose(page, `Look ${direction}`);
        await expect(page.getByRole('slider', { name: 'Look direction', exact: true })).toHaveValue(pitch);
        await choose(page, 'Stand');
        const standing = await artwork(enlarged(page));
        await choose(page, 'Crouch');
        await expect(page.getByRole('slider', { name: 'Crouch depth', exact: true })).toHaveValue('100');
        expect(await artwork(enlarged(page))).not.toBe(standing);
        await enlarged(page).screenshot({ path: `${screenshots}/37-character-${look.toLowerCase()}-crouch-${facing}-${direction}.png` });
      }
    }
    await page.getByRole('button', { name: 'Face right', exact: true }).click();
  }

  await choose(page, 'Level');
  await choose(page, 'Base');
  for (const pose of ['Walk', 'Jump', 'Jet']) {
    await choose(page, pose);
    if (pose === 'Walk') await page.getByRole('slider', { name: 'Crouch depth', exact: true }).fill('0');
    await page.getByRole('slider', { name: 'Animation phase', exact: true }).fill('35');
    await paint(page);
    await enlarged(page).screenshot({ path: `${screenshots}/38-character-${pose.toLowerCase()}.png` });
    if (pose === 'Walk') {
      const forward = await artwork(enlarged(page));
      const backward = page.getByRole('checkbox', { name: 'Walk backwards', exact: true });
      await backward.check();
      await expect.poll(() => artwork(enlarged(page))).not.toBe(forward);
      await enlarged(page).screenshot({ path: `${screenshots}/38-character-walk-backward.png` });
      await backward.uncheck();
      await expect.poll(() => artwork(enlarged(page))).toBe(forward);
      await page.getByRole('slider', { name: 'Crouch depth', exact: true }).fill('100');
      await paint(page);
      await enlarged(page).screenshot({ path: `${screenshots}/38-character-crouch-walk.png` });
    }
  }
  await page.getByRole('checkbox', { name: 'Show joints', exact: true }).check();
  await paint(page);
  await enlarged(page).screenshot({ path: `${screenshots}/38-character-jet-joints.png` });
  expect(assetRequests.length).toBe(initialAssetCount);
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('motion can pause and scrub, while reduced motion preserves manual keyboard controls', async ({ page, browser }) => {
  const errors = browserErrors(page);
  await openPreview(page);
  await choose(page, 'Walk');
  const phase = page.getByRole('slider', { name: 'Animation phase', exact: true });
  await phase.fill('25');
  const frozen = await artwork(enlarged(page));
  await page.getByRole('button', { name: 'Play motion', exact: true }).click();
  await expect.poll(() => artwork(enlarged(page))).not.toBe(frozen);
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  await phase.fill('25');
  await expect.poll(() => artwork(enlarged(page))).toBe(frozen);
  await phase.focus();
  await page.keyboard.press('ArrowRight');
  await expect(phase).toHaveValue('26');

  // Pause while hidden, then return without touching a control. Effect cleanup
  // must not leave a cleared canvas waiting for the next user interaction.
  await page.getByRole('button', { name: 'Play motion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause motion', exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Play motion', exact: true })).toBeVisible();
  await paint(page);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await paint(page);
  expect(await enlarged(page).evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
  const returnedFrame = await artwork(enlarged(page));
  await paint(page);
  expect(await artwork(enlarged(page))).toBe(returnedFrame);

  const reduced = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const reducedErrors = browserErrors(reduced);
  try {
    await openPreview(reduced);
    await expect(reduced.getByRole('button', { name: 'Play motion', exact: true })).toBeDisabled();
    await choose(reduced, 'Crouch');
    const depth = reduced.getByRole('slider', { name: 'Crouch depth', exact: true });
    await expect(depth).toHaveValue('100');
    await depth.fill('50');
    await depth.focus();
    await reduced.keyboard.press('ArrowRight');
    await expect(depth).toHaveValue('51');
    const look = reduced.getByRole('slider', { name: 'Look direction', exact: true });
    await look.focus();
    await reduced.keyboard.press('Home');
    await expect(look).toHaveValue('-90');
    await reduced.keyboard.press('End');
    await expect(look).toHaveValue('90');
    await choose(reduced, 'Jump');
    const reducedPhase = reduced.getByRole('slider', { name: 'Animation phase', exact: true });
    await reducedPhase.fill('63');
    await reducedPhase.focus();
    await reduced.keyboard.press('ArrowLeft');
    await expect(reducedPhase).toHaveValue('62');
    await reduced.screenshot({ path: `${screenshots}/39-character-reduced-motion.png`, fullPage: true });
    expect(await reduced.evaluate(() => window.__BURNHOP__)).toBeUndefined();
    expect(await reduced.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(reducedErrors).toEqual([]);
  } finally { await reduced.close(); }
  expect(errors).toEqual([]);
});

test('preview fits narrow screens and returns to unchanged menu, crouch preview, and practice controls', async ({ page }) => {
  const errors = browserErrors(page);
  await openPreview(page);
  await choose(page, 'Heavy');
  await choose(page, 'Crouch');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await paint(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const image of [enlarged(page), native(page)]) {
      const box = await image.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.height).toBeGreaterThan(68);
    }
    await page.getByRole('button', { name: 'Look up', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Look direction', exact: true })).toHaveValue('-90');
    await page.screenshot({ path: `${screenshots}/40-character-mobile-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('preview')).toBe(false);
  await page.getByText('Studio', { exact: true }).click();
  await page.getByRole('button', { name: 'Character preview', exact: true }).click();
  await expect(page.getByTestId('character-preview')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('preview')).toBe('character');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByText('Studio', { exact: true }).click();
  await page.getByRole('button', { name: 'Crouch preview', exact: true }).click();
  await expect(page.getByTestId('crouch-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.crouchAmount === 1);
  await page.keyboard.up('KeyS');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.crouchAmount === 0);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.__BURNHOP__!.snapshot().player.grounded);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
