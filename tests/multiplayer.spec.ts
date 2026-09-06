import { test, expect, type Page } from '@playwright/test';
import { installCapture, enterFullscreen, fixtureState } from './helpers/capture';

async function openOnline(page: Page, name: string, code = '') {
  await installCapture(page);
  await page.goto(`/?online=1&diagnostics=1${code ? `&room=${code}` : ''}`);
  await enterFullscreen(page);
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill(name);
}
async function exitRoom(page: Page) {
  if (page.isClosed()) return;
  const menu = page.getByRole('button', { name: 'Open match menu', exact: true });
  if (await menu.isVisible()) await page.keyboard.press('Escape');
  const leave = page.getByRole('button', { name: /^(← Leave room|Leave match)$/ });
  if (await leave.isVisible()) await leave.click();
}

test('private invitations, readiness, match capture, locked joins, refresh and host transfer across isolated sessions', async ({ browser, baseURL }, testInfo) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })));
  const [host, guest, late] = await Promise.all(contexts.map(context => context.newPage()));
  const failures: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', error => failures.push(error.message));
  try {
    await openOnline(host, 'Canada Pilot');
    await host.getByRole('button', { name: 'Create private room', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'OUTPOST', exact: true })).toBeVisible();
    expect(await host.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
    const invite = await host.getByRole('textbox', { name: 'Invite link', exact: true }).inputValue();
    expect(new URL(invite).origin).toBe('https://burnhop.lowhp.studio');
    const code = new URL(invite).searchParams.get('room')!;
    expect(code).toMatch(/^[A-F0-9]{20}$/);
    await expect(host.getByRole('button', { name: 'Start match', exact: true })).toBeDisabled();

    await guest.addInitScript(() => {
      localStorage.setItem('burnhop-settings', JSON.stringify({ version: 3, appearance: { headgear: 'beret', topColor: 'rust', skin: 'deep', build: 'broad' } }));
    });
    await openOnline(guest, 'India Pilot', code.toLowerCase());
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'OUTPOST', exact: true })).toBeVisible();
    await expect(host.getByRole('heading', { name: 'India Pilot', exact: true })).toBeVisible();
    await expect(host.getByRole('img', { name: "India Pilot's pilot appearance", exact: true })).toBeVisible();
    await expect(host.getByRole('button', { name: 'Mark ready', exact: true })).toBeEnabled();
    await host.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await guest.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Start match', exact: true })).toBeEnabled();
    await host.screenshot({ path: testInfo.outputPath('lobby-eight-slots.png'), fullPage: true });
    await host.getByRole('button', { name: 'Start match', exact: true }).click();
    await expect(host.getByText(/STARTING IN/)).toBeVisible();
    await guest.getByRole('button', { name: 'Not ready', exact: true }).click();
    await expect(host.getByText(/STARTING IN/)).not.toBeVisible();
    await guest.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Start match', exact: true })).toBeEnabled();
    await host.getByRole('button', { name: 'Start match', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'MATCH CONTINUES', exact: true })).toBeVisible({ timeout: 8000 });
    await expect(guest.getByRole('heading', { name: 'MATCH CONTINUES', exact: true })).toBeVisible();

    await openOnline(late, 'Late Pilot', code);
    await late.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(late.getByRole('alert')).toContainText(/Match in progress/i);
    await host.getByRole('button', { name: 'Enter match', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'MATCH CONTINUES', exact: true })).not.toBeVisible();
    await expect(host.getByRole('button', { name: 'Open match menu', exact: true })).toBeVisible();
    await host.keyboard.down('KeyD');
    await host.waitForTimeout(600);
    await host.keyboard.up('KeyD');
    const diagnostics = await host.evaluate(() => window.__BURNHOP_ONLINE__!.snapshot().performance);
    expect(diagnostics.arrivalSamples).toBeGreaterThan(0);
    expect(diagnostics.measuredFrames).toBeGreaterThan(0);
    expect(diagnostics.reconciliations).toBeGreaterThan(0);
    await testInfo.attach('local-performance', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
    await host.screenshot({ path: testInfo.outputPath('online-play.png') });
    const beforeClose = await host.evaluate(() => window.__BURNHOP_ONLINE__!.snapshot().local!.id);
    const closeDialog = host.waitForEvent('dialog');
    await host.close({ runBeforeUnload: true });
    const dialog = await closeDialog;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    expect(host.isClosed()).toBe(false);
    await expect(host.getByRole('heading', { name: 'MATCH CONTINUES', exact: true })).toBeVisible();
    expect(await host.evaluate(() => window.__BURNHOP_ONLINE__!.snapshot().local!.id)).toBe(beforeClose);
    await expect(host.locator('.online-standings tbody tr')).toHaveCount(2);
    await host.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(host.getByRole('heading', { name: 'MATCH CONTINUES', exact: true })).toBeVisible();
    await expect(host.getByRole('button', { name: 'Enter match', exact: true })).toBeEnabled();

    await host.getByRole('button', { name: /Settings & controls/i }).click();
    await host.getByRole('tab', { name: 'Graphics' }).click();
    await host.getByRole('group', { name: 'Graphics preset' }).getByRole('button', { name: /^Low/ }).click();
    await expect.poll(() => host.evaluate(() => window.__BURNHOP_ONLINE__!.snapshot().rendering.graphics.renderScale)).toBe(.5);
    await host.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { throw new Error('Clipboard unavailable'); } } }));
    await host.getByRole('button', { name: 'Copy performance report' }).click();
    const report = JSON.parse(await host.getByRole('textbox', { name: 'Performance report' }).inputValue());
    expect(report.session.mode).toBe('multiplayer');
    expect(report.session.frame.measuredFrames).toBeGreaterThan(0);
    expect(report.session.rendering.graphics.renderScale).toBe(.5);
    expect(JSON.stringify(report)).not.toContain(code);
    expect(JSON.stringify(report)).not.toContain('Canada Pilot');
    await host.getByRole('button', { name: /Back to pause/ }).click();
    await host.getByRole('button', { name: 'Enter match', exact: true }).click();
    await host.keyboard.down('KeyA'); await host.waitForTimeout(500); await host.keyboard.up('KeyA');
    expect(await host.evaluate(() => window.__BURNHOP_ONLINE__!.snapshot().performance.measuredFrames)).toBeGreaterThan(diagnostics.measuredFrames);
    await host.keyboard.press('Escape');
    expect((await fixtureState(host)).fullscreen).toBe(true);
    expect((await fixtureState(host)).keyboardKeys).toEqual(['Escape']);

    const tokenBefore = await guest.evaluate(() => JSON.parse(sessionStorage.getItem('burnhop-online-session-v1')!).token);
    guest.once('dialog', dialog => dialog.accept());
    await guest.reload();
    await enterFullscreen(guest);
    await expect(guest.getByRole('heading', { name: 'MATCH CONTINUES', exact: true })).toBeVisible({ timeout: 15000 });
    const tokenAfter = await guest.evaluate(() => JSON.parse(sessionStorage.getItem('burnhop-online-session-v1')!).token);
    expect(tokenAfter).not.toBe(tokenBefore);
    await expect(guest.locator('.online-standings tbody tr')).toHaveCount(2);
    await host.getByRole('button', { name: 'Leave match', exact: true }).click();
    await expect(host.getByTestId('menu-screen')).toBeVisible();
    expect(await host.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
    await expect(guest.locator('.online-standings tbody tr')).toHaveCount(1);
    expect(failures).toEqual([]);
  } finally {
    await Promise.all([host, guest].map(page => exitRoom(page).catch(() => undefined)));
    await Promise.all(contexts.map(context => context.close()));
  }
});
