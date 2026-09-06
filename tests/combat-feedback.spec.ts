import { test, expect, type Page } from '@playwright/test';

async function opacity(page: Page) {
  return page.getByTestId('combat-feedback').evaluate(element => ({
    red: Number(getComputedStyle(element.children[0]).opacity),
    blue: Number(getComputedStyle(element.children[1]).opacity),
  }));
}

test('lethal damage and a credited trade kill decay after death while heartbeat stops', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixtures/feedback.html');
  await page.getByRole('button', { name: 'Enter low health', exact: true }).click();
  await expect(page.getByTestId('feedback-audio')).toContainText('"heartbeat":true');
  await expect.poll(async () => (await opacity(page)).red).toBeGreaterThan(0);
  const observed = page.evaluate(() => new Promise<Array<{ red: number; blue: number }>>(resolve => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === 'Lethal hit and credited trade kill')!;
    button.addEventListener('click', () => {
      const started = performance.now(), samples: Array<{ red: number; blue: number }> = [];
      const sample = () => {
        const edges = document.querySelector('[data-testid="combat-feedback"]')!.children;
        samples.push({ red: Number(getComputedStyle(edges[0]).opacity), blue: Number(getComputedStyle(edges[1]).opacity) });
        if (performance.now() - started < 450) requestAnimationFrame(sample);
        else resolve(samples);
      };
      requestAnimationFrame(sample);
    }, { once: true });
  }));
  await page.getByRole('button', { name: 'Lethal hit and credited trade kill', exact: true }).click();
  await expect(page.getByTestId('health')).toHaveText('0');
  await expect(page.getByTestId('feedback-audio')).toContainText('"heartbeat":false');
  await expect(page.getByTestId('feedback-audio')).toContainText('"voices":0');
  const samples = await observed;
  expect(samples.some(sample => sample.red > .12)).toBe(true);
  expect(samples.some(sample => sample.blue > 0 && sample.red === 0)).toBe(true);
  expect(samples.every(sample => sample.red <= .18 && sample.blue <= .12)).toBe(true);
  expect(samples.at(-1)).toEqual({ red: 0, blue: 0 });
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 780 }]) {
  test(`reduced-motion feedback remains still and leaves the ${viewport.width}px playfield clear`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/tests/fixtures/feedback.html');
    await page.getByRole('button', { name: 'Enter low health', exact: true }).click();
    await expect.poll(() => opacity(page)).toEqual({ red: .05, blue: 0 });
    await page.waitForTimeout(220);
    expect(await opacity(page)).toEqual({ red: .05, blue: 0 });
    const bounds = await page.getByTestId('combat-feedback').boundingBox();
    expect(bounds).toEqual({ x: 0, y: 0, ...viewport });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await expect(page.getByTestId('combat-feedback')).toHaveCSS('pointer-events', 'none');
    await page.screenshot({ path: testInfo.outputPath(`feedback-reduced-${viewport.width}.png`) });
  });
}
