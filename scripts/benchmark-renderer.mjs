import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';

// Isolated renderer comparison: same actors, poses and camera route for every run.
// CPU submission timings and headless frame intervals are not native GPU measurements.
const output = process.argv[2] || 'load-results/renderer-current.json';
const baseURL = process.env.BURNHOP_BENCH_URL || 'http://127.0.0.1:5173';
const variant = process.env.BURNHOP_BENCH_VARIANT || 'high';
const combatStress = process.env.BURNHOP_BENCH_COMBAT === '1';
const browser = await chromium.launch();
const results = [];
try {
  for (const density of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: density });
    await page.goto(`${baseURL}/public/assets/outpost.json`.replace('/public/', '/'));
    await page.evaluate(() => { document.body.innerHTML = '<canvas style="position:fixed;inset:0;width:100%;height:100%"></canvas>'; });
    const sample = await page.evaluate(async ({ variant, combatStress }) => {
      const [{ Renderer }, { createWorld, stepActor, compileArena }, { DEFAULT_APPEARANCE }, arena, { createWeapon }] = await Promise.all([
        import('/src/game/renderer.ts'), import('/src/game/simulation.ts'), import('/src/game/appearance.ts'),
        fetch('/assets/outpost.json').then(r => r.json()), import('/src/game/weapons.ts'),
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
        if (combatStress) {
          player.x = arena.playerSpawn.x + i * 65;
          player.weapon = createWeapon('uzi', `bench:${i}:main`);
          player.offhand = createWeapon('ump', `bench:${i}:offhand`);
        } else if (i >= 4) player.x += 2500;
        return { player, appearance: DEFAULT_APPEARANCE, nickname: player.nickname, connected: true, protected: false, lifeId: 1 };
      });
      const submission = [], intervals = [], transitions = [];
      let last = 0, peakFragments = 0, shots = 0, deaths = 0;
      const compiled = compileArena(arena);
      for (let frame = 0; frame < (combatStress ? 300 : 150); frame++) {
        const now = await new Promise(requestAnimationFrame);
        if (frame > 20) intervals.push(now - last);
        last = now;
        const events = [];
        for (const actor of actors) {
          actor.player.aimAngle = Math.sin(frame / 40) * .6; actor.player.vx = 100;
          if (combatStress) {
            const fired = stepActor(actor.player, { moveX: 0, jumpPressed: false, jumpHeld: false,
              aimAngle: actor.player.aimAngle, fireHeld: true,
              reloadPressed: actor.player.weapon.ammo === 0 && actor.player.offhand.ammo === 0 }, compiled);
            shots += fired.filter(event => event.type === 'shot').length;
            events.push(...fired.map(event => ({ ...event, actorId: actor.player.id, lifeId: 1 })));
            if (frame === 40 || frame === 95) {
              deaths++;
              events.push({ type: 'targetDeath', id: `bench:death:${frame}:${actor.player.id}`, actorId: actor.player.id,
                lifeId: 1, x: actor.player.x, y: actor.player.y, cosmeticSeed: frame + Number(actor.player.id),
                deathPose: { ...actor.player, appearance: actor.appearance }, impactDirection: { x: 1, y: -.2 } });
            }
          }
        }
        if (frame === 65) renderer.setZoom(4);
        if (frame === 100) renderer.setZoom(1);
        const start = performance.now();
        renderer.renderOnline(actors, '0', frame, events, 1 / 60);
        const work = performance.now() - start;
        peakFragments = Math.max(peakFragments, renderer.getPerformanceDiagnostics().deathFragments);
        if (frame === 0 || frame === 65 || frame === 100) transitions.push({ frame, workMs: work });
        else if (frame > 20) submission.push(work);
      }
      const stats = values => {
        values.sort((a, b) => a - b);
        return { median: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], p99: values[Math.floor(values.length * .99)],
          max: values.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length };
      };
      const result = { canvas: { width: canvas.width, height: canvas.height }, submissionMs: stats(submission),
        intervalMs: stats(intervals), transitions, diagnostics: renderer.getPerformanceDiagnostics?.(),
        combat: { shots, deaths, peakFragments, remainingFragments: renderer.getPerformanceDiagnostics().deathFragments } };
      if (combatStress && (shots < 300 || peakFragments !== (variant === 'low' ? 24 : 48) || result.combat.remainingFragments !== 0)) {
        throw new Error(`Combat stress workload or fragment cleanup failed: ${JSON.stringify(result.combat)}`);
      }
      window.benchmarkRenderer = renderer;
      return result;
    }, { variant, combatStress });
    await mkdir(dirname(output), { recursive: true });
    await page.screenshot({ path: `${dirname(output)}/${basename(output, extname(output))}-dpr${density}.png` });
    results.push({ density, ...sample });
    await page.close();
  }
  const report = { variant, combatStress, note: 'Headless Chromium on the current host; eight actors, fixed camera route. Optional combat mode uses shared dual UZI/UMP firing/reloads and two bursts of eight death events while actors remain visible to stress the fragment cap. Renderer is called every animation frame independently of the runtime frame cap. CPU submission excludes asynchronous raster/GPU completion. Not a Windows FPS guarantee.', results };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
