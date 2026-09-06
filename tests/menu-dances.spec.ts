import { expect, test } from '@playwright/test';
import { installCapture, enterMenu } from './helpers/capture';

for (const width of [1440, 390]) {
  test(`menu choreography at ${width}px and reduced motion`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installCapture(page);
    await page.goto('/');
    const pilot = page.getByTestId('entry-dancer');
    await expect(pilot).toBeVisible();
    const initial = await pilot.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await expect.poll(() => pilot.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(initial);
    await page.screenshot({ path: testInfo.outputPath(`moonwalk-${width}.png`) });
    await enterMenu(page);
    const lobby = page.getByRole('img', { name: 'Pilot dancing bhangra in the hangar' });
    await expect(lobby).toBeVisible();
    const pose = await lobby.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await expect.poll(() => lobby.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(pose);
    await page.screenshot({ path: testInfo.outputPath(`bhangra-${width}.png`) });
    await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
    await page.getByRole('tab', { name: 'Motion' }).click();
    await page.getByRole('checkbox', { name: /reduced motion/i }).check();
    await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
    const still = await lobby.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await page.waitForTimeout(250);
    expect(await lobby.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(still);
    await page.evaluate(() => document.exitFullscreen());
    const entryStill = await pilot.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await page.waitForTimeout(250);
    expect(await pilot.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(entryStill);
  });
}
