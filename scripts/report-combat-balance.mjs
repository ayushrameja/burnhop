import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// A reproducible worksheet from the shipped catalog, not a claim of human balance.
const output = process.argv[2] || 'load-results/combat-balance.md';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.env.BURNHOP_BENCH_URL || 'http://127.0.0.1:5173');
  const rows = await page.evaluate(async () => {
    const [{ WEAPONS }, { calculateDamage }] = await Promise.all([
      import('/src/game/weapons.ts'), import('/src/game/combat.ts'),
    ]);
    return Object.values(WEAPONS).flatMap(weapon => [150, 500, 1000].map(distance => {
      const body = calculateDamage(weapon.id, 'body', distance), hits = Math.ceil(100 / body);
      // Reload can start the tick after the magazine empties and can finish before a long shot cooldown.
      let elapsedTicks = 0;
      for (let shot = 1; shot < hits; shot++) {
        elapsedTicks += shot % weapon.magazineSize === 0
          ? Math.max(weapon.cooldownTicks, weapon.reloadTicks + 1) : weapon.cooldownTicks;
      }
      return { name: weapon.name, distance, body, head: calculateDamage(weapon.id, 'head', distance),
        legs: calculateDamage(weapon.id, 'legs', distance), hits, seconds: elapsedTicks / 60 };
    }));
  });
  const report = ['# Combat balance worksheet', '',
    'Generated from the implemented weapon catalog. Distances are world pixels; target health is 100. Damage is rounded once. Ideal body TTK starts on the first hit, assumes no misses, and includes the earliest manual reload when required. Spread, recoil, movement, exposure and human aim make actual outcomes different.', '',
    '| Weapon | Distance | Head | Body | Legs | Body hits | Ideal body TTK |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows.map(row => `| ${row.name} | ${row.distance} | ${row.head} | ${row.body} | ${row.legs} | ${row.hits} | ${row.seconds.toFixed(3)} s |`), '',
    'Human session notes remain pending: compare burst and sustained aim, crouch/air accuracy, dual reload exposure, spawn-to-pickup access and whether either rifle dominates experienced players. Run this script against the local Vite server after tuning changes.', ''].join('\n');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, report);
  console.log(report);
} finally { await browser.close(); }
