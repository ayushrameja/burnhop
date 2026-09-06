const CAPTURE_TIMEOUT_MS = 8000;
type CaptureKeyboard = { lock: (keys: string[]) => Promise<void>; unlock: () => void };
export type KeyboardCaptureStatus = 'idle' | 'pending' | 'active' | 'blocked' | 'unavailable';

/** Owns only this game's fullscreen element and mouse lock, never another page surface. */
export class GameCapture {
  private wantedPointer = false;
  private wantedFullscreen = false;
  private active = false;
  private hadFullscreen = false;
  private lossNotified = false;
  private disposed = false;
  private generation = 0;
  private pending: Promise<PromiseSettledResult<void>[]> | null = null;
  private pendingKeepsFullscreen = false;
  private exitingFullscreen: Promise<void> | null = null;
  private keyboardPending: Promise<void> | null = null;
  private keyboardOwned = false;
  private keyboardAttempted: string | null = null;
  private keyboardKey: string | null = null;
  private keyboardEpoch = 0;
  private keyboardRetryWanted = false;
  private keyboardStatus: KeyboardCaptureStatus = 'idle';
  private readonly document: Document;
  private readonly keyboard?: CaptureKeyboard;

  constructor(
    private canvas: HTMLCanvasElement,
    private screen: HTMLElement,
    private onLost: (reason: 'pointerlock' | 'fullscreen') => void,
    private onKeyboardStatus: (status: KeyboardCaptureStatus) => void = () => {},
  ) {
    this.document = canvas.ownerDocument;
    this.keyboard = (this.document.defaultView?.navigator as (Navigator & { keyboard?: CaptureKeyboard }) | undefined)?.keyboard;
    this.document.addEventListener('pointerlockchange', this.changed);
    this.document.addEventListener('fullscreenchange', this.changed);
    this.document.addEventListener('keydown', this.keyDown);
  }

  /** Enter the fullscreen main menu with a freely usable cursor. Call from a click. */
  enterMenu(): Promise<void> {
    return this.acquire(false);
  }

  /** Call directly from a click: both native requests happen before the first await. */
  enter(): Promise<void> {
    return this.acquire(true);
  }

  isFullscreen(): boolean {
    return this.document.fullscreenElement === this.screen;
  }

  private async acquire(pointer: boolean): Promise<void> {
    if (this.disposed) throw new Error('The practice session has closed.');
    if (this.pending || this.exitingFullscreen) throw new Error('Fullscreen is still changing. Try again in a moment.');
    if ((pointer && typeof this.canvas.requestPointerLock !== 'function') ||
        typeof this.screen.requestFullscreen !== 'function' || this.document.fullscreenEnabled === false) {
      throw new Error('This browser or embedded view does not support the required fullscreen controls. Open the game in a desktop browser.');
    }
    if ((this.document.pointerLockElement && this.document.pointerLockElement !== this.canvas) ||
        (this.document.fullscreenElement && this.document.fullscreenElement !== this.screen)) {
      throw new Error('Another surface is using fullscreen or mouse capture. Exit it, then retry.');
    }
    if (pointer && this.isActive()) return;
    const keepFullscreen = this.isFullscreen();
    this.wantedPointer = pointer;
    this.wantedFullscreen = true;
    this.active = false;
    this.hadFullscreen = keepFullscreen;
    this.lossNotified = false;
    const generation = ++this.generation;
    // Request during the click, before fullscreen consumes transient activation.
    // Resume is also a fresh retry if an earlier request failed or was revoked.
    this.lockKeyboard(true);
    // Entering the menu also releases a previous gameplay cursor without leaving fullscreen.
    if (!pointer) void this.releaseUnwanted();
    // Fullscreen consumes transient activation. Pointer lock MUST be requested first,
    // with no await between requests: https://w3c.github.io/pointerlock/#requestPointerLock
    const lock = pointer ? this.request('pointerlock', () => this.canvas.requestPointerLock()) : Promise.resolve();
    const fullscreen = this.request('fullscreen', () => this.screen.requestFullscreen());
    const pending = Promise.allSettled([lock, fullscreen]);
    this.pending = pending;
    this.pendingKeepsFullscreen = keepFullscreen;
    const results = await pending;
    if (this.pending === pending) this.pending = null;
    if (this.disposed || (pointer && !this.wantedPointer) || !this.wantedFullscreen || generation !== this.generation) {
      await this.releaseUnwanted();
      throw new Error('Fullscreen entry was cancelled. Enter the game to continue.');
    }
    if (results.some(result => result.status === 'rejected') || !this.isFullscreen() || (pointer && !this.hasBoth())) {
      this.wantedPointer = false;
      // A denied gameplay pointer request returns to the existing fullscreen menu.
      this.wantedFullscreen = keepFullscreen && this.isFullscreen();
      await this.releaseUnwanted();
      throw new Error(pointer
        ? 'Fullscreen mouse capture was blocked or interrupted. Allow mouse capture in your browser, then retry.'
        : 'Fullscreen was blocked or interrupted. Allow fullscreen in your browser, then enter the game again.');
    }
    this.active = pointer;
    this.hadFullscreen = true;
    this.lockKeyboard();
  }

  isActive(): boolean {
    return this.active && this.hasBoth();
  }

  /** Release the cursor for menus while retaining the game's existing fullscreen. */
  async pause(): Promise<void> {
    this.wantedPointer = false;
    this.wantedFullscreen = this.document.fullscreenElement === this.screen;
    this.active = false;
    this.generation++;
    const pending = this.pending;
    await this.releaseUnwanted();
    if (pending) {
      await pending;
      await this.releaseUnwanted();
    }
  }

  async release(): Promise<void> {
    this.wantedPointer = false;
    this.wantedFullscreen = false;
    this.active = false;
    this.generation++;
    const pending = this.pending;
    await this.releaseUnwanted();
    if (pending) {
      await pending;
      await this.releaseUnwanted();
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Keep loss listeners until in-flight native requests settle so late grants are released.
    void this.release().finally(() => {
      this.document.removeEventListener('pointerlockchange', this.changed);
      this.document.removeEventListener('fullscreenchange', this.changed);
      this.document.removeEventListener('keydown', this.keyDown);
    });
  }

  private hasBoth(): boolean {
    return this.document.pointerLockElement === this.canvas && this.document.fullscreenElement === this.screen;
  }

  private changed = (): void => {
    const fullscreen = this.document.fullscreenElement === this.screen;
    const lostFullscreen = this.hadFullscreen && !fullscreen;
    this.hadFullscreen = fullscreen;
    if (this.wantedFullscreen && (lostFullscreen || (this.active && !this.hasBoth()))) {
      this.wantedPointer = false;
      this.active = false;
      // A cursor release pauses inside fullscreen. A browser fullscreen exit ends capture.
      if (!fullscreen) this.wantedFullscreen = false;
      void this.releaseUnwanted();
      if (!this.lossNotified || lostFullscreen) {
        this.lossNotified = true;
        this.onLost(lostFullscreen ? 'fullscreen' : 'pointerlock');
      }
    } else {
      void this.releaseUnwanted();
      if (this.wantedFullscreen && fullscreen) this.lockKeyboard();
    }
  };

  private keyDown = (event: KeyboardEvent): void => {
    // Browsers can consume Escape while locked; the change events handle that path.
    if (event.key === 'Escape' && this.pending && this.wantedFullscreen) {
      // Cancelling practice entry must preserve the fullscreen menu it started from.
      // Initial admission still cancels fullscreen, including a grant arriving later.
      const keepFullscreen = this.pendingKeepsFullscreen && this.isFullscreen();
      if (keepFullscreen) void this.pause();
      else void this.release();
      if (!this.lossNotified) {
        this.lossNotified = true;
        this.onLost(keepFullscreen ? 'pointerlock' : 'fullscreen');
      }
    }
  };

  private request(kind: 'pointerlock' | 'fullscreen', invoke: () => Promise<void> | void): Promise<void> {
    return new Promise((resolve, reject) => {
      const matches = () => kind === 'pointerlock'
        ? this.document.pointerLockElement === this.canvas
        : this.document.fullscreenElement === this.screen;
      if (matches()) { resolve(); return; }
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.document.removeEventListener(`${kind}change`, changed);
        this.document.removeEventListener(`${kind}error`, failed);
        if (error) reject(error); else resolve();
      };
      const wanted = () => kind === 'pointerlock' ? this.wantedPointer : this.wantedFullscreen;
      const changed = () => { if (matches() || !wanted()) finish(); };
      const failed = () => finish(new Error(`${kind} request failed`));
      const timer = setTimeout(() => finish(new Error(`${kind} request timed out`)), CAPTURE_TIMEOUT_MS);
      this.document.addEventListener(`${kind}change`, changed);
      this.document.addEventListener(`${kind}error`, failed);
      try {
        // Older Pointer Lock implementations return void and report success through events.
        const result = invoke();
        if (result && typeof result.then === 'function') {
          void result.then(() => {
            if (!wanted() || this.disposed) void this.releaseUnwanted();
            finish();
          }, failed);
        }
      } catch { failed(); }
    });
  }

  getKeyboardStatus(): KeyboardCaptureStatus { return this.keyboardStatus; }

  /** Optional capture can be retried from the visible notice without restarting the game. */
  retryKeyboard(): void { if (this.isFullscreen()) this.lockKeyboard(true); }

  private setKeyboardStatus(status: KeyboardCaptureStatus): void {
    if (this.keyboardStatus === status) return;
    this.keyboardStatus = status;
    if (!this.disposed) this.onKeyboardStatus(status);
  }

  private keyboardKeys(): string[] { return this.wantedPointer ? ['Escape', 'KeyW'] : ['Escape']; }

  private lockKeyboard(retry = false): void {
    if (this.disposed || !this.wantedFullscreen) return;
    if (typeof this.keyboard?.lock !== 'function') { this.setKeyboardStatus('unavailable'); return; }
    if (this.keyboardPending) { this.keyboardRetryWanted ||= retry; return; }
    const keys = this.keyboardKeys(), key = keys.join(',');
    if (!retry && ((this.keyboardOwned && this.keyboardKey === key) || this.keyboardStatus === 'blocked' || this.keyboardAttempted === key)) return;
    this.keyboardAttempted = key;
    const epoch = this.keyboardEpoch;
    this.setKeyboardStatus('pending');
    try {
      // KeyW includes Ctrl+W / Ctrl+Shift+W / Cmd+W. Only capture it during gameplay;
      // menus keep normal browser shortcuts. Escape remains captured across pause.
      const pending = this.keyboard.lock(keys).then(() => {
        if (epoch !== this.keyboardEpoch || !this.wantedFullscreen || this.disposed) {
          try { this.keyboard?.unlock(); } catch { /* A cancelled grant may already be gone. */ }
          return;
        }
        this.keyboardOwned = true;
        this.keyboardKey = key;
        this.setKeyboardStatus('active');
      }, () => {
        if (epoch === this.keyboardEpoch && this.wantedFullscreen && !this.disposed) {
          this.failKeyboard();
        }
      });
      this.keyboardPending = pending;
      void pending.finally(() => {
        if (this.keyboardPending !== pending) return;
        this.keyboardPending = null;
        const retryWanted = this.keyboardRetryWanted; this.keyboardRetryWanted = false;
        // A pause, cancellation or re-entry may have changed the required keys in flight.
        if (retryWanted || epoch !== this.keyboardEpoch || (this.keyboardOwned && key !== this.keyboardKeys().join(','))) this.lockKeyboard(retryWanted);
      });
    } catch {
      this.failKeyboard();
    }
  }

  private failKeyboard(): void {
    // Some implementations may retain the previous key set when an update fails.
    // In particular, a failed pause update must not leave KeyW captured in menus.
    try { this.keyboard?.unlock(); } catch { /* The rejected request may already be unlocked. */ }
    this.keyboardOwned = false; this.keyboardKey = null;
    this.setKeyboardStatus('blocked');
  }

  private unlockKeyboard(): void {
    this.keyboardEpoch++; this.keyboardAttempted = this.keyboardKey = null; this.keyboardRetryWanted = false;
    if (this.keyboardStatus !== 'blocked' && this.keyboardStatus !== 'unavailable') this.setKeyboardStatus('idle');
    if (!this.keyboardOwned && !this.keyboardPending) return;
    this.keyboardOwned = false;
    try { this.keyboard?.unlock(); } catch { /* The browser may already have unlocked it. */ }
  }

  private async releaseUnwanted(): Promise<void> {
    if (!this.wantedPointer && this.document.pointerLockElement === this.canvas) {
      try { this.document.exitPointerLock(); } catch { /* It may already have been released by the browser. */ }
    }
    // A keyboard request can precede fullscreen entry. Do not cancel it on an
    // intermediate pointer-lock event while fullscreen is still being acquired.
    if (!this.wantedFullscreen) this.unlockKeyboard();
    if (this.wantedFullscreen) { if (this.keyboardOwned) this.lockKeyboard(); return; }
    if (this.exitingFullscreen) return this.exitingFullscreen;
    if (this.document.fullscreenElement === this.screen) {
      try {
        this.exitingFullscreen = this.document.exitFullscreen().catch(() => undefined);
        await this.exitingFullscreen;
      } catch { /* Fullscreen may already have ended. */ }
      finally { this.exitingFullscreen = null; }
    }
  }
}
