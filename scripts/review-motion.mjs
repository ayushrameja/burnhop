import { installCapture, enterFullscreen, moveAim } from '../tests/helpers/capture.ts';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Run against the development server: node scripts/review-motion.mjs.
const browser = await chromium.launch();
const directory = 'docs/screenshots';
await mkdir(directory, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installCapture(page);
  await page.goto('http://127.0.0.1:5173/');
  await enterFullscreen(page);
  await expect(page.getByTestId('menu-screen')).toBeVisible();
  await page.screenshot({ path: `${directory}/12-jet-boots-menu.png` });
  await page.screenshot({ path: `${directory}/19-capture-ready.png` });
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  const ticks = async count => {
    const target = await page.evaluate(count => window.__BURNHOP__.snapshot().tick + count, count);
    await page.waitForFunction(target => window.__BURNHOP__.snapshot().tick >= target, target);
  };
  const point = await page.evaluate(() => {
    const api = window.__BURNHOP__, pivot = api.aim().reticle.pivot;
    return api.toScreen(pivot.x + 190, pivot.y);
  });
  await moveAim(page, point.x, point.y);
  // Let the FPS rolling window settle after entry before recording the steady gameplay view.
  await ticks(45);
  await page.screenshot({ path: `${directory}/13-radial-aim.png` });
  await page.mouse.down({ button: 'right' });
  await ticks(3);
  await page.screenshot({ path: `${directory}/14-pointer-aim.png` });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('KeyA');
  await ticks(15);
  await page.screenshot({ path: `${directory}/15-backward-stride.png` });
  await page.keyboard.up('KeyA');
  await page.keyboard.press('Space');
  await ticks(9);
  await page.keyboard.down('Space');
  await ticks(16);
  expect(await page.evaluate(() => window.__BURNHOP__.snapshot().player.thrusting)).toBe(true);
  await page.screenshot({ path: `${directory}/16-boot-thrust.png` });
  await page.keyboard.up('Space');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${directory}/17-aim-controls.png` });

  // An enlarged frame sheet makes joint motion and sole attachment inspectable.
  await page.evaluate(async () => {
    const { calculateCharacterPose } = await import('/src/game/character.ts');
    const { drawDetailedCharacter } = await import('/src/game/detailedCharacter.ts');
    const { DEFAULT_APPEARANCE } = await import('/src/game/appearance.ts');
    const { loadGame } = await import('/src/game/loading.ts');
    const assets = await loadGame(() => {});
    const rows = [
      ['Forward stride', { aimAngle: 0, moving: true, moveSpeed: 320, walkAmount: 1 }],
      ['Backward stride', { aimAngle: 0, moving: true, moveSpeed: -320, walkAmount: 1 }],
      ['Left-facing stride', { aimAngle: Math.PI, moving: true, moveSpeed: -320, walkAmount: 1 }],
      ['Jump / fall / thrust', null],
    ];
    document.body.replaceChildren();
    document.body.style.cssText = 'margin:0;background:#101e18;overflow:auto';
    const canvas = document.createElement('canvas');
    canvas.width = 1440; canvas.height = 1250;
    canvas.style.cssText = 'display:block;width:1440px;height:1250px';
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101e18'; ctx.fillRect(0, 0, 1440, 1250);
    rows.forEach(([label, base], row) => {
      ctx.fillStyle = '#e4e7ce'; ctx.font = '18px monospace';
      ctx.fillText(label, 20, row * 300 + 28);
      for (let column = 0; column < 6; column++) {
        const flight = [
          { aimAngle: 0 },
          { aimAngle: 0, airborne: true, verticalSpeed: -520 },
          { aimAngle: 0, airborne: true, verticalSpeed: 420 },
          { aimAngle: 0, airborne: true, thrusting: true },
          { aimAngle: Math.PI, airborne: true, thrusting: true },
          { aimAngle: 0, airborne: true, thrusting: true, reducedMotion: true },
        ];
        const pose = { crouchAmount: 0, locomotion: true, ...(base ? { ...base, walkPhase: column * Math.PI / 3 } : flight[column]) };
        const x = column * 240 + 115, y = row * 300 + 255;
        ctx.strokeStyle = '#3f5546'; ctx.lineWidth = 1;
        ctx.beginPath();ctx.moveTo(column * 240 + 15,y);ctx.lineTo(column * 240 + 225,y);ctx.stroke();
        const geometry = calculateCharacterPose(pose);
        drawDetailedCharacter(ctx, x, y, 2.5, pose, DEFAULT_APPEARANCE, assets.images);
        ctx.fillStyle = '#a5b79b';ctx.font = '12px monospace';
        ctx.fillText(base ? `${column * 60}°` : ['Idle','Jump','Fall','Thrust','Thrust left','Reduced motion'][column], column * 240 + 18, row * 300 + (base ? 290 : 330));
      }
    });
  });
  await page.screenshot({ path: `${directory}/18-leg-and-boot-poses.png`, fullPage: true });
  expect(errors).toEqual([]);
  console.log('Motion screenshots captured; browser errors: 0');
} finally {
  await browser.close();
}
