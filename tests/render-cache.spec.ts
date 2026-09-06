import { expect, test } from '@playwright/test';

test('cached decoration paths reproduce the original artwork at different camera transforms', async ({ page }) => {
  await page.goto('/assets/outpost.json');
  const differences = await page.evaluate(async () => {
    const modulePath = '/src/game/outpostArtwork.ts';
    const { OutpostArtwork } = await import(modulePath) as typeof import('../src/game/outpostArtwork');
    const artwork = new OutpostArtwork();
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 620;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const results = [];
    for (const scale of [.25, .7, 1.5]) for (const foreground of [false, true]) {
      const draw = (cached: boolean) => {
        ctx.resetTransform(); ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale); ctx.translate(-180, -50);
        if (cached) artwork.decoration(ctx, foreground);
        else (artwork as unknown as { paintDecoration: (ctx: CanvasRenderingContext2D, foreground: boolean) => void }).paintDecoration(ctx, foreground);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const original = draw(false), cached = draw(true);
      let changed = 0;
      for (let i = 0; i < original.length; i++) if (Math.abs(original[i] - cached[i]) > 1) changed++;
      results.push({ scale, foreground, changed });
    }
    return results;
  });
  for (const result of differences) expect(result.changed, JSON.stringify(result)).toBe(0);
});

test('cached character heads retain cosmetics, silhouette and live poses without clipping', async ({ page }, testInfo) => {
  await page.goto('/assets/outpost.json');
  const results = await page.evaluate(async () => {
    const detailedPath = '/src/game/detailedCharacter.ts', appearancePath = '/src/game/appearance.ts', cachePath = '/src/game/characterParts.ts';
    const { drawDetailedCharacter } = await import(detailedPath) as typeof import('../src/game/detailedCharacter');
    const { CHARACTER_LOOKS } = await import(appearancePath) as typeof import('../src/game/appearance');
    const { CharacterParts } = await import(cachePath) as typeof import('../src/game/characterParts');
    document.body.innerHTML = '';
    const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 440;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!, cache = new CharacterParts();
    const results = [];
    for (const look of CHARACTER_LOOKS) for (const angle of [-1.2, 0, 2]) for (const crouchAmount of [0, 1]) {
      const draw = (cached: boolean) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawDetailedCharacter(ctx, 192, 380, 3, { aimAngle: angle, crouchAmount, reloadProgress: .55 }, look.appearance, {}, cached ? cache : undefined);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const original = draw(false), cached = draw(true);
      let error = 0, painted = 0, lost = 0;
      for (let i = 0; i < original.length; i += 4) {
        if (!original[i + 3] && !cached[i + 3]) continue;
        painted++;
        if (original[i + 3] > 240 && cached[i + 3] < 200) lost++;
        // Ignore RGB in fully transparent pixels; compare premultiplied colour.
        for (let c = 0; c < 3; c++) error += Math.abs(original[i + c] * original[i + 3] - cached[i + c] * cached[i + 3]) / 255;
      }
      results.push({ look: look.id, angle, crouchAmount, meanError: error / (painted * 3), lostFraction: lost / painted });
      if (angle === 0 && crouchAmount === 0) {
        const image = new Image(); image.src = canvas.toDataURL(); image.width = 192; image.height = 220; image.alt = look.name;
        document.body.append(image);
      }
    }
    cache.destroy();
    return results;
  });
  for (const result of results) {
    expect(result.meanError, JSON.stringify(result)).toBeLessThan(8);
    expect(result.lostFraction, JSON.stringify(result)).toBeLessThan(.02);
  }
  await page.screenshot({ path: testInfo.outputPath('cached-character-looks.png') });
});
