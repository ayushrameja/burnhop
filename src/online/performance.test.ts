import { describe, expect, it } from 'vitest';
import { OnlinePerformance } from './performance';

describe('local online diagnostics', () => {
  it('bounds samples, retains real stalls, and excludes time spent disconnected', () => {
    const stats = new OnlinePerformance();
    for (let i = 0; i <= 400; i++) stats.patch(i * 22);
    stats.resetArrivalClock(); stats.patch(100000); stats.patch(100022);
    expect(stats.snapshot()).toMatchObject({ arrivalSamples: 300, arrivalIntervalMs: 22, arrivalJitterMs: 0 });
    stats.patch(101022);
    stats.frame(16); stats.frame(50); stats.frame(0);
    expect(stats.snapshot().arrivalJitterMs).toBeGreaterThan(0);
    expect(stats.snapshot()).toMatchObject({ measuredFrames: 2, slowFrames: 1, frameP99Ms: 50 });
  });
  it('counts correction frequency after replay rather than unacknowledged movement', () => {
    const stats = new OnlinePerformance();
    stats.reconcile({ x: 200, y: 100 }, { x: 200, y: 100 });
    stats.reconcile({ x: 220, y: 100 }, { x: 223, y: 104 });
    expect(stats.snapshot()).toMatchObject({ reconciliations: 2, corrections: 1,
      correctionFraction: .5, maximumCorrectionWorldUnits: 5 });
  });
});
