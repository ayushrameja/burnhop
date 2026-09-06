import { test, expect } from '@playwright/test';
import { enterPractice, installCapture, openMenu } from './helpers/capture';

test('Q equips a second revolver, taps alternate hands, holding fires both, and both magazines reload', async ({ page }, info) => {
  await installCapture(page); await openMenu(page); await enterPractice(page);
  const target = await page.evaluate(() => window.__BURNHOP__!.pickups().find(p => p.weaponId === 'revolver')!.x);
  await page.keyboard.down('KeyA');
  await page.waitForFunction(x => window.__BURNHOP__!.snapshot().player.x + 18 <= x + 5, target);
  await page.keyboard.up('KeyA');
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.weaponId === 'revolver');
  await expect(page.locator('.combat-pickup-prompt')).toContainText('Q Pair');
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.offhand?.weaponId === 'revolver');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.equipTicks === 0);
  await page.getByTestId('game-canvas').hover();
  const hands: string[] = [];
  for (let tap = 0; tap < 4; tap++) {
    await page.waitForFunction(() => {
      const p = window.__BURNHOP__!.snapshot().player;
      return p.weapon.cooldownTicks === 0 && p.offhand!.cooldownTicks === 0;
    });
    const before = await page.evaluate(() => {
      const p = window.__BURNHOP__!.snapshot().player;
      return [p.weapon.shotCounter, p.offhand!.shotCounter];
    });
    await page.mouse.click(1000, 350, { delay: 50 });
    const after = await page.evaluate(() => {
      const p = window.__BURNHOP__!.snapshot().player;
      return [p.weapon.shotCounter, p.offhand!.shotCounter];
    });
    expect(after[0] + after[1] - before[0] - before[1]).toBe(1);
    hands.push(after[0] > before[0] ? 'main' : 'offhand');
  }
  expect(hands).toEqual(['main', 'offhand', 'main', 'offhand']);
  await page.screenshot({ path: info.outputPath('paired-revolvers.png') });
  await page.getByTestId('game-canvas').hover(); await page.mouse.down();
  await page.waitForFunction(() => {
    const p = window.__BURNHOP__!.snapshot().player;
    return p.weapon.shotCounter > 2 && p.offhand!.shotCounter > 2;
  });
  await page.mouse.up();
  const p = await page.evaluate(() => window.__BURNHOP__!.snapshot().player);
  expect(p.weapon.ammo).toBeLessThan(6); expect(p.offhand!.ammo).toBeLessThan(6);
  expect(p.weapon.instanceId).not.toBe(p.offhand!.instanceId);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => {
    const p = window.__BURNHOP__!.snapshot().player;
    return p.weapon.ammo === 6 && p.offhand!.ammo === 6;
  });
});

test('handgun and dual grips remain attached across aim, facing and crouch', async ({ page }, info) => {
  await page.route('**/handgun-art-review', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"></body></html>' }));
  await page.goto('/handgun-art-review');
  await page.evaluate(async () => {
    const modulePath = '/src/game/detailedCharacter.ts', appearancePath = '/src/game/appearance.ts';
    const { drawDetailedCharacter } = await import(modulePath);
    const { DEFAULT_APPEARANCE } = await import(appearancePath);
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 1280;
    document.body.append(canvas); const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#20332f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const poses = [
      ...['pistol', 'revolver'].flatMap(weaponId => [0, Math.PI, -.8, .8].map(aimAngle => ({ weaponId, aimAngle }))),
      { weaponId: 'pistol', offhandWeaponId: 'pistol', aimAngle: 0 },
      { weaponId: 'revolver', offhandWeaponId: 'revolver', aimAngle: 0 },
      { weaponId: 'pistol', offhandWeaponId: 'revolver', aimAngle: -.8 },
      { weaponId: 'revolver', offhandWeaponId: 'revolver', aimAngle: Math.PI, crouchAmount: 1 },
      { weaponId: 'pistol', offhandWeaponId: 'pistol', aimAngle: Math.PI },
      { weaponId: 'uzi', offhandWeaponId: 'ump', aimAngle: .8 },
      { weaponId: 'revolver', offhandWeaponId: 'revolver', aimAngle: 0, reloadProgress: .3 },
      { weaponId: 'revolver', offhandWeaponId: 'revolver', aimAngle: 0, offhandReloadProgress: .3 },
    ];
    poses.forEach((pose, index) => {
      const x = index % 4 * 320, y = Math.floor(index / 4) * 320;
      ctx.strokeStyle = '#50655b'; ctx.strokeRect(x + 6, y + 6, 308, 308);
      ctx.fillStyle = '#e7e3c5'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${pose.weaponId}${'offhandWeaponId' in pose ? ' + ' + pose.offhandWeaponId : ''}`, x + 160, y + 29);
      drawDetailedCharacter(ctx, x + 160, y + 284, 2.6, { reducedMotion: true, recoil: 0, reloadProgress: -1, ...pose }, DEFAULT_APPEARANCE);
    });
  });
  await page.setViewportSize({ width: 1280, height: 1280 });
  await page.screenshot({ path: info.outputPath('handgun-grips.png') });
});
