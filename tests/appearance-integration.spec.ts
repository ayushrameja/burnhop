import { installCapture, openMenu, moveAim } from './helpers/capture';
import { choosePracticeLoadout, cycleViewTo } from './helpers/combat';
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { BOT_APPEARANCE, CHARACTER_LOOKS } from '../src/game/appearance';

test.beforeEach(async ({ page }) => { await installCapture(page); });

for (const look of CHARACTER_LOOKS.filter(look => look.id !== 'base')) {
  test(`${look.name} appearance carries into the menu, crouch study and practice without changing gameplay dimensions`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const saved = { version: 2, appearance: look.appearance, savedLooks: [], muted: true, reducedMotion: true };
    await page.addInitScript(value => localStorage.setItem('burnhop-settings', JSON.stringify(value)), saved);
    await openMenu(page);
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: `docs/screenshots/46-${look.id}-menu.png` });
    await page.getByText('Studio', { exact: true }).click();
    await page.getByRole('button', { name: 'Crouch preview', exact: true }).click();
    await expect(page.getByTestId('crouch-preview')).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/46-${look.id}-crouch-study.png`, fullPage: true });
    await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
    await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
    await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
    await choosePracticeLoadout(page, 'm416');
    await cycleViewTo(page, 2.5);
    const before = await page.evaluate(() => window.__BURNHOP__!.snapshot());
    const appearances = await page.evaluate(() => window.__BURNHOP__!.appearances());
    expect(appearances.player).toEqual(look.appearance);
    expect(appearances.target).toEqual(BOT_APPEARANCE);
    expect(before.player.width).toBe(36);
    expect(before.player.height).toBe(68);
    const feet = before.player.y + before.player.height;
    await page.keyboard.down('KeyC');
    await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.crouchAmount === 1);
    const crouching = await page.evaluate(() => window.__BURNHOP__!.snapshot().player);
    expect(crouching.width).toBe(36);
    expect(crouching.height).toBeCloseTo(54.2006, 2);
    expect(crouching.y + crouching.height).toBeCloseTo(feet, 8);
    const target = await page.evaluate(() => {
      const api = window.__BURNHOP__!, target = api.snapshot().target;
      return api.toScreen(target.x + target.width / 2, target.y + target.height / 2);
    });
    await moveAim(page, target.x, target.y); await page.mouse.down();
    await page.waitForFunction(() => window.__BURNHOP__!.snapshot().hits >= 1);
    await page.mouse.up();
    await page.waitForFunction(() => window.__BURNHOP__!.snapshot().target.hitTicks === 0);
    await page.screenshot({ path: `docs/screenshots/46-${look.id}-practice-crouch.png` });
    await page.keyboard.up('KeyC');
    await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.crouchAmount === 0);
    await page.screenshot({ path: `docs/screenshots/46-${look.id}-practice.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('burnhop-settings')!).appearance)).toEqual(look.appearance);
    expect(errors).toEqual([]);
  });
}
