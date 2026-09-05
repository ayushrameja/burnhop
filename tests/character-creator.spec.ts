import { installCapture, openMenu, enterMenu } from './helpers/capture';
import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { APPEARANCE_PARTS, DEFAULT_APPEARANCE } from '../src/game/appearance';
import type { Settings } from '../src/game/settings';

test.beforeEach(async ({ page }) => { await installCapture(page); });

const screenshots = 'docs/screenshots';
test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('burnhop-settings')!) as Settings);
const category = (page: Page, name: string) => page.getByRole('navigation', { name: 'Character categories' }).getByRole('button', { name, exact: true });
const stage = (page: Page) => page.getByRole('img', { name: /^Your character, / });
const imageData = (page: Page) => stage(page).evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
async function openCreator(page: Page) {
  await openMenu(page);
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await expect(page.getByTestId('character-creator')).toBeVisible();
  await expect(stage(page)).toBeVisible();
}
async function choose(page: Page, section: string, option: string) {
  await category(page, section).click();
  const button = page.getByRole('group', { name: `${section} styles`, exact: true }).getByRole('button', { name: option, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}
function errorsOn(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

test('every catalog item is selectable and rendered, with independent colours and outfit identity preservation', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = errorsOn(page);
  await openCreator(page);
  let loaded = 0;
  page.on('request', request => { if (request.url().includes('/assets/')) loaded++; });
  for (const part of APPEARANCE_PARTS) {
    await category(page, part.label).click();
    const group = page.getByRole('group', { name: `${part.label} styles`, exact: true });
    await expect(group.getByRole('button')).toHaveCount(part.options.length);
    for (const option of part.options) {
      const button = group.getByRole('button', { name: option.label, exact: true });
      await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
      expect((await stored(page)).appearance[part.id]).toBe(option.id);
      expect(await button.locator('canvas').evaluate(element => {
        const canvas = element as HTMLCanvasElement;
        return canvas.width > 0 && canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((channel, index) => index % 4 === 3 && channel > 0);
      })).toBe(true);
    }
  }
  await choose(page, 'Hair', 'Spiky');
  await page.getByRole('button', { name: 'Hair colour: Blond', exact: true }).click();
  await choose(page, 'Beard', 'Goatee');
  await page.getByRole('button', { name: 'Beard colour: Black', exact: true }).click();
  await choose(page, 'Body build', 'Slim');
  await choose(page, 'Top', 'T-shirt');
  await page.getByRole('button', { name: 'Top colour: Rust', exact: true }).click();
  await choose(page, 'Trousers', 'Cargo');
  await page.getByRole('button', { name: 'Trousers colour: Navy', exact: true }).click();
  const before = (await stored(page)).appearance;
  expect(before).toMatchObject({ hairColor: 'blond', beardColor: 'black', topColor: 'rust', trousersColor: 'navy' });
  await category(page, 'Complete outfits').click();
  await page.getByRole('button', { name: 'Wear Heavy', exact: true }).click();
  const after = (await stored(page)).appearance;
  for (const part of APPEARANCE_PARTS.filter(part => part.group === 'Hair' || part.group === 'Face')) {
    expect(after[part.id]).toEqual(before[part.id]);
    if (part.colorKey) expect(after[part.colorKey]).toEqual(before[part.colorKey]);
  }
  expect(after).toMatchObject({ vest: 'armoured', boots: 'armoured', topColor: 'slate', build: 'slim' });
  expect(loaded).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${screenshots}/43-creator-outfits-desktop.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('saved looks retain snapshots through edits, restore, update, rename, delete, undo, and reload', async ({ page }) => {
  const errors = errorsOn(page);
  await openCreator(page);
  await choose(page, 'Eyes', 'Relaxed');
  const first = (await stored(page)).appearance;
  await page.getByRole('button', { name: 'Keep this look', exact: true }).click();
  await expect(page.getByLabel('Name this look', { exact: true })).toBeFocused();
  await page.getByLabel('Name this look', { exact: true }).fill('Night shift');
  await page.getByRole('button', { name: 'Save new look', exact: true }).click();
  expect((await stored(page)).savedLooks[0]).toMatchObject({ name: 'Night shift', appearance: first });
  await choose(page, 'Eyes', 'Narrow');
  expect((await stored(page)).savedLooks[0].appearance.eyes).toBe('relaxed');
  await category(page, 'Saved looks').click();
  await page.getByRole('button', { name: 'Apply Night shift', exact: true }).click();
  expect((await stored(page)).appearance).toEqual(first);
  await choose(page, 'Mouth', 'Smile');
  await category(page, 'Saved looks').click();
  await page.getByRole('button', { name: 'Update Night shift with current appearance', exact: true }).click();
  expect((await stored(page)).savedLooks[0].appearance.mouth).toBe('smile');
  await page.getByRole('button', { name: 'Rename Night shift', exact: true }).click();
  await expect(page.getByLabel('New name for Night shift', { exact: true })).toBeFocused();
  await page.getByLabel('New name for Night shift', { exact: true }).fill('Dawn patrol');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rename Dawn patrol', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Delete Dawn patrol', exact: true }).click();
  expect((await stored(page)).savedLooks).toEqual([]);
  await choose(page, 'Eyebrows', 'Thick');
  await page.getByRole('button', { name: 'Undo delete', exact: true }).click();
  const final = await stored(page);
  expect(final.savedLooks).toHaveLength(1);
  expect(final.savedLooks[0].name).toBe('Dawn patrol');
  expect(final.appearance.eyebrows).toBe('thick');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await page.reload();
  await enterMenu(page);
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  expect(await stored(page)).toEqual(final);
  await category(page, 'Saved looks').click();
  await expect(page.getByRole('button', { name: 'Apply Dawn patrol', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${screenshots}/44-creator-saved-looks.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('legacy settings migrate on entry and the selected appearance reaches practice with a separate bot look', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('low-altitude-settings', JSON.stringify({ cosmetics: { headgear: 2, shirt: 1, trousers: 2 }, muted: true, reducedMotion: true })));
  await openCreator(page);
  expect(await stored(page)).toMatchObject({ version: 3, muted: true, reducedMotion: true, appearance: { headgearColor: 'slate', topColor: 'sand', trousersColor: 'slate' } });
  await choose(page, 'Body build', 'Broad');
  await choose(page, 'Hair', 'Tied back');
  await choose(page, 'Headgear', 'None');
  const appearance = (await stored(page)).appearance;
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  const rendered = await page.evaluate(() => window.__BURNHOP__!.appearances());
  expect(rendered.player).toEqual(appearance);
  expect(rendered.target).not.toEqual(appearance);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});

test('narrow creator remains usable with keyboard controls and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openCreator(page);
  await expect(page.getByRole('checkbox', { name: 'Preview motion', exact: true })).toBeDisabled();
  const stand = await imageData(page);
  await page.getByRole('button', { name: 'Crouch', exact: true }).click();
  await expect.poll(() => imageData(page)).not.toBe(stand);
  const slider = page.getByRole('slider', { name: 'Look direction', exact: true });
  await slider.focus(); await page.keyboard.press('Home'); await expect(slider).toHaveValue('-90');
  await page.keyboard.press('End'); await expect(slider).toHaveValue('90');
  await page.getByRole('button', { name: 'Face left', exact: true }).click();
  await category(page, 'Hair').click();
  const spiky = page.getByRole('button', { name: 'Spiky', exact: true });
  await spiky.focus(); await page.keyboard.press('Enter'); await expect(spiky).toHaveAttribute('aria-pressed', 'true');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const preview = await page.getByRole('complementary', { name: 'Your character preview' }).boundingBox();
    const categories = await page.getByRole('navigation', { name: 'Character categories' }).boundingBox();
    expect(preview!.y).toBeLessThan(categories!.y);
    await page.screenshot({ path: `${screenshots}/45-creator-mobile-${width}.png`, fullPage: true });
  }
});

test('unavailable local storage leaves live edits and named looks usable for the visit', async ({ page }) => {
  const errors = errorsOn(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Storage is unavailable.', 'QuotaExceededError'); };
  });
  await openCreator(page);
  await expect(page.getByText('Changes work for this visit; local saving is unavailable.', { exact: true })).toBeVisible();
  await choose(page, 'Body build', 'Broad');
  await page.getByRole('button', { name: 'Keep this look', exact: true }).click();
  await page.getByLabel('Name this look', { exact: true }).fill('This visit');
  await page.getByRole('button', { name: 'Save new look', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply This visit', exact: true })).toBeVisible();
  await choose(page, 'Body build', 'Slim');
  await category(page, 'Saved looks').click();
  await page.getByRole('button', { name: 'Apply This visit', exact: true }).click();
  await category(page, 'Body build').click();
  await expect(page.getByRole('button', { name: 'Broad', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await choose(page, 'Mouth', 'Smile');
  await category(page, 'Saved looks').click();
  await expect(page.getByRole('button', { name: 'Apply This visit', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('invalid saved identifiers fall back per part while valid appearance and settings remain', async ({ page }) => {
  await page.addInitScript(appearance => localStorage.setItem('burnhop-settings', JSON.stringify({
    version: 2, appearance: { ...appearance, hair: 'missing-hair', eyes: 'relaxed', bootsColor: 'unknown', skin: 'deep' },
    savedLooks: [], muted: true, reducedMotion: false,
  })), DEFAULT_APPEARANCE);
  await openCreator(page);
  expect(await stored(page)).toMatchObject({ muted: true, reducedMotion: false, appearance: {
    hair: DEFAULT_APPEARANCE.hair, bootsColor: DEFAULT_APPEARANCE.bootsColor, eyes: 'relaxed', skin: 'deep',
  } });
  await page.screenshot({ path: `${screenshots}/46-creator-desktop.png`, fullPage: true });
});
