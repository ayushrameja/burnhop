import { describe, expect, it } from 'vitest';
import { defaultGraphics, FramePacer, GRAPHICS_PRESETS, graphicsPreset, normalizeGraphics } from './graphics';
import { FramePerformance } from './framePerformance';
import { FixedStepClock } from './timing';

describe('graphics settings and independent drawing cadence', () => {
  it('defaults malformed fields independently and identifies custom combinations', () => {
    expect(defaultGraphics()).toEqual({ renderScale: .75, frameRate: 120, scenery: 'medium', effects: 'medium' });
    expect(normalizeGraphics({ renderScale: 99, frameRate: 120, scenery: 'ultra', effects: 'low' }))
      .toEqual({ ...defaultGraphics(), frameRate: 120, effects: 'low' });
    for (const invalid of [undefined, null, false, [], 1]) expect(normalizeGraphics(invalid)).toEqual(defaultGraphics());
    for (const key of ['low', 'balanced', 'high'] as const) expect(graphicsPreset(GRAPHICS_PRESETS[key])).toBe(key);
    expect(graphicsPreset({ ...defaultGraphics(), frameRate: 60 })).toBe('custom');
  });
  it('keeps simulation at 60 Hz while limiting rendering on 60, 120, 144 and 240 Hz displays', () => {
    for (const refresh of [60, 120, 144, 240]) {
      const pacer = new FramePacer(), clock = new FixedStepClock();
      let ticks = 0, draws = 0;
      for (let i = 0; i < refresh * 5; i++) {
        clock.advance(1 / refresh, () => ticks++);
        if (pacer.shouldDraw(100 + i * 1000 / refresh, 60)) draws++;
      }
      expect(ticks).toBeGreaterThanOrEqual(299); expect(ticks).toBeLessThanOrEqual(300);
      expect(draws).toBeGreaterThanOrEqual(299); expect(draws).toBeLessThanOrEqual(301);
    }
  });
  it('does not halve the frame rate on slightly jittery 60 Hz timestamps or catch up with bursts after a stall', () => {
    const pacer = new FramePacer();
    for (let i = 0; i < 120; i++) expect(pacer.shouldDraw(100 + i * 1000 / 60 + (i % 2 ? .15 : -.15), 60)).toBe(true);
    expect(pacer.shouldDraw(10_000, 60)).toBe(true);
    expect(pacer.shouldDraw(10_001, 60)).toBe(false);
    pacer.reset(); expect(pacer.shouldDraw(10_002, 60)).toBe(true);
    expect(pacer.shouldDraw(10_003, 0)).toBe(true);
    expect(pacer.shouldDraw(10_004, 120)).toBe(true);
  });
  it('retains real hitches in bounded diagnostics and calculates FPS from elapsed time', () => {
    const frames = new FramePerformance();
    for (let i = 0; i < 2000; i++) frames.record(1000 / 60, 2);
    expect(frames.fps).toBeCloseTo(60);
    frames.record(150, 90); frames.record(0); frames.record(NaN);
    expect(frames.snapshot()).toMatchObject({ samples: 1800, measuredFrames: 2001, hitchesOver100Ms: 1, maxFrameMs: 150 });
    expect(frames.snapshot().windowSeconds).toBeGreaterThan(30);
  });
});
