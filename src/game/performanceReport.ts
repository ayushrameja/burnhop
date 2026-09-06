declare const __BUILD_ID__: string;
let source: (() => unknown) | undefined;
let lastSession: unknown = null;

export function registerPerformanceReport(read: () => unknown): () => void {
  source = read;
  return () => { if (source === read) { lastSession = read(); source = undefined; } };
}
/** Local report only: no room codes, tokens, player names, positions or automatic uploads. */
export function performanceReport(): string {
  return JSON.stringify({ game: 'Burnhop', build: __BUILD_ID__, capturedAt: new Date().toISOString(),
    browser: navigator.userAgent, devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
    session: source ? source() : lastSession,
    notes: 'Local measurements. Submission time excludes asynchronous raster/GPU completion. GPU and refresh rate must be recorded separately.',
  }, null, 2);
}
