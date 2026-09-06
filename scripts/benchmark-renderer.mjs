import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';

// Isolated renderer comparison: same actors, poses and camera route for every run.
// CPU submission timings and headless frame intervals are not native GPU measurements.
const output = process.argv[2] || 'load-results/renderer-current.json';
const baseURL = process.env.BURNHOP_BENCH_URL || 'http://127.0.0.1:5173';
const variant = process.env.BURNHOP_BENCH_VARIANT || 'high';
const browser = await chromium.launch();
const results = [];
try {
  for (const density of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: density });
    await page.goto(`${baseURL}/public/assets/outpost.json`.replace('/public/', '/'));
    await page.evaluate(() => { document.body.innerHTML = '<canvas style="position:fixed;inset:0;width:100%;height:100%"></canvas>'; });
    const sample = await page.evaluate(async (variant) => {
      const [{ Renderer }, { createWorld }, { DEFAULT_APPEARANCE }, arena] = await Promise.all([
        import('/src/game/renderer.ts'), import('/src/game/simulation.ts'), import('/src/game/appearance.ts'),
        fetch('/assets/outpost.json').then(r => r.json()),
      ]);
      const canvas = document.querySelector('canvas');
      const renderer = new Renderer(canvas, { arena, images: {} });
      renderer.setGraphics?.(variant === 'balanced' ? { renderScale: .75, frameRate: 60, scenery: 'medium', effects: 'medium' }
        : variant === 'low' ? { renderScale: .5, frameRate: 60, scenery: 'low', effects: 'low' }
        : { renderScale: 1, frameRate: 0, scenery: 'high', effects: 'high' });
      const actors = Array.from({ length: 8 }, (_, i) => {
        const player = createWorld(arena).player;
        Object.assign(player, { id: String(i), x: player.x + i * 120, nickname: `Pilot ${i + 1}`, health: 100,
          lifeId: 1, connected: true, appearance: DEFAULT_APPEARANCE });
        if (i >= 4) player.x += 2500;
        return { player, appearance: DEFAULT_APPEARANCE, nickname: player.nickname, connected: true, protected: false, lifeId: 1 };
      });
      const submission = [], intervals = [], transitions = [];
      let last = 0;
      for (let frame = 0; frame < 150; frame++) {
        const now = await new Promise(requestAnimationFrame);
        if (frame > 20) intervals.push(now - last);
        last = now;
        for (const actor of actors) { actor.player.aimAngle = Math.sin(frame / 40) * .6; actor.player.vx = 100; }
        if (frame === 65) renderer.setZoom(5);
        if (frame === 100) renderer.setZoom(1);
        const start = performance.now();
        renderer.renderOnline(actors, '0', frame, [], 1 / 60);
        const work = performance.now() - start;
        if (frame === 0 || frame === 65 || frame === 100) transitions.push({ frame, workMs: work });
        else if (frame > 20) submission.push(work);
      }
      const stats = values => {
        values.sort((a, b) => a - b);
        return { median: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)],
          max: values.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length };
      };
      const result = { canvas: { width: canvas.width, height: canvas.height }, submissionMs: stats(submission),
        intervalMs: stats(intervals), transitions, diagnostics: renderer.getPerformanceDiagnostics?.() };
      window.benchmarkRenderer = renderer;
      return result;
    }, variant);
    await mkdir(dirname(output), { recursive: true });
    await page.screenshot({ path: `${dirname(output)}/${basename(output, extname(output))}-dpr${density}.png` });
    results.push({ density, ...sample });
    await page.close();
  }
  const report = { variant, note: 'Headless Chromium on the current host; eight actors, fixed camera route. Renderer is called every animation frame to compare cost independently of the runtime frame cap. CPU submission excludes asynchronous raster/GPU completion. Not a Windows FPS guarantee.', results };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
