import { expect, type Page } from '@playwright/test';

export interface CaptureFixtureState {
  calls: string[];
  keyboard: boolean;
  keyboardKeys: string[];
  fullscreen: boolean;
  locked: boolean;
  sameCanvas: boolean;
}

/** Headless Chromium cannot grant native pointer lock on this host. Keep the
 * browser APIs observable, but run the real app capture and input controllers. */
export async function installCapture(page: Page) {
  await page.addInitScript(() => {
    let fullscreen: Element | null = null;
    let pointer: Element | null = null;
    let keyboard = false;
    let keyboardKeys: string[] = [];
    let firstCanvas: Element | null = null;
    const calls: string[] = [];
    Object.defineProperties(document, {
      fullscreenElement: { configurable: true, get: () => fullscreen },
      pointerLockElement: { configurable: true, get: () => pointer },
      fullscreenEnabled: { configurable: true, get: () => true },
    });
    HTMLCanvasElement.prototype.requestPointerLock = function () {
      calls.push('pointerlock');
      firstCanvas ??= this;
      return Promise.resolve().then(() => {
        pointer = this;
        document.dispatchEvent(new Event('pointerlockchange'));
      });
    };
    Element.prototype.requestFullscreen = function () {
      calls.push('fullscreen');
      return Promise.resolve().then(() => {
        fullscreen = this;
        document.dispatchEvent(new Event('fullscreenchange'));
      });
    };
    document.exitPointerLock = () => {
      calls.push('exit-pointerlock');
      pointer = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
    document.exitFullscreen = async () => {
      calls.push('exit-fullscreen');
      fullscreen = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true,
      value: {
        lock: async (keys: string[]) => { calls.push(`keyboard:${keys.join(',')}`); keyboard = true; keyboardKeys = [...keys]; },
        unlock: () => { calls.push('exit-keyboard'); keyboard = false; keyboardKeys = []; },
      },
    });
    const fetchResource = window.fetch;
    window.fetch = (...args) => {
      calls.push(`fetch:${String(args[0])}`);
      return fetchResource(...args);
    };
    (window as Window & { __CAPTURE_FIXTURE__?: () => unknown }).__CAPTURE_FIXTURE__ = () => ({
      calls: [...calls], keyboard, keyboardKeys: [...keyboardKeys],
      fullscreen: fullscreen === document.querySelector('.game-shell'),
      locked: pointer === document.querySelector('[data-testid="game-canvas"]'),
      sameCanvas: firstCanvas === document.querySelector('[data-testid="game-canvas"]'),
    });
  });
}

export async function fixtureState(page: Page): Promise<CaptureFixtureState> {
  return page.evaluate(() => (window as Window & { __CAPTURE_FIXTURE__?: () => CaptureFixtureState }).__CAPTURE_FIXTURE__!());
}

/** Complete the welcome gesture on an already loaded page. */
export async function enterFullscreen(page: Page) {
  const gate = page.getByTestId('fullscreen-gate');
  if (await gate.isVisible()) await gate.getByRole('button', { name: /^(Enter game|Return to fullscreen)$/ }).click();
  await expect(gate).not.toBeVisible();
}

export async function enterMenu(page: Page) {
  await enterFullscreen(page);
  await expect(page.getByTestId('menu-screen')).toBeVisible();
}

export async function openMenu(page: Page, url = '/') {
  await page.goto(url);
  await enterMenu(page);
}

/** Start a session from the menu; menu entry itself never loads a range. */
export async function enterPractice(page: Page) {
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
}

/** Position a locked aim cursor using real relative-input handling. The native
 * pointer is moved onto the canvas for following button events; then one relative
 * delta corrects for the fixture's lack of OS pointer confinement. */
export async function moveAim(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.evaluate(({ x, y }) => {
    const point = window.__BURNHOP__!.aim().pointer;
    const event = new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: y });
    // Constructor movement fields truncate fractional CSS pixels to integers.
    Object.defineProperties(event, { movementX: { value: x - point.x }, movementY: { value: y - point.y } });
    document.querySelector('[data-testid="game-canvas"]')!.dispatchEvent(event);
  }, { x, y });
}
