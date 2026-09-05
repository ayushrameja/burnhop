import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installCapture, openMenu, enterPractice } from '../tests/helpers/capture.ts';

// Warm-cache rendering smoke, separate from tracing and per-frame collision probes.
// These observations describe headless Chromium on this machine, not native GPU capacity.
const browser = await chromium.launch();
const map = process.argv[2] === 'range' ? 'range' : 'outpost';
try {
  const results = [];
  for (const density of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: density });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await installCapture(page);
    await openMenu(page, `http://127.0.0.1:5173/?map=${map}`);
    await enterPractice(page);
    for (const zoom of [1, 3, 5]) {
      if (zoom !== 1) await page.keyboard.press('Tab');
      await page.waitForTimeout(600);
      const sample = await page.evaluate(async () => {
        const intervals = [];
        let previous = performance.now();
        await new Promise(resolve => {
          const deadline = previous + 1400;
          const frame = now => {
            intervals.push(now - previous); previous = now;
            if (now >= deadline) resolve(); else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        intervals.sort((a, b) => a - b);
        return { ...window.__BURNHOP__.metrics(), medianFrameMs: intervals[Math.floor(intervals.length * .5)], p95FrameMs: intervals[Math.floor(intervals.length * .95)] };
      });
      results.push({ density, zoom, ...sample });
      if (!sample.running || sample.frames < 5 || errors.length) throw new Error(`Rendering failed: ${JSON.stringify({ sample, errors })}`);
    }
    await page.close();
  }
  await mkdir('docs/screenshots/outpost', { recursive: true });
  await writeFile(`docs/screenshots/outpost/${map === 'range' ? 'range-comparison-performance' : 'texture-performance'}.json`, JSON.stringify({ map, note: 'Observed idle rendering in headless Chromium without Playwright trace or collision sampling. Not a native GPU or multiplayer capacity benchmark.', results }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
