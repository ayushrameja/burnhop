import { useEffect, useRef, useState, type RefObject } from 'react';

const HOLD_DURATION_MS = 2000;
const FEEDBACK_DELAY_MS = 150;

/** A continuous physical Escape hold. Tap behavior stays with each game's screen. */
export default function FullscreenEscapeHold({ target, enabled, onExit }: {
  target: RefObject<HTMLElement | null>;
  enabled: boolean;
  onExit: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    if (!enabled) return;
    let started: number | null = null;
    let interval: number | undefined;
    let timeout: number | undefined;
    const ownsFullscreen = () => target.current !== null && document.fullscreenElement === target.current;
    const cancel = () => {
      started = null;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      interval = timeout = undefined;
      setProgress(null);
    };
    const finish = () => {
      const canExit = started !== null && ownsFullscreen() && !document.hidden;
      cancel();
      if (canExit) exitRef.current();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey) {
        cancel();
        return;
      }
      if (event.repeat || started !== null || !ownsFullscreen() || document.hidden) return;
      started = performance.now();
      interval = window.setInterval(() => {
        if (started === null) return;
        const elapsed = performance.now() - started;
        if (elapsed >= FEEDBACK_DELAY_MS) setProgress(Math.min(1, elapsed / HOLD_DURATION_MS));
      }, 40);
      timeout = window.setTimeout(finish, HOLD_DURATION_MS);
      // Do not consume the event: gameplay pauses immediately, and dialogs can still dismiss.
    };
    const keyUp = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    const fullscreenChanged = () => { if (!ownsFullscreen()) cancel(); };
    const visibilityChanged = () => { if (document.hidden) cancel(); };

    // Capture phase records the first press before gameplay pauses or settings handle Escape.
    // The component stays mounted across those transitions, so the hold never restarts.
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibilityChanged);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    return () => {
      cancel();
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibilityChanged);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
    };
  }, [enabled, target]);

  if (!enabled || progress === null) return null;
  return <div className="escape-hold-progress" data-testid="escape-hold-progress" role="progressbar"
    aria-label="Hold Escape to exit fullscreen" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
    <kbd aria-hidden="true">ESC</kbd>
    <span>Hold to exit fullscreen<small>Release to cancel</small></span>
    <div className="escape-hold-track" aria-hidden="true"><div style={{ transform: `scaleX(${progress})` }} /></div>
  </div>;
}
