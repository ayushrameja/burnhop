import { expect, test, type Page } from '@playwright/test';
import { SETTINGS_STORAGE_KEY } from '../src/game/settings';
import { enterMenu, enterPractice, installCapture, openMenu } from './helpers/capture';

interface AudioSnapshot {
  tracks: { id: number; paused: boolean; muted: boolean; loop: boolean; volume: number; currentTime: number; duration: number }[];
  tones: number;
}

/** Observe the real media and Web Audio APIs without replacing playback. */
async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const tracks: HTMLAudioElement[] = [];
    let tones = 0;
    const NativeAudio = window.Audio;
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args) {
        const track = Reflect.construct(target, args) as HTMLAudioElement;
        tracks.push(track);
        return track;
      },
    });
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = (when?: number) => { tones++; start(when); };
      return oscillator;
    };
    (window as Window & { __AUDIO_FIXTURE__?: () => AudioSnapshot }).__AUDIO_FIXTURE__ = () => ({
      tracks: tracks.flatMap((track, id) => track.src.endsWith('/assets/audio/midnight-hangar.mp3') ? [{
        id, paused: track.paused, muted: track.muted, loop: track.loop, volume: track.volume,
        currentTime: track.currentTime, duration: track.duration,
      }] : []),
      tones,
    });
    (window as Window & { __AUDIO_SEEK_END__?: () => void }).__AUDIO_SEEK_END__ = () => {
      const track = tracks.find(track => !track.paused && !track.muted);
      if (!track || !Number.isFinite(track.duration)) throw new Error('Menu music is not ready to seek.');
      track.currentTime = track.duration - 0.15;
    };
  });
}

async function audioState(page: Page): Promise<AudioSnapshot> {
  return page.evaluate(() => (window as Window & { __AUDIO_FIXTURE__?: () => AudioSnapshot }).__AUDIO_FIXTURE__!());
}

async function playingTracks(page: Page) {
  return (await audioState(page)).tracks.filter(track => !track.paused && !track.muted && track.volume > 0);
}

async function expectMusic(page: Page, playing: boolean) {
  await expect.poll(async () => (await playingTracks(page)).length).toBe(playing ? 1 : 0);
  if (playing) {
    const [track] = await playingTracks(page);
    expect(track.loop).toBe(true);
    expect(track.volume).toBeCloseTo(0.1);
  }
}

async function toneCount(page: Page) { return (await audioState(page)).tones; }

async function setPageHidden(page: Page, hidden: boolean) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.beforeEach(async ({ page }) => {
  await installCapture(page);
  await observeAudio(page);
});

test('menu music loops at 10%, follows menu navigation, and stops for gameplay, pause, hidden pages and the gate', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await expectMusic(page, false);
  await enterMenu(page);
  await expectMusic(page, true);
  await expect.poll(async () => (await playingTracks(page))[0]?.currentTime ?? 0).toBeGreaterThan(0.05);
  await expect.poll(async () => Number.isFinite((await playingTracks(page))[0]?.duration)).toBe(true);
  const original = (await playingTracks(page))[0];
  await page.screenshot({ path: testInfo.outputPath('audio-menu.png') });

  // Seek near the end to verify an actual wrap rather than waiting for the whole song.
  await page.evaluate(() => (window as Window & { __AUDIO_SEEK_END__?: () => void }).__AUDIO_SEEK_END__!());
  await expect.poll(async () => (await playingTracks(page))[0]?.currentTime ?? original.duration).toBeLessThan(original.duration - 0.5);
  await expectMusic(page, true);

  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expectMusic(page, true);
  expect((await playingTracks(page))[0].id).toBe(original.id);
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to menu', exact: true })).toBeVisible();
  await expectMusic(page, true);
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();

  await enterPractice(page);
  await expectMusic(page, false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expectMusic(page, false);
  await page.screenshot({ path: testInfo.outputPath('audio-pause.png') });
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await expectMusic(page, true);
  expect((await playingTracks(page))[0].id).toBe(original.id);

  await setPageHidden(page, true);
  await expectMusic(page, false);
  await setPageHidden(page, false);
  await expectMusic(page, true);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  await expectMusic(page, false);
  await enterMenu(page);
  await expectMusic(page, true);
  expect(errors).toEqual([]);
});

test('menu and pause buttons sound on hover, click and keyboard navigation without child duplicates', async ({ page }) => {
  await openMenu(page);
  await expectMusic(page, true);
  const arena = page.getByRole('radio', { name: 'Outpost', exact: true });
  await page.mouse.move(20, 20);
  await page.waitForTimeout(100);
  const beforeArenaHover = await toneCount(page);
  await arena.hover();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(beforeArenaHover);
  const beforeArenaClick = await toneCount(page);
  await arena.check();
  await expect.poll(() => toneCount(page)).toBe(beforeArenaClick + 1);
  const launch = page.getByRole('button', { name: 'Enter practice', exact: true });
  await page.mouse.move(20, 20);
  await page.waitForTimeout(100);
  let before = await toneCount(page);
  await launch.locator(':scope > span').hover();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  before = await toneCount(page);
  // Longer than hover debouncing: a nested SVG transition still must remain silent.
  await page.waitForTimeout(100);
  await launch.locator('svg').hover();
  expect(await toneCount(page)).toBe(before);
  await page.getByRole('button', { name: 'Multiplayer', exact: true }).hover();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  before = await toneCount(page);

  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Customize', exact: true }).hover();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  before = await toneCount(page);
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await expect.poll(() => toneCount(page)).toBe(before + 1);
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await launch.focus();
  await page.waitForTimeout(100);
  before = await toneCount(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Multiplayer', exact: true })).toBeFocused();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  before = await toneCount(page);
  await page.waitForTimeout(100);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeFocused();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  before = await toneCount(page);
  await page.keyboard.press('Enter');
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();

  await enterPractice(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.mouse.move(20, 20);
  await page.waitForTimeout(100);
  before = await toneCount(page);
  await page.getByRole('button', { name: 'Restart practice', exact: true }).hover();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Settings', exact: true }).hover();
  before = await toneCount(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  await expectMusic(page, false);
  await page.getByRole('button', { name: 'Back to pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Resume', exact: true }).focus();
  before = await toneCount(page);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__BURNHOP__?.metrics().running);
  await expect.poll(() => toneCount(page)).toBeGreaterThan(before);
  await expectMusic(page, false);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(page.getByTestId('fullscreen-gate')).toBeVisible();
  before = await toneCount(page);
  // The retained pause panel sits behind an inert fullscreen gate.
  await page.getByRole('button', { name: 'Resume', exact: true, includeHidden: true }).evaluate(button => {
    button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(await toneCount(page)).toBe(before);
});

test('the saved sound toggle mutes music and menu feedback and remains muted after reload', async ({ page }) => {
  await openMenu(page);
  await expectMusic(page, true);
  await page.getByRole('button', { name: 'Sound: on', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sound: off', exact: true })).toBeVisible();
  await expectMusic(page, false);
  const before = await toneCount(page);
  await page.getByRole('button', { name: 'Customize', exact: true }).hover();
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  expect(await toneCount(page)).toBe(before);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).muted, SETTINGS_STORAGE_KEY)).toBe(true);

  await page.reload();
  await enterMenu(page);
  await expect(page.getByRole('button', { name: 'Sound: off', exact: true })).toBeVisible();
  await expectMusic(page, false);
  const mutedTones = await toneCount(page);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Audio' }).click();
  await expect(page.getByRole('checkbox', { name: 'Master sound', exact: true })).not.toBeChecked();
  expect(await toneCount(page)).toBe(mutedTones);
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Sound: off', exact: true }).click();
  await expectMusic(page, true);
  const afterUnmute = await toneCount(page);
  await page.getByRole('button', { name: 'Customize', exact: true }).hover();
  await expect.poll(() => toneCount(page)).toBeGreaterThan(afterUnmute);
});

test('audio sliders change the live music mix, silence channels independently, and survive reload', async ({ page }) => {
  await openMenu(page);
  await expectMusic(page, true);
  const original = (await playingTracks(page))[0];
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Audio' }).click();
  const music = page.getByRole('slider', { name: 'Menu music volume', exact: true });
  await expect(music).toHaveValue('10');
  await music.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(music).toHaveValue('12');
  await expect.poll(async () => (await playingTracks(page))[0]?.volume).toBeCloseTo(0.12);
  expect((await playingTracks(page))[0].id).toBe(original.id);

  const master = page.getByRole('slider', { name: 'Master volume', exact: true });
  await master.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await playingTracks(page))[0]?.volume).toBeCloseTo(0.1188);
  await master.press('Home');
  await expect.poll(async () => (await playingTracks(page)).length).toBe(0);
  await master.press('End');
  await expect.poll(async () => (await playingTracks(page))[0]?.volume).toBeCloseTo(0.12);

  await page.getByRole('slider', { name: 'Menu effects volume', exact: true }).press('Home');
  const quiet = await toneCount(page);
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Customize', exact: true }).hover();
  expect(await toneCount(page)).toBe(quiet);
  await expect.poll(async () => (await playingTracks(page))[0]?.volume).toBeCloseTo(0.12);

  await page.reload();
  await enterMenu(page);
  await expect.poll(async () => (await playingTracks(page))[0]?.volume).toBeCloseTo(0.12);
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Audio' }).click();
  await expect(music).toHaveValue('12');
  await expect(page.getByRole('slider', { name: 'Menu effects volume', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Reset audio to defaults', exact: true }).click();
  await expectMusic(page, true);
  await expect(music).toHaveValue('10');
});
