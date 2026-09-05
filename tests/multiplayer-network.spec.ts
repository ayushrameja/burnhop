import { test, expect, type Page, type BrowserContext, type WebSocketRoute } from '@playwright/test';
import { installCapture, enterFullscreen } from './helpers/capture';

/** Delays real application frames without reordering: TCP loss is tested separately with netem. */
async function installDelay(context: BrowserContext) {
  let stallUntil = 0, blocked = false, packets = 0, connections = 0;
  const sockets = new Set<{ client: WebSocketRoute; server: WebSocketRoute; close: () => void }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  await context.routeWebSocket(url => url.port === '2567', client => {
    if (blocked) { void client.close({ code: 1001, reason: 'Network unavailable' }); return; }
    const server = client.connectToServer(); connections++;
    let closed = false;
    const due = { upload: 0, download: 0 };
    const socketTimers = new Set<ReturnType<typeof setTimeout>>();
    const close = () => {
      closed = true;
      for (const timer of socketTimers) { clearTimeout(timer); timers.delete(timer); }
      socketTimers.clear(); sockets.delete(pair);
    };
    const pair = { client, server, close }; sockets.add(pair);
    const forward = (direction: 'upload' | 'download', target: WebSocketRoute, message: string | Buffer) => {
      if (closed) return;
      const jitter = [-12, -6, 0, 6, 12][packets++ % 5];
      // A blocked frame also holds subsequent frames, as an ordered WebSocket stream does.
      const delivery = Math.max(Date.now() + 75 + jitter, stallUntil, due[direction] + 0.01);
      due[direction] = delivery;
      const timer = setTimeout(() => {
        timers.delete(timer); socketTimers.delete(timer);
        if (!closed) target.send(message);
      }, Math.max(0, delivery - Date.now()));
      timers.add(timer); socketTimers.add(timer);
    };
    client.onMessage(message => forward('upload', server, message));
    server.onMessage(message => forward('download', client, message));
    client.onClose((code, reason) => { if (!closed) { close(); void server.close({ code, reason }); } });
    server.onClose((code, reason) => { if (!closed) { close(); void client.close({ code, reason }); } });
  });
  // Colyseus probes Node-style constructor options then falls back after the native
  // browser rejects them. Playwright's routed socket needs that native validation.
  await context.addInitScript(() => {
    const RoutedWebSocket = window.WebSocket;
    window.WebSocket = class extends RoutedWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols !== undefined && typeof protocols !== 'string' && !Array.isArray(protocols)) {
          throw new DOMException('Invalid WebSocket subprotocol.', 'SyntaxError');
        }
        super(url, protocols);
      }
    };
  });
  return {
    stall: (ms: number) => { stallUntil = Date.now() + ms; },
    disconnect: async () => {
      blocked = true;
      await context.setOffline(true);
      for (const pair of [...sockets]) {
        pair.close();
        await Promise.all([pair.client.close({ code: 1001, reason: 'Temporary network loss' }), pair.server.close({ code: 1001, reason: 'Temporary network loss' })]);
      }
    },
    restore: async () => { blocked = false; await context.setOffline(false); },
    count: () => connections,
    dispose: () => { for (const pair of [...sockets]) pair.close(); for (const timer of timers) clearTimeout(timer); },
  };
}
async function open(page: Page, nickname: string, code = '') {
  await installCapture(page);
  await page.goto(`/?online=1${code ? `&room=${code}` : ''}`);
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await enterFullscreen(page);
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill(nickname);
}
const snapshot = (page: Page) => page.evaluate(() => window.__BURNHOP_ONLINE__!.snapshot());

test('prediction survives 150 ms RTT, ordered jitter, a one-second stall and automatic reconnect', async ({ browser, baseURL }, testInfo) => {
  const hostContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const guestContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const relay = await installDelay(hostContext);
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await open(host, 'Latency Pilot');
    await host.getByRole('button', { name: 'Create private room', exact: true }).click();
    await expect(host.getByRole('textbox', { name: 'Invite link', exact: true })).toBeVisible();
    const invite = await host.getByRole('textbox', { name: 'Invite link', exact: true }).inputValue();
    const code = new URL(invite).searchParams.get('room')!;
    await open(guest, 'Observer Pilot', code);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Mark ready', exact: true })).toBeEnabled();
    await host.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await guest.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Start match', exact: true })).toBeEnabled();
    await host.getByRole('button', { name: 'Start match', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Enter match', exact: true })).toBeVisible({ timeout: 10000 });
    await host.getByRole('button', { name: 'Enter match', exact: true }).click();
    await expect.poll(async () => (await snapshot(host)).paused).toBe(false);
    const initial = await snapshot(host);
    await host.keyboard.down('KeyD');
    await expect.poll(async () => {
      const current = await snapshot(host);
      return current.local!.x - current.authority!.x;
    }).toBeGreaterThan(4);
    await host.keyboard.up('KeyD');
    await expect.poll(async () => (await snapshot(host)).authority!.x).toBeGreaterThan(initial.authority!.x + 3);

    await host.keyboard.press('Space');
    await host.waitForTimeout(140);
    await host.keyboard.down('Space');
    await expect.poll(async () => (await snapshot(host)).local!.fuel).toBeLessThan(initial.local!.fuel - 2);
    await host.keyboard.up('Space');
    await host.mouse.move(800, 450);
    await host.mouse.down();
    await expect.poll(async () => (await snapshot(host)).local!.weapon.ammo).toBeLessThan(30);
    await host.mouse.up();
    await expect.poll(async () => (await snapshot(host)).authority!.weapon.ammo).toBeLessThan(30);

    relay.stall(1000);
    await host.keyboard.down('KeyD');
    await host.waitForTimeout(1200);
    await host.keyboard.up('KeyD');
    await expect.poll(async () => {
      const current = await snapshot(host);
      return Math.abs(current.local!.x - current.authority!.x);
    }, { timeout: 10000 }).toBeLessThan(4);
    await expect.poll(async () => (await snapshot(host)).pending, { timeout: 10000 }).toBeLessThan(30);
    const settled = await snapshot(host);
    expect(Number.isFinite(settled.local!.x)).toBe(true);
    expect(settled.local!.weapon.ammo).toBe(settled.authority!.weapon.ammo);
    expect(Math.abs(settled.local!.fuel - settled.authority!.fuel)).toBeLessThan(5);
    await host.screenshot({ path: testInfo.outputPath('latency-stall-recovered.png') });

    const sessionBefore = settled.authority!.id;
    await relay.disconnect();
    await expect(host.getByRole('heading', { name: 'RECONNECTING', exact: true })).toBeVisible();
    await host.waitForTimeout(900);
    await relay.restore();
    await expect.poll(async () => (await snapshot(host)).status, { timeout: 20000 }).toBe('connected');
    await expect(host.getByRole('heading', { name: 'MATCH CONTINUES', exact: true })).toBeVisible();
    expect((await snapshot(host)).paused).toBe(true);
    expect((await snapshot(host)).aim.locked).toBe(false);
    expect((await snapshot(host)).authority!.id).toBe(sessionBefore);
    expect(relay.count()).toBeGreaterThan(1);
    await host.getByRole('button', { name: 'Enter match', exact: true }).click();
    await expect.poll(async () => (await snapshot(host)).paused).toBe(false);
    const xBefore = (await snapshot(host)).authority!.x;
    await host.keyboard.down('KeyA');
    await expect.poll(async () => (await snapshot(host)).authority!.x).toBeLessThan(xBefore - 3);
    await host.keyboard.up('KeyA');
    expect(errors).toEqual([]);
  } catch (error) {
    await testInfo.attach('network-failure-ui', { body: `HOST\n${await host.locator('body').innerText()}\nGUEST\n${await guest.locator('body').innerText()}`, contentType: 'text/plain' });
    await host.screenshot({ path: testInfo.outputPath('network-failure.png') });
    throw error;
  } finally {
    await relay.restore();
    for (const page of [host, guest]) {
      if (page.isClosed()) continue;
      await page.keyboard.press('Escape').catch(() => undefined);
      const leave = page.getByRole('button', { name: /^(Leave match|← Leave room)$/ });
      if (await leave.isVisible()) await leave.click().catch(() => undefined);
    }
    await Promise.all([hostContext.close(), guestContext.close()]);
    relay.dispose();
  }
});
