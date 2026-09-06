import type { KeyboardCaptureStatus } from './game/capture';
import './keyboard-capture-notice.css';

export default function KeyboardCaptureNotice({ status, onRetry }: { status: KeyboardCaptureStatus; onRetry?: () => void }) {
  if (status !== 'blocked' && status !== 'unavailable' && status !== 'pending') return null;
  return <aside className="keyboard-capture-notice" aria-label="Keyboard controls" role="status">
    <p>{status === 'pending' ? 'Preparing keyboard controls…' : 'Your browser is handling Esc and browser shortcuts. Use the on-screen pause button while playing.'}</p>
    {status === 'blocked' && onRetry && <><p>Retry keyboard capture. If your browser asks for permission, allow it to keep Esc inside the game.</p>
      <button className="text-button" onClick={onRetry}>Retry keyboard controls</button></>}
    {status === 'unavailable' && <p>Keyboard capture is unavailable in this browser. An active game will ask before closing or reloading the tab when the browser supports it.</p>}
  </aside>;
}
