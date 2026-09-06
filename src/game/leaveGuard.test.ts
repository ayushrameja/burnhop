import { expect, it, vi } from 'vitest';
import { isTabCloseShortcut, protectGameSession } from './leaveGuard';

it('protects active and paused sessions, pauses before the dialog, and releases protection after leaving', () => {
  const target = new EventTarget(), pause = vi.fn();
  let inProgress = false;
  const remove = protectGameSession(target as Window, () => inProgress, pause);
  const attempt = () => {
    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', { value: '', writable: true });
    target.dispatchEvent(event); return event;
  };
  expect(attempt().defaultPrevented).toBe(false);
  inProgress = true;
  expect(attempt().defaultPrevented).toBe(true);
  expect(attempt().returnValue).toBe(true);
  expect(pause).toHaveBeenCalledTimes(2);
  inProgress = false;
  expect(attempt().defaultPrevented).toBe(false);
  inProgress = true; remove();
  expect(attempt().defaultPrevented).toBe(false);
  expect(pause).toHaveBeenCalledTimes(2);
});

it('recognizes both platform close shortcuts and leaves plain W and unrelated shortcuts alone', () => {
  for (const modifiers of [{ ctrlKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true }]) {
    expect(isTabCloseShortcut({ code: 'KeyW', ...modifiers } as unknown as KeyboardEvent)).toBe(true);
  }
  expect(isTabCloseShortcut({ code: 'KeyW', ctrlKey: false, metaKey: false } as KeyboardEvent)).toBe(false);
  expect(isTabCloseShortcut({ code: 'KeyR', ctrlKey: true } as KeyboardEvent)).toBe(false);
});
