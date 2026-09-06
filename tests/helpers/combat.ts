import { expect, type Page } from '@playwright/test';
import type { WeaponId } from '../../src/game/types';
import type { ZoomLevel } from '../../src/game/camera';

/** Exercise the actual practice loadout controls; diagnostics remain read-only assertions. */
export async function choosePracticeLoadout(page: Page, main: WeaponId, offhand: WeaponId | null = null) {
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Practice weapon', exact: true }).selectOption(main);
  const second = page.getByRole('combobox', { name: 'Second hand', exact: true });
  if (await second.isEnabled()) await second.selectOption(offhand ?? '');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__!.metrics().running && window.__BURNHOP__!.snapshot().player.equipTicks === 0);
  await expect(page.getByTestId('game-canvas')).toBeFocused();
}

export async function cycleViewTo(page: Page, level: ZoomLevel) {
  for (let i = 0; i < 6; i++) {
    if (await page.evaluate(level => window.__BURNHOP__!.camera().zoomLevel === level, level)) return;
    await page.keyboard.press('Tab');
  }
  await expect(page.getByTestId('zoom-level')).toContainText(`${level}x`);
}
