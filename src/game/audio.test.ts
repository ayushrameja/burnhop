import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameAudio, type MovementAudioState } from './audio';
import { defaultAudioSettings } from './audioSettings';
import { createSyntheticBuffer, WEAPON_SOUND_IDS } from './audioSynthesis';
import { createWeapon, WEAPONS } from './weapons';
import type { GameEvent } from './types';

class Param {
  value = 0;
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
  cancelScheduledValues = vi.fn();
}
class Node {
  connections: Node[] = [];
  connect = vi.fn((node: Node) => { this.connections.push(node); return node; });
  disconnect = vi.fn();
}
class Gain extends Node { gain = new Param(); }
class Filter extends Node { type = ''; frequency = new Param(); Q = new Param(); }
class Compressor extends Node {
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
}
class Buffer {
  data: Float32Array;
  constructor(readonly length: number, readonly sampleRate: number, readonly label = 'synthesized') { this.data = new Float32Array(length); }
  get duration() { return this.length / this.sampleRate; }
  getChannelData() { return this.data; }
}
class Source extends Node {
  buffer: Buffer | null = null;
  playbackRate = new Param();
  loop = false;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
const contexts: Context[] = [];
class Context {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 22050;
  destination = new Node();
  sources: Source[] = [];
  gains: Gain[] = [];
  compressor = new Compressor();
  resume = vi.fn(() => { this.state = 'running'; return Promise.resolve(); });
  close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createDynamicsCompressor() { return this.compressor; }
  createBiquadFilter() { return new Filter(); }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  createBuffer(_channels: number, length: number, sampleRate: number) { return new Buffer(length, sampleRate); }
  decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => new Buffer(4000, this.sampleRate, new TextDecoder().decode(bytes)));
  constructor() { contexts.push(this); }
}
const shot: Extract<GameEvent, { type: 'shot' }> = { type: 'shot', x: 0, y: 0, toX: 1, toY: 0, hit: false,
  weaponId: 'pistol', hand: 'main', instanceId: 'test:pistol', shotCounter: 1,
  originX: 0, originY: 0, directionX: 1, directionY: 0, range: 1000, distance: 1 };
const standing: MovementAudioState = { x: 0, y: 0, grounded: true, vx: 0, vy: 0, crouchAmount: 0 };
const fetchSample = vi.fn(async (url: string) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer }));
const labels = (context: Context) => context.sources.map(source => source.buffer?.label.split('/').at(-1));
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function sourceGain(source: Source) { return (source.connections[0] as Gain).gain.value; }

const rms = (samples: ArrayLike<number>) => Math.sqrt(Array.from(samples).reduce((sum, value) => sum + value * value, 0) / samples.length);

/** A repeated 40–140 Hz pressure oscillation is the unwanted rubbery sound.
 * Check waveform periodicity, independent of the synthesis implementation.
 */
function lowPeriodicity(samples: Float32Array, rate: number) {
  const start = Math.round(rate * 0.008), end = Math.min(samples.length, Math.round(rate * 0.1));
  let strongest = 0;
  for (let lag = Math.round(rate * 0.007); lag < rate * 0.025; lag += 2) {
    let product = 0, firstEnergy = 0, secondEnergy = 0;
    for (let i = start; i < end - lag; i++) {
      product += samples[i] * samples[i + lag];
      firstEnergy += samples[i] ** 2; secondEnergy += samples[i + lag] ** 2;
    }
    strongest = Math.max(strongest, Math.abs(product) / Math.max(1e-12, Math.sqrt(firstEnergy * secondEnergy)));
  }
  return strongest;
}

describe('landing cue signal quality', () => {
  it('ships a short mono PCM boot impact with headroom, a quiet tail and no low ringing', () => {
    const bytes = readFileSync(new URL('../../public/assets/audio/sfx/land.wav', import.meta.url));
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    let rate = 0, samples = new Float32Array();
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(offset + 4), chunk = bytes.toString('ascii', offset, offset + 4);
      if (chunk === 'fmt ') {
        expect(bytes.readUInt16LE(offset + 8)).toBe(1); // PCM
        expect(bytes.readUInt16LE(offset + 10)).toBe(1); // Mono
        rate = bytes.readUInt32LE(offset + 12);
        expect(bytes.readUInt16LE(offset + 22)).toBe(16);
      }
      if (chunk === 'data') {
        samples = Float32Array.from({ length: size / 2 }, (_, i) => bytes.readInt16LE(offset + 8 + i * 2) / 32768);
      }
      offset += 8 + size + size % 2;
    }
    expect(rate).toBe(44100);
    expect(samples.length / rate).toBeGreaterThan(0.14);
    expect(samples.length / rate).toBeLessThan(0.2);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.81);
    expect(rms(samples)).toBeGreaterThan(0.07);
    expect(rms(samples.subarray(-Math.round(rate * 0.02)))).toBeLessThan(0.002);
    expect(lowPeriodicity(samples, rate)).toBeLessThan(0.45);
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(0);
  });

  it('keeps the offline landing broadband and quickly damped at common device sample rates', () => {
    for (const sampleRate of [22050, 44100, 48000]) {
      const context = {
        sampleRate,
        createBuffer: (_channels: number, length: number, rate: number) => new Buffer(length, rate),
      } as unknown as AudioContext;
      const samples = createSyntheticBuffer(context, 'land').getChannelData(0);
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(rms(samples.subarray(0, Math.round(sampleRate * 0.06)))).toBeGreaterThan(0.04);
      expect(rms(samples.subarray(-Math.round(sampleRate * 0.04)))).toBeLessThan(0.003);
      expect(lowPeriodicity(samples, sampleRate)).toBeLessThan(0.35);
      expect(Math.max(...samples.map(Math.abs))).toBeLessThan(0.95);
    }
  });
});

describe('gameplay sound lifecycle and simulation timing', () => {
  let audio: GameAudio;
  beforeEach(() => {
    contexts.length = 0;
    fetchSample.mockClear();
    vi.stubGlobal('AudioContext', Context);
    vi.stubGlobal('fetch', fetchSample);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    audio = new GameAudio();
  });
  afterEach(() => { audio.destroy(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('unlocks lazily, preloads once, and routes original gunshots through controlled category gain', async () => {
    audio.play([shot]);
    audio.setThrust(true);
    expect(contexts).toHaveLength(0);
    await audio.unlock();
    await settle();
    await audio.unlock();
    const context = contexts[0];
    expect(fetchSample).toHaveBeenCalledTimes(12);
    expect(context.sources).toHaveLength(0);
    audio.play([shot, shot, shot, shot]);
    expect(labels(context)).toEqual(['synthesized', 'synthesized', 'synthesized', 'synthesized']);
    expect(context.sources.every(source => source.playbackRate.value === 1 && sourceGain(source) === 0.72)).toBe(true);
    expect(context.gains.slice(0, 3).map(gain => gain.gain.value)).toEqual([1, 0.8, 0.85]);
    expect(context.compressor.ratio.value).toBe(12);
    expect(context.compressor.threshold.value).toBe(-6);
  });

  it('uses actual grounded distance: no footsteps at a wall or in air, with crouch quieter and slower', async () => {
    await audio.unlock(); await settle();
    const context = contexts[0];
    audio.updateMovement(standing);
    for (let i = 0; i < 30; i++) audio.updateMovement({ ...standing, vx: 320 });
    expect(context.sources).toHaveLength(0);
    for (let x = 5; x <= 65; x += 5) audio.updateMovement({ ...standing, x, vx: 320 });
    expect(context.sources).toHaveLength(0);
    audio.updateMovement({ ...standing, x: 70, vx: 320 });
    expect(labels(context)).toEqual(['footstep-1.wav']);
    const walkVolume = sourceGain(context.sources[0]);
    for (let x = 75; x <= 140; x += 5) audio.updateMovement({ ...standing, x, vx: 160, crouchAmount: 1 });
    expect(labels(context)).toEqual(['footstep-1.wav', 'footstep-2.wav']);
    expect(sourceGain(context.sources[1])).toBeLessThan(walkVolume);
    for (let x = 145; x <= 300; x += 5) audio.updateMovement({ ...standing, x, y: -20, grounded: false, vy: -100 });
    expect(context.sources).toHaveLength(2);
  });

  it('scales boot impact volume with fall speed without pitch shifting or adding duplicate footfalls', async () => {
    await audio.unlock(); await settle();
    const context = contexts[0];
    audio.updateMovement({ ...standing, grounded: false, y: -10, vy: 100 });
    audio.play([{ type: 'land', x: 0, y: 0 }]);
    audio.updateMovement(standing);
    audio.updateMovement({ ...standing, grounded: false, y: -10, vy: 650 });
    audio.updateMovement(standing);
    expect(labels(context)).toEqual(['land.wav', 'land.wav']);
    expect(sourceGain(context.sources[1])).toBeGreaterThan(sourceGain(context.sources[0]) * 2);
    expect(context.sources.every(source => source.playbackRate.value === 1)).toBe(true);
    expect(context.sources.every(source => (source.connections[0] as Gain).connections[0] === context.gains[2])).toBe(true);
    for (let i = 0; i < 30; i++) audio.updateMovement(standing);
    expect(context.sources).toHaveLength(2);
    for (let x = 5; x <= 70; x += 5) audio.updateMovement({ ...standing, x, vx: 320 });
    expect(labels(context).at(-1)).toBe('footstep-1.wav');
  });

  it('keeps the landing fallback dry at the same natural pitch when the recording cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    await audio.unlock(); await settle();
    const context = contexts[0];
    audio.updateMovement({ ...standing, grounded: false, y: -12, vy: 700 });
    audio.updateMovement(standing);
    expect(labels(context)).toEqual(['synthesized']);
    expect(context.sources[0].buffer!.duration).toBeCloseTo(0.17, 3);
    expect(context.sources[0].playbackRate.value).toBe(1);
    audio.pause();
    expect(context.sources[0].stop).toHaveBeenCalledTimes(1);
    await audio.unlock();
    audio.updateMovement(standing);
    expect(context.sources).toHaveLength(1);
  });

  it('plays each reload stage once on crossings and resumes after pause without replaying stages', async () => {
    await audio.unlock(); await settle();
    const context = contexts[0];
    for (const progress of [0, 0.19, 0.2, 0.2, 0.4]) audio.updateReload(progress);
    expect(labels(context)).toEqual(['reload-remove.wav']);
    audio.pause();
    expect(context.sources[0].stop).toHaveBeenCalledTimes(1);
    audio.updateReload(0.8);
    audio.play([shot]);
    expect(context.sources).toHaveLength(1);
    await audio.unlock();
    for (const progress of [0.4, 0.55, 0.55, 0.81, 0.82, 1]) audio.updateReload(progress);
    expect(labels(context)).toEqual(['reload-remove.wav', 'reload-insert.wav', 'reload-rack.wav']);
    audio.pause();
    audio.updateReload(-1); // Reset remains legal while paused.
    await audio.unlock();
    audio.updateReload(0); audio.updateReload(0.2);
    expect(labels(context).at(-1)).toBe('reload-remove.wav');
    expect(context.sources).toHaveLength(4);
  });

  it('applies zero-volume and mute immediately without queuing missed effects for unmute', async () => {
    await audio.unlock(); await settle();
    const context = contexts[0];
    audio.setVolumes({ ...defaultAudioSettings(), weaponsVolume: 0 });
    audio.play([shot]);
    audio.updateReload(0.55);
    audio.play([{ type: 'jump', x: 0, y: 0 }]);
    expect(labels(context)).toEqual(['footstep-1.wav']);
    audio.setVolumes({ ...defaultAudioSettings(), movementVolume: 0 });
    audio.updateReload(0.55);
    audio.play([{ type: 'jump', x: 0, y: 0 }]);
    audio.setThrust(true);
    audio.play([shot]);
    expect(context.sources).toHaveLength(2);
    expect(labels(context).at(-1)).toBe('synthesized');
    audio.setMuted(true);
    expect(context.gains[0].gain.value).toBe(0);
    audio.updateReload(0.82);
    audio.play([shot]);
    audio.setMuted(false);
    audio.updateReload(0.82);
    expect(context.sources).toHaveLength(2);
    expect(context.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
    audio.setVolumes({ ...defaultAudioSettings(), masterVolume: 0 });
    audio.play([shot]);
    expect(context.sources).toHaveLength(2);
  });

  it('keeps a single jet loop, stops every source on pause, and reanchors travel on resume', async () => {
    await audio.unlock(); await settle();
    const context = contexts[0];
    audio.setThrust(true); audio.setThrust(true); audio.setThrust(true);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].loop).toBe(true);
    audio.play([shot]);
    audio.updateMovement(standing);
    audio.updateMovement({ ...standing, x: 40 });
    audio.pause();
    expect(context.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
    expect(context.gains[0].gain.value).toBe(0);
    audio.setThrust(true);
    expect(context.sources).toHaveLength(2);
    await audio.unlock();
    audio.updateMovement({ ...standing, x: 500 });
    audio.updateMovement({ ...standing, x: 530 });
    expect(context.sources).toHaveLength(2);
    audio.setThrust(true);
    expect(context.sources).toHaveLength(3);
  });

  it('uses finite, short non-silent local fallbacks when samples fail and bounds voice count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    await audio.unlock(); await settle();
    const context = contexts[0];
    for (let i = 0; i < 40; i++) audio.play([shot]);
    expect(context.sources).toHaveLength(40);
    expect(context.sources.filter(source => source.stop.mock.calls.length > 0)).toHaveLength(16);
    const buffer = context.sources[0].buffer!;
    expect(buffer.label).toBe('synthesized');
    expect(buffer.duration).toBeCloseTo(0.19, 3);
    expect(buffer.data.every(Number.isFinite)).toBe(true);
    expect(buffer.data.some(sample => Math.abs(sample) > 0.1)).toBe(true);
    const jet = createSyntheticBuffer(context as unknown as AudioContext, 'jet').getChannelData(0);
    expect(Math.abs(jet[0] - jet[jet.length - 1])).toBeLessThan(0.4);
  });

  it('aborts pending sample loads, closes once and never creates sources after destruction', async () => {
    const finishes: ((value: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void)[] = [];
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise(resolve => {
      signals.push(options.signal!); finishes.push(resolve);
    })));
    await audio.unlock();
    const context = contexts[0];
    audio.destroy(); audio.destroy();
    expect(signals).toHaveLength(12);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    finishes.forEach(finish => finish({ ok: true, arrayBuffer: async () => new TextEncoder().encode('late.wav').buffer }));
    await settle();
    await audio.unlock(); audio.play([shot]); audio.setThrust(true); audio.updateReload(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(0);
    expect(contexts).toHaveLength(1);
  });

  it('gives every weapon a distinct deterministic waveform with a quiet finite tail', () => {
    const context = new Context() as unknown as AudioContext;
    const signatures = new Set<string>();
    for (const weapon of WEAPON_SOUND_IDS) {
      const buffer = createSyntheticBuffer(context, `shot-${weapon}`), samples = buffer.getChannelData(0);
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(rms(samples)).toBeGreaterThan(.035);
      expect(rms(samples.subarray(-220))).toBeLessThan(.015);
      expect(Array.from(samples)).toEqual(Array.from(createSyntheticBuffer(context, `shot-${weapon}`).getChannelData(0)));
      signatures.add(`${samples.length}:${samples[120]}:${samples[410]}`);
    }
    expect(signatures.size).toBe(7);
  });

  it('reserves local cue capacity under remote automatic fire and never steals a kill cue for distant shots', async () => {
    await audio.unlock(); await settle();
    const context = contexts[0];
    audio.playKillConfirmation();
    const kill = context.sources[0];
    for (let i = 0; i < 40; i++) audio.updateActor('remote', { ...standing, x: 400 }, -1, false, [shot], standing);
    expect(audio.getDiagnostics()).toMatchObject({ voices: 21, remoteVoices: 20 });
    expect(kill.stop).not.toHaveBeenCalled();
    audio.play([shot]); audio.playPickup(true); audio.playDropWarning(); audio.play([shot]);
    expect(audio.getDiagnostics().voices).toBe(24);
    expect(kill.stop).not.toHaveBeenCalled();
    audio.pause(); expect(audio.getDiagnostics().voices).toBe(0);
  });

  it('pans remote sources toward their world position and leaves local feedback centered', async () => {
    class Panner extends Node { pan = new Param(); }
    class StereoContext extends Context { panners: Panner[] = [];
      createStereoPanner() { const panner = new Panner(); this.panners.push(panner); return panner; }
    }
    vi.stubGlobal('AudioContext', StereoContext);
    await audio.unlock(); await settle();
    const context = contexts[0] as StereoContext;
    audio.updateActor('left', { ...standing, x: -400 }, -1, false, [shot], standing);
    audio.updateActor('right', { ...standing, x: 400 }, -1, false, [shot], standing);
    audio.playKillConfirmation();
    expect(context.panners.map(panner => panner.pan.value)).toEqual([-.5, .5, 0]);
  });

  it('keeps heartbeat quiet at normal health and stops immediately on recovery, disable or pause', async () => {
    await audio.unlock(); const context = contexts[0];
    audio.setHeartbeat(true, 26); expect(context.sources).toHaveLength(0);
    audio.setHeartbeat(true, 25); expect(context.sources).toHaveLength(1);
    context.currentTime = .8; audio.setHeartbeat(true, 29); expect(context.sources).toHaveLength(1);
    context.currentTime = 1; audio.setHeartbeat(true, 30); expect(context.sources).toHaveLength(2);
    audio.setHeartbeat(true, 31);
    expect(audio.getDiagnostics()).toMatchObject({ heartbeat: false, voices: 0 });
    audio.setHeartbeat(false, 10); expect(context.sources).toHaveLength(2);
    audio.setHeartbeat(true, 10); expect(context.sources).toHaveLength(3);
    audio.pause(); audio.setHeartbeat(true, 10);
    expect(audio.getDiagnostics()).toMatchObject({ heartbeat: false, voices: 0 });
  });

  it('tracks dual reload cues independently and skips history when joining an in-progress reload', async () => {
    await audio.unlock(); await settle(); const context = contexts[0];
    const main = createWeapon('pistol', 'main'), offhand = createWeapon('uzi', 'offhand');
    main.reloadTicks = WEAPONS.pistol.reloadTicks; offhand.reloadTicks = 0;
    audio.updateWeaponReloads('me', main, offhand);
    main.reloadTicks = Math.floor(WEAPONS.pistol.reloadTicks * .75); audio.updateWeaponReloads('me', main, offhand);
    expect(context.sources).toHaveLength(1);
    audio.updateWeaponReloads('me', main, offhand); expect(context.sources).toHaveLength(1);
    main.reloadTicks = 0; offhand.reloadTicks = Math.floor(WEAPONS.uzi.reloadTicks * .75);
    audio.updateWeaponReloads('me', main, offhand); expect(context.sources).toHaveLength(2);
    expect(context.sources[0].buffer?.data[120]).not.toBe(context.sources[1].buffer?.data[120]);
    const remote = createWeapon('sniper', 'already-reloading'); remote.reloadTicks = 30;
    audio.updateWeaponReloads('new-player', remote); expect(context.sources).toHaveLength(2);
  });

  it('does not restart voices when a pending context resume completes after pause', async () => {
    let finish!: () => void;
    class DelayedContext extends Context {
      override resume = vi.fn(() => new Promise<void>(resolve => { finish = () => { this.state = 'running'; resolve(); }; }));
    }
    vi.stubGlobal('AudioContext', DelayedContext);
    const unlocked = audio.unlock();
    audio.pause();
    finish();
    await unlocked;
    const context = contexts[0];
    audio.play([shot]); audio.setThrust(true); audio.updateReload(0.55);
    expect(context.sources).toHaveLength(0);
    expect(context.gains[0].gain.value).toBe(0);
    await audio.unlock();
    audio.play([shot]);
    expect(context.sources).toHaveLength(1);
  });
});
