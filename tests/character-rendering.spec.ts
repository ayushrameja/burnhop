import { installCapture, openMenu, enterFullscreen, moveAim } from './helpers/capture';
import { test, expect, type Page } from '@playwright/test';
import { choosePracticeLoadout, cycleViewTo } from './helpers/combat';
import { mkdir, writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await installCapture(page); });

const screenshots = 'docs/screenshots';
test.beforeAll(async () => { await mkdir(screenshots, { recursive: true }); });

async function openPreview(page: Page) {
  await page.goto('/?preview=character');
  await enterFullscreen(page);
  await expect(page.getByTestId('character-preview')).toBeVisible();
}
async function paint(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
const enlarged = (page: Page) => page.getByRole('img', { name: /^Enlarged / });
async function choose(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await paint(page);
}

test('the shared renderer keeps the upper thigh behind the waist, for every build, stance and facing', async ({ page }) => {
  await openPreview(page);
  const samples = await page.evaluate(async () => {
    const characterPath = '/src/game/character.ts', detailedPath = '/src/game/detailedCharacter.ts', appearancePath = '/src/game/appearance.ts';
    const character = await import(characterPath) as typeof import('../src/game/character');
    const detailed = await import(detailedPath) as typeof import('../src/game/detailedCharacter');
    const catalog = await import(appearancePath) as typeof import('../src/game/appearance');
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    const results = [];
    for (const crouchAmount of [0, .5, 1]) for (const facing of [1, -1]) {
      const pose = { aimAngle: facing === 1 ? 0 : Math.PI, crouchAmount };
      const geometry = character.calculateCharacterPose(pose);
      // The sample lies inside the belt on the near hip, clear of the buckle and side pouch.
      // Previously the rounded thigh cap painted trousers over this exact waist area.
      const px = Math.floor(240 + (geometry.bodyOffset.x + 7) * 4 * facing);
      const py = Math.floor(440 + (geometry.bodyOffset.y - 25.4) * 4);
      const pixel = () => Array.from(ctx.getImageData(px, py, 1, 1).data);
      for (const build of ['slim', 'standard', 'broad'] as const) {
        ctx.clearRect(0, 0, 480, 480);
        detailed.drawDetailedCharacter(ctx, 240, 440, 4, pose, {
          ...catalog.BASE_APPEARANCE, build, trousersColor: 'rust', beltColor: 'charcoal', belt: 'webbing',
        });
        results.push({ name: `detailed ${build} ${crouchAmount} ${facing}`, pixel: pixel(), expected: [43, 54, 52, 255] });
      }
    }
    return results;
  });
  for (const sample of samples) expect(sample.pixel, sample.name).toEqual(sample.expected);
});

test('hit flash covers the composed artwork consistently without changing its opaque silhouette or scenery', async ({ page }) => {
  await openPreview(page);
  const results = await page.evaluate(async () => {
    const detailedPath = '/src/game/detailedCharacter.ts';
    const appearancePath = '/src/game/appearance.ts', loadingPath = '/src/game/loading.ts';
    const { drawDetailedCharacter } = await import(detailedPath) as typeof import('../src/game/detailedCharacter');
    const { CHARACTER_LOOKS } = await import(appearancePath) as typeof import('../src/game/appearance');
    const { loadGame } = await import(loadingPath) as typeof import('../src/game/loading');
    const { images } = await loadGame(() => {});
    const canvas = document.createElement('canvas'); canvas.width = 560; canvas.height = 640;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const results = [];
    const poses: import('../src/game/character').CharacterPose[] = [
      { aimAngle: 0, crouchAmount: 0 },
      { aimAngle: Math.PI, crouchAmount: 0 },
      { aimAngle: -Math.PI / 2 + 1e-8, crouchAmount: 1 },
      { aimAngle: Math.PI * 1.5 - 1e-8, crouchAmount: 1 },
      { aimAngle: Math.PI / 2 - 1e-8, crouchAmount: .5 },
      { aimAngle: 0, crouchAmount: 1, locomotion: true, walkAmount: 1, walkPhase: 2, moveSpeed: -160 },
      { aimAngle: -1.3, crouchAmount: 0, locomotion: true, airborneAmount: 1, verticalSpeed: -520, recoil: 1 },
      { aimAngle: Math.PI, crouchAmount: 0, locomotion: true, airborneAmount: 1, thrusting: true, thrustAmount: 1, time: .2 },
    ];
    for (const renderer of ['base', 'field', 'scout', 'heavy']) for (const [index, pose] of poses.entries()) {
      const draw = (hit: boolean) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawDetailedCharacter(ctx, 280, 500, 4, { ...pose, hit }, CHARACTER_LOOKS.find(look => look.id === renderer)!.appearance, images);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const normal = draw(false), hit = draw(true);
      let opaque = 0, unchanged = 0, tintedIncorrectly = 0, backgroundLeak = 0, alphaDifference = 0;
      for (let i = 0; i < normal.length; i += 4) {
        if (normal[i + 3] === 0 && hit[i + 3] > 8) backgroundLeak++;
        if (Math.abs(normal[i + 3] - hit[i + 3]) > 8) alphaDifference++;
        if (normal[i + 3] !== 255 || hit[i + 3] !== 255) continue;
        opaque++;
        if (normal[i] === hit[i] && normal[i + 1] === hit[i + 1] && normal[i + 2] === hit[i + 2]) unchanged++;
        // A single pale flash must reach every opaque component, including the
        // helmet, both legs, boots, gun, facial hair and vest that cover earlier layers.
        const tint = [255, 243, 219];
        if (tint.some((value, c) => Math.abs(hit[i + c] - (normal[i + c] * .22 + value * .78)) > 2)) tintedIncorrectly++;
      }
      // Flash a second character over existing scenery: source-atop must be scoped
      // to the character surface, never to the already opaque game canvas.
      ctx.fillStyle = '#173249'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawDetailedCharacter(ctx, 280, 500, 4, { ...pose, hit: true }, CHARACTER_LOOKS[1].appearance, images);
      const background = Array.from(ctx.getImageData(3, 3, 1, 1).data);
      results.push({ name: `${renderer} pose ${index}`, opaque, unchanged, tintedIncorrectly, backgroundLeak, alphaDifference, background });
    }
    return { loadedArtwork: !!images.insignia && !!images['range-banner'], samples: results };
  });
  expect(results.loadedArtwork).toBe(true);
  for (const sample of results.samples) {
    expect(sample.opaque, sample.name).toBeGreaterThan(10_000);
    expect(sample.unchanged, sample.name).toBe(0);
    // Replaying rotated paths on the offscreen surface can round a handful of
    // edge pixels differently; an untinted limb or accessory is far above this limit.
    expect(sample.tintedIncorrectly, sample.name).toBeLessThanOrEqual(Math.ceil(sample.opaque * .0002));
    expect(sample.backgroundLeak, sample.name).toBe(0);
    expect(sample.alphaDifference, sample.name).toBe(0);
    expect(sample.background, sample.name).toEqual([23, 50, 73, 255]);
  }
});

test('hit feedback is reviewable at both scales, by keyboard and with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPreview(page);
  const toggle = page.getByRole('checkbox', { name: 'Show hit flash', exact: true });
  const images = page.getByRole('img');
  const capture = () => images.evaluateAll(elements => elements
    .filter(element => /^(Enlarged |Face detail |Gameplay size )/.test(element.getAttribute('aria-label') ?? ''))
    .map(element => (element as HTMLCanvasElement).toDataURL()));
  for (const scenario of [
    { look: 'Field', pose: 'Stand', aim: 'Level', facing: 'left' },
    { look: 'Heavy', pose: 'Crouch', aim: 'Look up', facing: 'right' },
    { look: 'Scout', pose: 'Crouch', aim: 'Look down', facing: 'left' },
  ]) {
    await choose(page, scenario.look); await choose(page, scenario.pose); await choose(page, scenario.aim);
    const flip = page.getByRole('button', { name: `Face ${scenario.facing}`, exact: true });
    if (await flip.count()) await flip.click();
    await paint(page);
    const name = `${scenario.look.toLowerCase()}-${scenario.pose.toLowerCase()}-${scenario.aim.toLowerCase().replaceAll(' ', '-')}`;
    const normal = await capture();
    await enlarged(page).screenshot({ path: `${screenshots}/42-${name}-normal.png` });
    await toggle.focus(); await page.keyboard.press('Space');
    await expect(toggle).toBeChecked(); await paint(page);
    const flashed = await capture();
    expect(flashed.length).toBe(6);
    flashed.forEach((art, index) => expect(art).not.toBe(normal[index]));
    await enlarged(page).screenshot({ path: `${screenshots}/42-${name}-hit.png` });
    await page.locator('.character-native-row').screenshot({ path: `${screenshots}/42-${name}-gameplay-hit.png` });
    await paint(page); expect(await capture()).toEqual(flashed);
    await toggle.uncheck(); await paint(page); expect(await capture()).toEqual(normal);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await toggle.check(); await paint(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: `${screenshots}/42-hit-flash-mobile-320.png`, fullPage: true });
  expect(await page.evaluate(() => window.__BURNHOP__)).toBeUndefined();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(errors).toEqual([]);
});

test('a real M416 body hit deals 23 damage and starts and clears the target flash', async ({ page }) => {
  await openMenu(page);
  await page.getByRole('button', { name: 'Enter practice', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await choosePracticeLoadout(page, 'm416');
  await cycleViewTo(page, 2.5);
  const position = await page.evaluate(() => {
    const api = window.__BURNHOP__!, target = api.snapshot().target;
    return api.toScreen(target.x + target.width / 2, target.y + target.height / 2);
  });
  await moveAim(page, position.x, position.y);
  const observed = page.evaluate(() => new Promise<{ health: number; hits: number; maxFlash: number; cleared: boolean; hitImage: string; normalImage: string }>(resolve => {
    const api = window.__BURNHOP__!;
    let maxFlash = 0, hitImage = '', frames = 0;
    const crop = () => {
      const source = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
      const bounds = source.getBoundingClientRect(), ratio = source.width / bounds.width;
      const target = api.snapshot().target, feet = api.toScreen(target.x + target.width / 2, target.y + target.height);
      const image = document.createElement('canvas'); image.width = 140; image.height = 160;
      image.getContext('2d')!.drawImage(source, (feet.x - bounds.x - 55) * ratio, (feet.y - bounds.y - 110) * ratio, 110 * ratio, 125 * ratio, 0, 0, 140, 160);
      return image.toDataURL();
    };
    const read = () => {
      const state = api.snapshot(); maxFlash = Math.max(maxFlash, state.target.hitTicks);
      if (state.target.hitTicks > 0 && !hitImage) hitImage = crop();
      if ((hitImage && state.target.hitTicks === 0) || frames++ > 180) {
        resolve({ health: state.target.health, hits: state.hits, maxFlash, cleared: !!hitImage && state.target.hitTicks === 0, hitImage, normalImage: crop() });
      } else requestAnimationFrame(read);
    };
    requestAnimationFrame(read);
  }));
  // Keep the press across a simulation tick; an instantaneous click can begin
  // and end between fixed updates and therefore legitimately fire no shot.
  await page.mouse.down();
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().hits === 1);
  await page.mouse.up();
  const result = await observed;
  expect(result.health).toBe(77); expect(result.hits).toBe(1);
  expect(result.maxFlash).toBeGreaterThan(0); expect(result.maxFlash).toBeLessThanOrEqual(8);
  expect(result.cleared).toBe(true); expect(result.hitImage).not.toBe(result.normalImage);
  for (const [name, data] of [['hit', result.hitImage], ['normal', result.normalImage]]) {
    await writeFile(`${screenshots}/42-practice-target-${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
});
