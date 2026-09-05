import { installCapture, openMenu, moveAim } from './helpers/capture';
import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import arena from '../public/assets/arena.json' with { type: 'json' };
import { CONFIG, getWeaponOrigin } from '../src/game/simulation';
import { CROUCH_COLLISION_HEIGHT } from '../src/game/stance';

test.beforeEach(async ({ page }) => { await installCapture(page); });

const screenshots = 'docs/screenshots';
test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });

async function enter(page: Page) {
  await openMenu(page);
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
}

async function snapshot(page: Page) {
  return page.evaluate(() => window.__BURNHOP__!.snapshot());
}

async function ticks(page: Page, count: number) {
  const tick = (await snapshot(page)).tick;
  await page.waitForFunction(until => window.__BURNHOP__!.snapshot().tick >= until, tick + count);
}

async function stance(page: Page, amount: 0 | 1) {
  await page.waitForFunction(expected => {
    const player = window.__BURNHOP__!.snapshot().player;
    return player.crouchAmount === expected && player.grounded;
  }, amount);
}

async function checkStationaryOrigin(page: Page) {
  // Read both diagnostics in one browser turn. A planted, fully settled stance
  // has the same simulation and interpolated-render positions.
  await ticks(page, 2);
  const { world, aim } = await page.evaluate(() => {
    const api = window.__BURNHOP__!;
    return { world: api.snapshot(), aim: api.aim() };
  });
  expect(Math.abs(world.player.vx)).toBeLessThan(0.01);
  const origin = getWeaponOrigin(world.player);
  expect(aim.reticle).not.toBeNull();
  expect(aim.reticle!.pivot.x).toBeCloseTo(origin.x, 6);
  expect(aim.reticle!.pivot.y).toBeCloseTo(origin.y, 6);
  return origin;
}

test('both crouch keys preserve planted feet and clear after release, blur, and restart', async ({ page }) => {
  await enter(page);
  const standing = (await snapshot(page)).player;
  const feetY = standing.y + standing.height;
  expect(standing.crouchAmount).toBe(0);
  expect(standing.height).toBe(CONFIG.bodyHeight);

  await page.keyboard.down('KeyS');
  await stance(page, 1);
  const crouched = (await snapshot(page)).player;
  expect(crouched.height).toBeCloseTo(CROUCH_COLLISION_HEIGHT, 6);
  expect(crouched.height).toBeLessThan(standing.height - 10);
  expect(crouched.y + crouched.height).toBeCloseTo(feetY, 6);
  await page.screenshot({ path: `${screenshots}/30-gameplay-crouch.png` });

  // Releasing either alias must leave the other independently held key active.
  await page.keyboard.down('ArrowDown');
  await page.keyboard.up('KeyS');
  await ticks(page, 18);
  expect((await snapshot(page)).player.crouchAmount).toBe(1);
  await page.keyboard.up('ArrowDown');
  await stance(page, 0);
  expect((await snapshot(page)).player.y).toBeCloseTo(standing.y, 6);

  await page.keyboard.down('ArrowDown');
  await stance(page, 1);
  await page.keyboard.down('KeyS');
  await page.keyboard.up('ArrowDown');
  await ticks(page, 18);
  expect((await snapshot(page)).player.crouchAmount).toBe(1);

  // Blur is a browser event, as in the existing focus-recovery coverage. The
  // runtime must forget the held key even before the physical key is released.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__BURNHOP__!.metrics().running)).toBe(false);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await stance(page, 0);
  await page.keyboard.up('KeyS');
  expect((await snapshot(page)).player.y + (await snapshot(page)).player.height).toBeCloseTo(feetY, 6);

  await page.keyboard.down('ArrowDown');
  await stance(page, 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Restart practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__!.metrics().running);
  await ticks(page, 18);
  const restarted = (await snapshot(page)).player;
  expect(restarted.crouchAmount).toBe(0);
  expect(restarted.height).toBe(CONFIG.bodyHeight);
  expect(restarted.y + restarted.height).toBeCloseTo(feetY, 6);
  await page.keyboard.up('ArrowDown');
});

test('crouch walking slows the player while firing and aiming stay aligned with the lowered weapon', async ({ page }) => {
  await enter(page);
  // Keep the spawn target visible while checking crouched firing.
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('zoom-level')).toContainText('3x');
  const standingOrigin = await checkStationaryOrigin(page);
  await page.keyboard.down('KeyS');
  await stance(page, 1);
  const crouchOrigin = await checkStationaryOrigin(page);
  expect(crouchOrigin.y).toBeGreaterThan(standingOrigin.y + 10);

  const before = await snapshot(page);
  const target = await page.evaluate(() => {
    const api = window.__BURNHOP__!;
    const target = api.snapshot().target;
    return api.toScreen(target.x + target.width / 2, target.y + target.height / 2);
  });
  await moveAim(page, target.x, target.y);
  await page.keyboard.down('KeyD');
  await page.mouse.down();
  await page.waitForFunction(previous => {
    const world = window.__BURNHOP__!.snapshot();
    return world.hits > previous.hits && world.player.x > previous.x + 20
      && world.player.vx >= 159 && world.player.crouchAmount === 1;
  }, { hits: before.hits, x: before.player.x });
  await page.mouse.up();
  const moving = await snapshot(page);
  expect(moving.player.vx).toBeCloseTo(CONFIG.moveSpeed / 2, 5);
  expect(moving.player.grounded).toBe(true);
  expect(moving.player.y + moving.player.height).toBeCloseTo(arena.floorY, 6);
  expect(moving.shotsFired).toBeGreaterThan(before.shotsFired);
  expect(moving.hits).toBeGreaterThan(before.hits);
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => Math.abs(window.__BURNHOP__!.snapshot().player.vx) < 0.01);
  await checkStationaryOrigin(page);
  await page.keyboard.up('KeyS');
  await stance(page, 0);
  await checkStationaryOrigin(page);
});

test('a low ceiling prevents standing until crouch walking clears its edge', async ({ page }) => {
  const roof = { x: 540, y: arena.floorY - 120, width: 360, height: 64 };
  const roofBottom = roof.y + roof.height;
  // This valid arena is delivered through normal asset loading. The live world
  // remains read-only; entering and leaving the tunnel uses keyboard movement.
  await page.route('**/assets/arena.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ...arena, platforms: [roof], targetSpawn: { x: 1200, y: arena.floorY - CONFIG.bodyHeight } }),
  }));
  await enter(page);
  await page.keyboard.down('KeyS');
  await stance(page, 1);
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.x >= 660);
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => Math.abs(window.__BURNHOP__!.snapshot().player.vx) < 0.01);
  await page.keyboard.up('KeyS');
  await ticks(page, 24);
  const blocked = (await snapshot(page)).player;
  expect(blocked.x).toBeGreaterThan(roof.x);
  expect(blocked.x + blocked.width).toBeLessThan(roof.x + roof.width);
  expect(blocked.crouchAmount).toBeGreaterThan(0);
  expect(blocked.height).toBeLessThanOrEqual(arena.floorY - roofBottom + 1e-6);
  expect(blocked.y).toBeGreaterThanOrEqual(roofBottom - 1e-6);
  expect(blocked.y + blocked.height).toBeCloseTo(arena.floorY, 6);
  await page.screenshot({ path: `${screenshots}/31-gameplay-crouch-ceiling.png` });

  // No second crouch press: the blocked stance must recover by itself once the
  // collider has clearance, without jumping into or tunneling through the roof.
  await page.keyboard.down('KeyD');
  await page.waitForFunction(edge => window.__BURNHOP__!.snapshot().player.x > edge, roof.x + roof.width + 10);
  await page.keyboard.up('KeyD');
  await stance(page, 0);
  const clear = (await snapshot(page)).player;
  expect(clear.height).toBe(CONFIG.bodyHeight);
  expect(clear.y + clear.height).toBeCloseTo(arena.floorY, 6);
});

test('jump and second-press thrust override held crouch in the air and restore it on landing', async ({ page }) => {
  await enter(page);
  await page.keyboard.down('KeyS');
  await stance(page, 1);
  const feetY = (await snapshot(page)).player.y + (await snapshot(page)).player.height;
  await page.keyboard.press('Space');
  await page.waitForFunction(() => {
    const player = window.__BURNHOP__!.snapshot().player;
    return !player.grounded && player.vy < -100;
  });
  await page.waitForFunction(() => {
    const player = window.__BURNHOP__!.snapshot().player;
    return !player.grounded && player.crouchAmount === 0;
  });
  const jumping = (await snapshot(page)).player;
  expect(jumping.height).toBe(CONFIG.bodyHeight);
  expect(jumping.y + jumping.height).toBeLessThan(feetY - 20);
  expect(jumping.fuel).toBe(CONFIG.maxFuel);
  expect(jumping.thrusting).toBe(false);

  await page.keyboard.down('Space');
  await page.waitForFunction(() => {
    const player = window.__BURNHOP__!.snapshot().player;
    return player.thrusting && player.fuel < 99 && player.crouchAmount === 0;
  });
  await page.screenshot({ path: `${screenshots}/32-gameplay-crouch-to-flight.png` });
  await page.keyboard.up('Space');
  await stance(page, 1);
  expect((await snapshot(page)).player.thrusting).toBe(false);
  await page.keyboard.up('KeyS');
  await stance(page, 0);
});
