/** Browser-owned close/reload confirmation, installed only while a runtime exists. */
export function protectGameSession(target: Window, inProgress: () => boolean, pause: () => void): () => void {
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!inProgress()) return;
    event.preventDefault();
    // Compatibility with browsers that still require returnValue; dialog wording
    // belongs to the browser. Never send a leave message until the player confirms.
    event.returnValue = true;
    pause();
  };
  target.addEventListener('beforeunload', beforeUnload);
  return () => target.removeEventListener('beforeunload', beforeUnload);
}

/** preventDefault helps only when the browser delivers the shortcut to the page. */
export function isTabCloseShortcut(event: KeyboardEvent): boolean {
  return event.code === 'KeyW' && (event.ctrlKey || event.metaKey);
}
