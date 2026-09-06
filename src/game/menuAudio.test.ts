import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAudioSettings } from './audioSettings';
import { MenuAudio } from './menuAudio';
import { createDanceBuffer, DANCE_BEATS, DANCE_BPM } from './audioSynthesis';

const media: FakeAudio[] = [];
const contexts: FakeContext[] = [];

class FakeAudio {
  loop = false;
  volume = 1;
  preload = '';
  muted = false;
  paused = true;
  currentTime = 0;
  play = vi.fn((): Promise<void> => { this.paused = false; return Promise.resolve(); });
  pause = vi.fn(() => { this.paused = true; });
  removeAttribute = vi.fn();
  load = vi.fn();
  constructor(readonly src: string) { media.push(this); }
}

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeGain {
  gain = new FakeParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeOscillator {
  type = 'sine';
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  resume = vi.fn((): Promise<void> => { this.state = 'running'; return Promise.resolve(); });
  close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
  createGain = vi.fn(() => { const gain = new FakeGain(); this.gains.push(gain); return gain; });
  createOscillator = vi.fn(() => {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  });
  constructor() { contexts.push(this); }
}

class DanceContext extends FakeContext {
  sampleRate = 22050;
  buffers: AudioBuffer[] = [];
  sources: { buffer: AudioBuffer | null; loop: boolean; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    const buffer = { duration: length / sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
    this.buffers.push(buffer); return buffer;
  }
  createBufferSource() {
    const source = { buffer: null as AudioBuffer | null, loop: false, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(source); return source;
  }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

describe('menu audio lifecycle', () => {
  let audio: MenuAudio;
  beforeEach(() => {
    media.length = 0;
    contexts.length = 0;
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('AudioContext', FakeContext);
    audio = new MenuAudio();
  });
  afterEach(() => { audio.destroy(); vi.unstubAllGlobals(); });

  it('creates browser audio only after unlock and starts one quiet, looping music player', async () => {
    audio.setMusicActive(true);
    audio.setMuted(true);
    audio.setMuted(false);
    audio.setVisible(false);
    audio.setVisible(true);
    audio.playHover();
    audio.playClick();
    expect(media).toHaveLength(0);
    expect(contexts).toHaveLength(0);

    audio.unlock();
    audio.unlock();
    expect(media).toHaveLength(1);
    expect(contexts).toHaveLength(1);
    expect(media[0]).toMatchObject({ src: '/assets/audio/midnight-hangar.mp3', loop: true, volume: 0.1 });
    expect(media[0].play).toHaveBeenCalledTimes(1);
    await settle();
    audio.unlock();
    expect(media[0].play).toHaveBeenCalledTimes(1);
  });

  it('applies saved channel volumes live without replacing music or losing its playhead', async () => {
    audio.setMusicActive(true);
    audio.setVolumes({ ...defaultAudioSettings(), musicVolume: 0.2, masterVolume: 0.5, uiVolume: 0.4 });
    audio.unlock();
    await settle();
    const music = media[0], context = contexts[0];
    music.currentTime = 32;
    expect(music.volume).toBeCloseTo(0.1);
    expect(context.gains[0].gain.value).toBeCloseTo(0.06);
    audio.setVolumes({ ...defaultAudioSettings(), musicVolume: 0.3 });
    expect(music.volume).toBeCloseTo(0.3);
    expect(music.currentTime).toBe(32);
    expect(media).toHaveLength(1);

    audio.setVolumes({ ...defaultAudioSettings(), musicVolume: 0 });
    expect(music.paused).toBe(true);
    audio.playClick();
    expect(context.oscillators).toHaveLength(1);
    audio.setVolumes({ ...defaultAudioSettings(), masterVolume: 0 });
    audio.playClick();
    expect(context.oscillators).toHaveLength(1);
    expect(context.gains[0].gain.value).toBe(0);
    audio.setVolumes(defaultAudioSettings());
    await settle();
    expect(music.paused).toBe(false);
    expect(music.currentTime).toBe(32);
    expect(music.volume).toBe(0.1);
  });

  it('pauses for mute, visibility and gameplay without resetting the music playhead', async () => {
    audio.unlock();
    expect(media[0].muted).toBe(true);
    audio.setMusicActive(true);
    await settle();
    const music = media[0];
    music.currentTime = 27;

    audio.setMuted(true);
    expect(music).toMatchObject({ paused: true, muted: true, currentTime: 27 });
    audio.setVisible(false);
    audio.setMuted(false);
    expect(music.play).toHaveBeenCalledTimes(1);
    audio.setVisible(true);
    await settle();
    expect(music).toMatchObject({ paused: false, muted: false, currentTime: 27 });

    audio.setMusicActive(false);
    audio.setVisible(false);
    audio.setVisible(true);
    expect(music).toMatchObject({ paused: true, muted: true, currentTime: 27 });
    audio.setMusicActive(true);
    await settle();
    expect(music.play).toHaveBeenCalledTimes(3);
    expect(music.currentTime).toBe(27);
  });

  it('keeps a pending play silent when intent changes and serializes its retry', async () => {
    audio.unlock();
    await settle();
    const music = media[0];
    music.play.mockClear();
    const pending = deferred();
    music.play.mockImplementationOnce(() => pending.promise);
    audio.setMusicActive(true);
    audio.setMusicActive(false);
    audio.setMusicActive(true);
    audio.unlock();
    expect(music.play).toHaveBeenCalledTimes(1);
    pending.reject(new Error('The play request was interrupted by pause().'));
    await settle();
    expect(music.play).toHaveBeenCalledTimes(2);
    expect(music.paused).toBe(false);

    audio.setMusicActive(false);
    const late = deferred();
    music.play.mockImplementationOnce(() => late.promise);
    audio.setMusicActive(true);
    audio.setMuted(true);
    music.paused = false; // Model a delayed playback completion after the mute request.
    late.resolve();
    await settle();
    expect(music).toMatchObject({ paused: true, muted: true });
    expect(music.play).toHaveBeenCalledTimes(3);
  });

  it('absorbs playback rejection without repeatedly retrying, then allows another gesture', async () => {
    audio.unlock();
    await settle();
    const music = media[0];
    music.play.mockClear();
    music.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    audio.setMusicActive(true);
    await settle();
    expect(music.play).toHaveBeenCalledTimes(1);
    audio.unlock();
    await settle();
    expect(music.play).toHaveBeenCalledTimes(2);
    expect(music.paused).toBe(false);
  });

  it('plays short UI envelopes while music is inactive, debounces hover, and respects mute/visibility', () => {
    audio.unlock();
    const context = contexts[0];
    audio.playHover();
    audio.playHover();
    context.currentTime = 0.064;
    audio.playHover();
    expect(context.oscillators).toHaveLength(1);
    context.currentTime = 0.066;
    audio.playHover();
    audio.playClick();
    expect(context.oscillators).toHaveLength(3);
    expect(context.oscillators.every(oscillator => oscillator.start.mock.calls.length === 1)).toBe(true);
    expect(context.gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(context.gains[1].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.055);

    audio.setMuted(true);
    audio.playClick();
    expect(context.gains[0].gain.value).toBe(0);
    audio.setMuted(false);
    audio.setVisible(false);
    context.currentTime = 1;
    audio.playHover();
    audio.playClick();
    expect(context.oscillators).toHaveLength(3);
    expect(context.gains[0].gain.value).toBe(0);
    audio.setVisible(true);
    audio.playClick();
    expect(context.oscillators).toHaveLength(4);
  });

  it('disposes active tones and music once, including a pending playback request', async () => {
    audio.unlock();
    await settle();
    audio.playClick();
    const music = media[0], context = contexts[0];
    const pending = deferred();
    music.play.mockImplementationOnce(() => pending.promise);
    audio.setMusicActive(true);
    audio.destroy();
    audio.destroy();
    pending.resolve();
    await settle();
    audio.unlock();
    audio.setMusicActive(true);
    audio.setMuted(false);
    audio.setVisible(true);
    audio.playClick();

    expect(music).toMatchObject({ paused: true, muted: true });
    expect(music.removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
    expect(music.load).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0].disconnect).toHaveBeenCalledTimes(1);
    expect(media).toHaveLength(1);
    expect(contexts).toHaveLength(1);
  });

  it('silently primes media in the entry gesture, then pauses if the menu has not opened', async () => {
    audio.unlock();
    audio.unlock();
    expect(media[0].play).toHaveBeenCalledTimes(1);
    expect(media[0].muted).toBe(true);
    await settle();
    expect(media[0]).toMatchObject({ paused: true, muted: true });
    audio.unlock();
    expect(media[0].play).toHaveBeenCalledTimes(1);
    audio.setMusicActive(true);
    await settle();
    expect(media[0]).toMatchObject({ paused: false, muted: false });
    expect(media[0].play).toHaveBeenCalledTimes(2);
  });

  it('does not prime while muted or hidden, and can unlock on a later eligible gesture', () => {
    audio.setMuted(true);
    audio.unlock();
    expect(media[0].play).not.toHaveBeenCalled();
    audio.setMuted(false);
    audio.setVisible(false);
    audio.unlock();
    expect(media[0].play).not.toHaveBeenCalled();
    audio.setVisible(true);
    audio.unlock();
    expect(media[0].play).toHaveBeenCalledTimes(1);
    expect(media[0].muted).toBe(true);
  });

  it('handles destruction during a pending context resume and unavailable audio APIs', async () => {
    const pending = deferred();
    class DelayedContext extends FakeContext {
      override resume = vi.fn(() => pending.promise);
    }
    vi.stubGlobal('AudioContext', DelayedContext);
    audio.unlock();
    audio.unlock();
    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    audio.destroy();
    pending.resolve();
    await settle();
    expect(contexts[0].close).toHaveBeenCalledTimes(1);

    vi.stubGlobal('Audio', undefined);
    vi.stubGlobal('AudioContext', undefined);
    const unavailable = new MenuAudio();
    expect(() => {
      unavailable.setMusicActive(true);
      unavailable.unlock();
      unavailable.playHover();
      unavailable.playClick();
      unavailable.destroy();
    }).not.toThrow();
  });

  it('starts the original dance loop only after a gesture and retains its beat through menu navigation', async () => {
    vi.stubGlobal('AudioContext', DanceContext);
    audio.setDanceActive(true); audio.setMusicActive(true);
    expect(contexts).toHaveLength(0); expect(audio.getDanceTime()).toBeNull();
    audio.unlock(); await settle();
    const context = contexts[0] as DanceContext;
    expect(media).toHaveLength(0);
    expect(context.sources).toHaveLength(1); expect(context.sources[0].loop).toBe(true);
    expect(context.buffers[0].duration).toBeCloseTo(DANCE_BEATS * 60 / DANCE_BPM, 3);
    context.currentTime = 1.5; expect(audio.getDanceTime()).toBe(1.5);
    audio.unlock(); expect(context.sources).toHaveLength(1);
    audio.setVisible(false); expect(context.sources[0].stop).toHaveBeenCalledOnce();
    context.currentTime = 5; audio.setVisible(true);
    expect(context.sources).toHaveLength(2); expect(context.sources[1].start).toHaveBeenCalledWith(0, 1.5);
    expect(audio.getDanceTime()).toBe(1.5);
    audio.setMusicActive(false); expect(audio.getDanceTime()).toBeNull();
    audio.setMusicActive(true); expect(context.buffers).toHaveLength(1);
    audio.setMuted(true); expect(context.sources.at(-1)!.stop).toHaveBeenCalledOnce();
  });

  it('generates a reproducible 16-beat percussion loop with headroom and a quiet seam', () => {
    const context = new DanceContext() as unknown as AudioContext;
    const first = createDanceBuffer(context).getChannelData(0), second = createDanceBuffer(context).getChannelData(0);
    expect(first.every(Number.isFinite)).toBe(true);
    let peak = 0, energy = 0;
    for (let i = 0; i < first.length; i++) { peak = Math.max(peak, Math.abs(first[i])); energy += first[i] ** 2;
      if (i % 997 === 0) expect(first[i]).toBe(second[i]); }
    expect(peak).toBeLessThan(.75); expect(Math.sqrt(energy / first.length)).toBeGreaterThan(.04);
    expect(Math.abs(first[0] - first.at(-1)!)).toBeLessThan(.01);
  });
});
