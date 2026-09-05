import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import outpost from '../public/assets/outpost.json' with { type: 'json' };
import { CONFIG } from '../src/game/simulation';
import { CROUCH_COLLISION_HEIGHT } from '../src/game/stance';
import { rectOverlapsSolid } from '../src/game/collision';
import type { Arena, PlayerState } from '../src/game/types';
import { enterPractice, installCapture, openMenu } from './helpers/capture';

const arena = outpost as Arena;
const screenshots = 'docs/screenshots/outpost';

// Each route begins on an existing supported landing. Only the player spawn is
// overridden; all contours, materials, target and rendering remain the real map.
const mouths = [
  { id: 'west-left', outside: { x: 469, y: 649.6 }, insideX: 588, lip: 518, low: false },
  { id: 'west-right', outside: { x: 868, y: 627.9 }, insideX: 721, lip: 805, low: true },
  { id: 'east-left', outside: { x: 3945.2, y: 1060.4 }, insideX: 4067, lip: 3994, low: true },
  { id: 'east-right', outside: { x: 4356.8, y: 1060.8137931034482 }, insideX: 4244.8, lip: 4298, low: true },
];
async function player(page: Page) { return page.evaluate(() => window.__BURNHOP__!.snapshot().player); }
async function ticks(page: Page, count: number) {
  const until = await page.evaluate(count => window.__BURNHOP__!.snapshot().tick + count, count);
  await page.waitForFunction(until => window.__BURNHOP__!.snapshot().tick >= until, until);
}
function expectClear(body: PlayerState) {
  expect(arena.terrain!.filter(solid => rectOverlapsSolid(body, solid)).map(solid => solid.id)).toEqual([]);
}
async function crouch(page: Page) {
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => {
    const body = window.__BURNHOP__!.snapshot().player;
    return body.grounded && body.crouchAmount === 1;
  });
  expect((await player(page)).height).toBeCloseTo(CROUCH_COLLISION_HEIGHT, 6);
}
async function walkTo(page: Page, targetX: number) {
  const start = await player(page);
  const direction = targetX > start.x ? 1 : -1;
  const key = direction === 1 ? 'KeyD' : 'KeyA';
  await page.keyboard.down(key);
  try {
    const result = await page.evaluate(async ({ targetX, direction, terrain }) => {
      // Import the same read-only collision query the simulation uses, then
      // inspect every rendered frame without changing runtime state.
      const modulePath = '/src/game/collision.ts';
      const { rectOverlapsSolid } = await import(modulePath);
      const startTick = window.__BURNHOP__!.snapshot().tick;
      const overlaps = new Set<string>();
      let samples = 0;
      return new Promise<{ reached: boolean; x: number; overlaps: string[]; samples: number }>(resolve => {
        const sample = () => {
          const world = window.__BURNHOP__!.snapshot();
          const body = world.player;
          samples++;
          for (const solid of terrain) if (rectOverlapsSolid(body, solid)) overlaps.add(solid.id);
          const reached = direction > 0 ? body.x >= targetX : body.x <= targetX;
          if (reached || world.tick - startTick >= 300) {
            resolve({ reached, x: body.x, overlaps: [...overlaps], samples });
          } else requestAnimationFrame(sample);
        };
        sample();
      });
    }, { targetX, direction, terrain: arena.terrain! });
    expect(result.overlaps, `Terrain overlap while walking to x=${targetX}`).toEqual([]);
    expect(result.reached, `Stopped at x=${result.x}, target x=${targetX}`).toBe(true);
  } finally { await page.keyboard.up(key); }
  await page.waitForFunction(() => Math.abs(window.__BURNHOP__!.snapshot().player.vx) < 0.01);
  expectClear(await player(page));
}

test.use({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });
test.beforeEach(async ({ page }) => { await installCapture(page); });

for (const mouth of mouths) {
  test(`${mouth.id} bunker entrance supports crouched passage in both directions`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const playerSpawn = mouth.outside;
    await page.route('**/assets/outpost.json', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ ...outpost, playerSpawn }),
    }));
    await openMenu(page, '/?map=outpost');
    await enterPractice(page);
    await expect(page.getByTestId('arena-name')).toHaveText('Outpost');
    expectClear(await player(page));
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('zoom-level')).toHaveText('3x');
    await crouch(page);
    await walkTo(page, mouth.lip);
    const underLip = await player(page);
    expect(underLip.grounded).toBe(true);
    expect(underLip.crouchAmount).toBe(1);
    if (mouth.low) {
      const standing = { ...underLip, y: underLip.y + underLip.height - CONFIG.bodyHeight, height: CONFIG.bodyHeight };
      expect(arena.terrain!.some(solid => rectOverlapsSolid(standing, solid)), `Standing probe should meet the lip at x=${underLip.x}`).toBe(true);
    }
    await page.screenshot({ path: `${screenshots}/${mouth.id}-entrance-crouch.png` });

    await page.keyboard.up('KeyS');
    await ticks(page, 24);
    const released = await player(page);
    if (mouth.low) {
      expect(released.crouchAmount).toBeGreaterThan(0);
      expect(released.height).toBeLessThan(CONFIG.bodyHeight);
      expectClear(released);
    }
    // Clearing the lip must restore standing by itself, with no jump or second
    // crouch key needed to escape a forced stance.
    await walkTo(page, mouth.insideX);
    await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.crouchAmount === 0);
    expect((await player(page)).height).toBe(CONFIG.bodyHeight);
    await crouch(page);
    await walkTo(page, mouth.outside.x);
    await page.keyboard.up('KeyS');
    await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.crouchAmount === 0);
    expectClear(await player(page));
    expect((await player(page)).fuel).toBe(100);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
