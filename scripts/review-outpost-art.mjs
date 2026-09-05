import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Render the same scenery module at overview and gameplay scale for visual review.
// Requires the Vite development server, without altering the live game session.
const browser = await chromium.launch();
const directory = 'docs/screenshots/outpost';
await mkdir(directory, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 840 } });
  await page.goto('http://127.0.0.1:5173/');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const view of [
    { name: 'overview', scale: .335, x: -180, y: -60 },
    { name: 'west-bunker', scale: 1, x: 0, y: 260 },
    { name: 'east-bunker', scale: 1, x: 2910, y: 650 },
    { name: 'lower-tunnel', scale: 1, x: 530, y: 1040 },
  ]) {
    await page.evaluate(async view => {
      const { OutpostScenery } = await import('/src/game/outpostRenderer.ts');
      const arena = await (await fetch('/assets/outpost.json')).json();
      const canvas = document.createElement('canvas'); canvas.width = 1680; canvas.height = 840;
      canvas.style.cssText = 'position:fixed;inset:0;z-index:999999;width:1680px;height:840px';
      document.querySelector('[data-art-review]')?.remove(); canvas.dataset.artReview = 'true'; document.body.append(canvas);
      const ctx = canvas.getContext('2d');
      const scenery = new OutpostScenery(arena);
      ctx.save(); ctx.scale(1680 / 1280, 840 / 720); scenery.background(ctx, { x: view.x, y: view.y }); ctx.restore();
      ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
      scenery.draw(ctx, { x: view.x, y: view.y }, { x: 1680 / view.scale, y: 840 / view.scale }); ctx.restore();
      if (view.name === 'overview') {
        ctx.fillStyle = '#334638'; ctx.font = '600 15px monospace'; ctx.fillText('BURNHOP  /  ARENA 02', 64, 60);
        ctx.font = '700 48px sans-serif'; ctx.fillText('OUTPOST', 60, 118);
        ctx.font = '14px monospace'; ctx.fillText('WEST BUNKER', 196, 738); ctx.fillText('LOWER TUNNEL', 533, 738);
        ctx.fillText('CENTRAL RISE', 868, 738); ctx.fillText('EAST BUNKER', 1418, 738);
        ctx.fillStyle = '#536849'; ctx.font = '13px monospace'; ctx.fillText('Classic terrain · Original vector artwork · 8 spawn positions', 64, 792);
      }
    }, view);
    await page.screenshot({ path: `${directory}/${view.name}.png` });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Outpost art review: overview, both bunkers, and lower tunnel captured; no browser errors.');
} finally { await browser.close(); }
