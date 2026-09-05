import { expect, test, type Page } from '@playwright/test';
import { SETTINGS_STORAGE_KEY, type Settings } from '../src/game/settings';
import { enterMenu, enterPractice, installCapture, openMenu } from './helpers/capture';

interface SoundStart {
  id: number;
  sample: string;
  loop: boolean;
  stopped: boolean;
  ended: boolean;
  tick: number;
  grounded: boolean;
  vx: number;
  reloadTicks: number;
}
interface GameplayAudioSnapshot { decoded: string[]; starts: SoundStart[] }
type ObservedWindow = Window & { __GAMEPLAY_AUDIO__?: () => GameplayAudioSnapshot };
const FOOTSTEP = /^footstep-\d\.wav$/;
const RIFLE = /^rifle-\d\.wav$/;
const RELOAD = /^reload-(remove|insert|rack)\.wav$/;
const SAMPLES = [
  'rifle-1.wav', 'rifle-2.wav', 'rifle-3.wav',
  'footstep-1.wav', 'footstep-2.wav', 'footstep-3.wav', 'footstep-4.wav',
  'land.wav', 'impact-metal.wav', 'reload-remove.wav', 'reload-insert.wav', 'reload-rack.wav',
];

/** Record actual decoded clips and native source starts; playback stays intact. */
async function observeGameplayAudio(page: Page) {
  await page.addInitScript(() => {
    const inputs = new WeakMap<ArrayBuffer, string>();
    const buffers = new WeakMap<AudioBuffer, string>();
    const decoded = new Set<string>();
    const starts: SoundStart[] = [];
    const fetchResource = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetchResource(...args);
      const sample = response.url.match(/\/assets\/audio\/sfx\/([^/?]+)(?:\?.*)?$/)?.[1];
      if (sample) {
        const arrayBuffer = response.arrayBuffer.bind(response);
        response.arrayBuffer = async () => {
          const data = await arrayBuffer();
          inputs.set(data, sample);
          return data;
        };
      }
      return response;
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (data, success, failure) {
      const sample = inputs.get(data);
      const record = (buffer: AudioBuffer) => {
        if (sample) { buffers.set(buffer, sample); decoded.add(sample); }
        return buffer;
      };
      return decode.call(this, data, buffer => { record(buffer); success?.(buffer); }, failure).then(record);
    };
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this);
      const start = source.start.bind(source), stop = source.stop.bind(source);
      let observed: SoundStart | undefined;
      source.start = (...args) => {
        const state = window.__BURNHOP__?.snapshot();
        observed = {
          id: starts.length, sample: source.buffer ? buffers.get(source.buffer) ?? 'procedural' : 'empty',
          loop: source.loop, stopped: false, ended: false, tick: state?.tick ?? -1,
          grounded: state?.player.grounded ?? false, vx: state?.player.vx ?? 0,
          reloadTicks: state?.player.weapon.reloadTicks ?? -1,
        };
        starts.push(observed);
        start(...args);
      };
      source.stop = (...args) => { if (observed) observed.stopped = true; stop(...args); };
      source.addEventListener('ended', () => { if (observed) observed.ended = true; });
      return source;
    };
    (window as ObservedWindow).__GAMEPLAY_AUDIO__ = () => ({ decoded: [...decoded], starts: starts.map(start => ({ ...start })) });
  });
}

async function audio(page: Page): Promise<GameplayAudioSnapshot> {
  return page.evaluate(() => (window as ObservedWindow).__GAMEPLAY_AUDIO__!());
}
async function sounds(page: Page, sample: RegExp) {
  return (await audio(page)).starts.filter(start => !start.loop && sample.test(start.sample));
}
async function ticks(page: Page, count: number) {
  const target = await page.evaluate(count => window.__BURNHOP__!.snapshot().tick + count, count);
  await page.waitForFunction(target => window.__BURNHOP__!.snapshot().tick >= target, target);
}
async function readyPractice(page: Page) {
  await openMenu(page);
  await enterPractice(page);
  await expect.poll(async () => (await audio(page)).decoded.sort()).toEqual([...SAMPLES].sort());
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.grounded);
  await ticks(page, 5);
}
async function fire(page: Page) {
  const before = await page.evaluate(() => window.__BURNHOP__!.snapshot().shotsFired);
  const canvas = page.getByTestId('game-canvas');
  await canvas.hover();
  await page.mouse.down();
  await page.waitForFunction(before => window.__BURNHOP__!.snapshot().shotsFired > before, before);
  await page.mouse.up();
}
async function pauseAudioSettings(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Audio' }).click();
}
async function resumeFromSettings(page: Page) {
  await page.getByRole('button', { name: 'Back to pause', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__!.metrics().running);
}
async function saved(page: Page): Promise<Settings> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SETTINGS_STORAGE_KEY);
}

test.beforeEach(async ({ page }) => {
  await installCapture(page);
  await observeGameplayAudio(page);
});

test('recorded footsteps follow grounded travel and stay quiet at rest and in the air', async ({ page }) => {
  await readyPractice(page);
  const idle = (await sounds(page, FOOTSTEP)).length;
  await ticks(page, 24);
  expect((await sounds(page, FOOTSTEP)).length).toBe(idle);
  await page.keyboard.down('KeyD');
  await ticks(page, 45);
  await page.keyboard.up('KeyD');
  await ticks(page, 12);
  const walked = await sounds(page, FOOTSTEP);
  expect(walked.length).toBeGreaterThan(idle + 1);
  expect(walked.every(start => start.grounded && Math.abs(start.vx) > 0)).toBe(true);
  const stopped = walked.length;
  await ticks(page, 30);
  expect((await sounds(page, FOOTSTEP)).length).toBe(stopped);

  const landings = (await sounds(page, /^land\.wav$/)).length;
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.__BURNHOP__!.snapshot().player.grounded);
  const airborne = (await sounds(page, FOOTSTEP)).length;
  await page.keyboard.down('KeyD');
  await ticks(page, 18);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.grounded)).toBe(false);
  expect((await sounds(page, FOOTSTEP)).length).toBe(airborne);
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.grounded);
  await expect.poll(async () => (await sounds(page, /^land\.wav$/)).length).toBe(landings + 1);
  expect((await sounds(page, /^land\.wav$/)).at(-1)?.grounded).toBe(true);
  // The jump's initial push-off uses one footstep clip; only subsequent steps
  // must come from grounded contacts, never repeated movement while airborne.
  expect((await sounds(page, FOOTSTEP)).slice(airborne).every(start => start.grounded)).toBe(true);
});

test('gunfire plays recorded shots and reload sounds follow the simulation through pause and resume', async ({ page }) => {
  await readyPractice(page);
  await fire(page);
  expect((await sounds(page, RIFLE)).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.weapon.ammo)).toBeLessThan(30);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => (window as ObservedWindow).__GAMEPLAY_AUDIO__!().starts.some(start => start.sample === 'reload-remove.wav'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  const paused = await page.evaluate(() => window.__BURNHOP__!.snapshot());
  expect(paused.player.weapon.reloadTicks).toBeGreaterThan(0);
  const beforeResume = await sounds(page, RELOAD);
  expect(beforeResume.some(start => start.sample === 'reload-remove.wav')).toBe(true);
  expect(beforeResume.some(start => start.sample === 'reload-insert.wav')).toBe(false);
  expect(beforeResume.every(start => start.stopped || start.ended)).toBe(true);
  // Longer than the entire remaining reload: paused audio must not use wall-clock timers.
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot())).toEqual(paused);
  expect((await sounds(page, RELOAD)).map(start => start.id)).toEqual(beforeResume.map(start => start.id));
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.ammo === 30);
  const finished = await sounds(page, RELOAD);
  const stages = [...new Set(finished.map(start => start.sample))];
  expect(stages).toEqual(['reload-remove.wav', 'reload-insert.wav', 'reload-rack.wav']);
  expect(finished.filter(start => start.sample === 'reload-remove.wav').map(start => start.id))
    .toEqual(beforeResume.filter(start => start.sample === 'reload-remove.wav').map(start => start.id));
  expect(finished.filter(start => start.sample !== 'reload-remove.wav').every(start => start.tick > paused.tick)).toBe(true);
  await ticks(page, 24);
  expect((await sounds(page, RELOAD)).map(start => start.id)).toEqual(finished.map(start => start.id));
  expect(await page.evaluate(() => window.__BURNHOP__!.snapshot().player.weapon)).toMatchObject({ ammo: 30, reloadTicks: 0 });
});

test('pause audio levels mute gameplay categories independently and persist through menu and reload', async ({ page }) => {
  await readyPractice(page);
  await pauseAudioSettings(page);
  await page.getByRole('slider', { name: 'Master volume', exact: true }).fill('65');
  await page.getByRole('slider', { name: 'Menu music volume', exact: true }).fill('7');
  await page.getByRole('slider', { name: 'Weapons & reload volume', exact: true }).fill('0');
  await page.getByRole('slider', { name: 'Movement & jetpack volume', exact: true }).fill('0');
  const selected = (await saved(page)).audio;
  expect(selected).toMatchObject({ masterVolume: 0.65, musicVolume: 0.07, weaponsVolume: 0, movementVolume: 0 });
  await resumeFromSettings(page);
  const quietWeapons = (await sounds(page, /^(rifle-|reload-)/)).length;
  const quietMovement = (await sounds(page, /^(footstep-|land\.wav)/)).length;
  await fire(page);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__BURNHOP__!.snapshot().player.weapon.ammo === 30);
  await page.keyboard.down('KeyD');
  await ticks(page, 35);
  await page.keyboard.up('KeyD');
  await ticks(page, 12);
  expect((await sounds(page, /^(rifle-|reload-)/)).length).toBe(quietWeapons);
  expect((await sounds(page, /^(footstep-|land\.wav)/)).length).toBe(quietMovement);

  await pauseAudioSettings(page);
  await page.getByRole('slider', { name: 'Weapons & reload volume', exact: true }).fill('80');
  await resumeFromSettings(page);
  await fire(page);
  expect((await sounds(page, RIFLE)).length).toBeGreaterThan(quietWeapons);
  await page.keyboard.down('KeyD');
  await ticks(page, 28);
  await page.keyboard.up('KeyD');
  await ticks(page, 12);
  expect((await sounds(page, /^(footstep-|land\.wav)/)).length).toBe(quietMovement);

  await pauseAudioSettings(page);
  await page.getByRole('slider', { name: 'Weapons & reload volume', exact: true }).fill('0');
  await page.getByRole('slider', { name: 'Movement & jetpack volume', exact: true }).fill('85');
  await resumeFromSettings(page);
  const noMoreShots = (await sounds(page, RIFLE)).length;
  await fire(page);
  expect((await sounds(page, RIFLE)).length).toBe(noMoreShots);
  await page.keyboard.down('KeyA');
  await ticks(page, 30);
  await page.keyboard.up('KeyA');
  await ticks(page, 12);
  expect((await sounds(page, FOOTSTEP)).length).toBeGreaterThan(quietMovement);
  const finalMix = (await saved(page)).audio;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Settings & Controls', exact: true }).click();
  await page.getByRole('tab', { name: 'Audio' }).click();
  await expect(page.getByRole('slider', { name: 'Weapons & reload volume', exact: true })).toHaveValue('0');
  await expect(page.getByRole('slider', { name: 'Movement & jetpack volume', exact: true })).toHaveValue('85');
  expect((await saved(page)).audio).toEqual(finalMix);
  await page.reload();
  await enterMenu(page);
  expect((await saved(page)).audio).toEqual(finalMix);
});
