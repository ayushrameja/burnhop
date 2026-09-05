import { describe, expect, it, vi } from 'vitest';
import { GameCapture } from './capture';

class CaptureDocument extends EventTarget {
  pointerLockElement: Element | null = null;
  fullscreenElement: Element | null = null;
  fullscreenEnabled = true;
  defaultView = { navigator: { keyboard: { lock: vi.fn(async (_keys: string[]): Promise<void> => undefined), unlock: vi.fn() } } };
  exitPointerLock = vi.fn(() => {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event('pointerlockchange'));
  });
  exitFullscreen = vi.fn(async () => {
    this.fullscreenElement = null;
    this.dispatchEvent(new Event('fullscreenchange'));
  });
}

function setup() {
  const document = new CaptureDocument();
  const order: string[] = [];
  const canvas = { ownerDocument: document, requestPointerLock: () => Promise.resolve() } as unknown as HTMLCanvasElement;
  const screen = { requestFullscreen: () => Promise.resolve() } as unknown as HTMLElement;
  const grantLock = () => {
    document.pointerLockElement = canvas;
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  const grantFullscreen = () => {
    document.fullscreenElement = screen;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  canvas.requestPointerLock = vi.fn(() => {
    order.push('pointerlock');
    return Promise.resolve().then(grantLock);
  });
  screen.requestFullscreen = vi.fn(() => {
    order.push('fullscreen');
    return Promise.resolve().then(grantFullscreen);
  });
  const onLost = vi.fn();
  const capture = new GameCapture(canvas, screen, onLost);
  return { document, canvas, screen, order, grantLock, grantFullscreen, onLost, capture, keyboard: document.defaultView.navigator.keyboard };
}

describe('fullscreen mouse capture', () => {
  it('enters the main menu in fullscreen with a usable cursor, then captures only the pointer for practice', async () => {
    const { capture, order, document, canvas, screen, keyboard, onLost } = setup();
    const entering = capture.enterMenu();
    expect(order).toEqual(['fullscreen']);
    await entering;
    expect(capture.isFullscreen()).toBe(true);
    expect(capture.isActive()).toBe(false);
    expect(document.pointerLockElement).toBeNull();
    expect(keyboard.lock).toHaveBeenCalledWith(['Escape']);
    await capture.enter();
    expect(order).toEqual(['fullscreen', 'pointerlock']);
    expect(document.pointerLockElement).toBe(canvas);
    expect(document.fullscreenElement).toBe(screen);
    expect(capture.isActive()).toBe(true);
    expect(onLost).not.toHaveBeenCalled();
    capture.destroy();
  });

  it('does not require pointer lock support to enter the fullscreen menu', async () => {
    const { capture, canvas, document } = setup();
    canvas.requestPointerLock = undefined as unknown as typeof canvas.requestPointerLock;
    await capture.enterMenu();
    expect(capture.isFullscreen()).toBe(true);
    expect(document.pointerLockElement).toBeNull();
    await expect(capture.enter()).rejects.toThrow('desktop browser');
    expect(capture.isFullscreen()).toBe(true);
    capture.destroy();
  });

  it('reports menu fullscreen loss once, even when the loss callback pauses capture', async () => {
    const { capture, document, onLost, keyboard } = setup();
    onLost.mockImplementation(() => { void capture.pause(); });
    await capture.enterMenu();
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(capture.isFullscreen()).toBe(false);
    expect(onLost).toHaveBeenCalledExactlyOnceWith('fullscreen');
    expect(keyboard.unlock).toHaveBeenCalled();
    await capture.enterMenu();
    expect(capture.isFullscreen()).toBe(true);
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onLost).toHaveBeenCalledTimes(2);
    capture.destroy();
  });

  it('keeps the fullscreen menu usable when gameplay pointer capture is denied', async () => {
    const { capture, canvas, screen, document, keyboard, onLost, order } = setup();
    await capture.enterMenu();
    canvas.requestPointerLock = vi.fn(() => Promise.reject(new Error('Permission denied')));
    await expect(capture.enter()).rejects.toThrow('blocked or interrupted');
    expect(document.fullscreenElement).toBe(screen);
    expect(document.pointerLockElement).toBeNull();
    expect(capture.isActive()).toBe(false);
    expect(order).toEqual(['fullscreen']);
    expect(keyboard.unlock).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onLost).toHaveBeenCalledExactlyOnceWith('fullscreen');
    capture.destroy();
  });

  it('releases a late menu fullscreen grant after entry is cancelled', async () => {
    const { capture, screen, document, grantFullscreen, onLost } = setup();
    let fullscreenReady!: () => void;
    screen.requestFullscreen = () => new Promise<void>(resolve => {
      fullscreenReady = () => { grantFullscreen(); resolve(); };
    });
    const entering = capture.enterMenu();
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    fullscreenReady();
    await expect(entering).rejects.toThrow('cancelled');
    expect(document.fullscreenElement).toBeNull();
    expect(document.pointerLockElement).toBeNull();
    expect(onLost).toHaveBeenCalledExactlyOnceWith('fullscreen');
    capture.destroy();
  });

  it('keeps fullscreen while releasing a late gameplay pointer grant after returning to the menu', async () => {
    const { capture, canvas, screen, document, grantLock, onLost } = setup();
    await capture.enterMenu();
    let lockReady!: () => void;
    canvas.requestPointerLock = () => new Promise<void>(resolve => {
      lockReady = () => { grantLock(); resolve(); };
    });
    const entering = capture.enter();
    const pausing = capture.pause();
    lockReady();
    await expect(entering).rejects.toThrow('cancelled');
    await pausing;
    expect(document.fullscreenElement).toBe(screen);
    expect(document.pointerLockElement).toBeNull();
    expect(capture.isActive()).toBe(false);
    expect(onLost).not.toHaveBeenCalled();
    capture.destroy();
  });

  it.each(['promise', 'event-only'] as const)('pauses pending %s pointer capture on Escape while preserving menu fullscreen', async (api) => {
    const { capture, canvas, screen, document, grantLock, onLost, keyboard } = setup();
    await capture.enterMenu();
    let lockReady!: () => void;
    canvas.requestPointerLock = (() => {
      if (api === 'event-only') {
        lockReady = grantLock;
        return;
      }
      return new Promise<void>(resolve => {
        lockReady = () => { grantLock(); resolve(); };
      });
    }) as typeof canvas.requestPointerLock;
    onLost.mockImplementation(() => { void capture.pause(); });
    const entering = capture.enter();
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape', repeat: true }));
    expect(document.fullscreenElement).toBe(screen);
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(onLost).toHaveBeenCalledExactlyOnceWith('pointerlock');
    lockReady();
    await expect(entering).rejects.toThrow('cancelled');
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBe(screen);
    expect(capture.isActive()).toBe(false);
    expect(document.exitPointerLock).toHaveBeenCalledOnce();
    expect(keyboard.unlock).not.toHaveBeenCalled();
    expect(onLost).toHaveBeenCalledExactlyOnceWith('pointerlock');
    capture.destroy();
  });

  it('returns from gameplay to the fullscreen menu without reporting capture loss', async () => {
    const { capture, document, screen, onLost, order } = setup();
    await capture.enter();
    await capture.enterMenu();
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBe(screen);
    expect(capture.isActive()).toBe(false);
    expect(order).toEqual(['pointerlock', 'fullscreen']);
    expect(onLost).not.toHaveBeenCalled();
    capture.destroy();
  });

  it('requests pointer lock before fullscreen in the click turn and waits for both', async () => {
    const { capture, order, document, canvas, screen, onLost } = setup();
    const entering = capture.enter();
    expect(order).toEqual(['pointerlock', 'fullscreen']);
    await entering;
    expect(document.pointerLockElement).toBe(canvas);
    expect(document.fullscreenElement).toBe(screen);
    expect(onLost).not.toHaveBeenCalled();
    await capture.release();
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBeNull();
    expect(onLost).not.toHaveBeenCalled();
    capture.destroy();
  });

  it('pauses once inside fullscreen when pointer lock is lost', async () => {
    const { capture, document, screen, onLost, keyboard } = setup();
    await capture.enter();
    document.pointerLockElement = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    document.dispatchEvent(new Event('pointerlockchange'));
    await Promise.resolve();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(capture.isActive()).toBe(false);
    expect(document.fullscreenElement).toBe(screen);
    expect(keyboard.unlock).not.toHaveBeenCalled();
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(keyboard.unlock).toHaveBeenCalled();
    expect(onLost).toHaveBeenCalledTimes(2);
    expect(onLost).toHaveBeenLastCalledWith('fullscreen');
    capture.destroy();
  });

  it('releases pointer and keyboard capture once when fullscreen is lost', async () => {
    const { capture, document, onLost, keyboard } = setup();
    await capture.enter();
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBeNull();
    expect(keyboard.unlock).toHaveBeenCalled();
    expect(capture.isActive()).toBe(false);
    capture.destroy();
  });

  it('preserves fullscreen and Escape capture while paused and resumes with only a new pointer request', async () => {
    const { capture, document, screen, onLost, keyboard, order } = setup();
    await capture.enter();
    expect(capture.isActive()).toBe(true);
    expect(keyboard.lock).toHaveBeenCalledWith(['Escape']);
    await capture.pause();
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBe(screen);
    expect(capture.isActive()).toBe(false);
    expect(keyboard.unlock).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    await capture.enter();
    expect(capture.isActive()).toBe(true);
    expect(order).toEqual(['pointerlock', 'fullscreen', 'pointerlock']);
    expect(keyboard.lock).toHaveBeenCalledTimes(1);
    await capture.release();
    expect(document.fullscreenElement).toBeNull();
    expect(keyboard.unlock).toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    capture.destroy();
  });

  it('reports fullscreen loss after an intentional pause', async () => {
    const { capture, document, onLost } = setup();
    await capture.enter();
    await capture.pause();
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onLost).toHaveBeenCalledTimes(1);
    capture.destroy();
  });

  it('rolls back partial success when fullscreen is rejected', async () => {
    const { capture, document, screen } = setup();
    screen.requestFullscreen = vi.fn(() => Promise.reject(new Error('Permission denied')));
    await expect(capture.enter()).rejects.toThrow('blocked or interrupted');
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBeNull();
    capture.destroy();
  });

  it('supports the event-only pointer lock API', async () => {
    const { capture, canvas, document, grantLock } = setup();
    canvas.requestPointerLock = (() => { queueMicrotask(grantLock); }) as typeof canvas.requestPointerLock;
    await capture.enter();
    expect(document.pointerLockElement).toBe(canvas);
    await capture.release();
    capture.destroy();
  });

  it('rejects unavailable capture before making requests', async () => {
    const { capture, document, order } = setup();
    document.fullscreenEnabled = false;
    await expect(capture.enter()).rejects.toThrow('desktop browser');
    expect(order).toEqual([]);
    capture.destroy();
  });

  it('releases late native grants after the session is destroyed', async () => {
    const { capture, canvas, screen, document, grantLock, grantFullscreen } = setup();
    let lockReady!: () => void;
    let fullscreenReady!: () => void;
    canvas.requestPointerLock = () => new Promise<void>(resolve => { lockReady = () => { grantLock(); resolve(); }; });
    screen.requestFullscreen = () => new Promise<void>(resolve => { fullscreenReady = () => { grantFullscreen(); resolve(); }; });
    const entering = capture.enter();
    capture.destroy();
    lockReady();
    fullscreenReady();
    await expect(entering).rejects.toThrow('cancelled');
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBeNull();
  });

  it('cancels a pending entry on Escape and releases grants that arrive afterward', async () => {
    const { capture, canvas, screen, document, grantLock, grantFullscreen, onLost } = setup();
    let lockReady!: () => void;
    let fullscreenReady!: () => void;
    canvas.requestPointerLock = () => new Promise<void>(resolve => { lockReady = () => { grantLock(); resolve(); }; });
    screen.requestFullscreen = () => new Promise<void>(resolve => { fullscreenReady = () => { grantFullscreen(); resolve(); }; });
    const entering = capture.enter();
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    lockReady();
    fullscreenReady();
    await expect(entering).rejects.toThrow('cancelled');
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBeNull();
    capture.destroy();
  });

  it('exits a fullscreen grant from an initial pending entry when Escape cancels pointer capture', async () => {
    const { capture, canvas, document, grantLock, onLost } = setup();
    let lockReady!: () => void;
    canvas.requestPointerLock = () => new Promise<void>(resolve => {
      lockReady = () => { grantLock(); resolve(); };
    });
    const entering = capture.enter();
    await Promise.resolve();
    expect(capture.isFullscreen()).toBe(true);
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    lockReady();
    await expect(entering).rejects.toThrow('cancelled');
    expect(document.pointerLockElement).toBeNull();
    expect(document.fullscreenElement).toBeNull();
    expect(onLost).toHaveBeenCalledExactlyOnceWith('fullscreen');
    capture.destroy();
  });

  it('leaves active and paused Escape handling to the game', async () => {
    const { capture, document, screen, onLost } = setup();
    await capture.enter();
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(capture.isActive()).toBe(true);
    await capture.pause();
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(document.fullscreenElement).toBe(screen);
    expect(onLost).not.toHaveBeenCalled();
    capture.destroy();
  });

  it('continues fullscreen play when optional Escape capture is denied', async () => {
    const { capture, keyboard, onLost } = setup();
    keyboard.lock.mockRejectedValue(new Error('Permission denied'));
    await capture.enter();
    expect(capture.isActive()).toBe(true);
    expect(keyboard.lock).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
    capture.destroy();
  });

  it('unlocks an optional keyboard grant that arrives after release', async () => {
    const { capture, keyboard, document } = setup();
    let keyboardReady!: () => void;
    keyboard.lock.mockImplementation(() => new Promise<void>(resolve => { keyboardReady = resolve; }));
    await capture.enter();
    await capture.release();
    keyboard.unlock.mockClear();
    keyboardReady();
    await Promise.resolve();
    expect(keyboard.unlock).toHaveBeenCalled();
    expect(document.fullscreenElement).toBeNull();
    capture.destroy();
  });

  it('never releases another element’s fullscreen or pointer lock', async () => {
    const { capture, document, keyboard } = setup();
    const other = {} as Element;
    document.pointerLockElement = other;
    document.fullscreenElement = other;
    await expect(capture.enterMenu()).rejects.toThrow('Another surface');
    await expect(capture.enter()).rejects.toThrow('Another surface');
    await capture.release();
    expect(document.exitPointerLock).not.toHaveBeenCalled();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(keyboard.unlock).not.toHaveBeenCalled();
    capture.destroy();
  });
});
