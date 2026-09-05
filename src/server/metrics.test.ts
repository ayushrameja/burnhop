import { describe, expect, it } from 'vitest';
import { SimulationMetrics } from './metrics';

const STEP = 1000 / 60;

describe('simulation scheduling telemetry', () => {
  it('reports an isolated hitch and discarded time, then clears current lag after recovery', () => {
    const metrics = new SimulationMetrics(); metrics.startTimestep(0);
    let now = 0;
    for (let tick = 0; tick < 120; tick++) { now += STEP; metrics.record(1, 0, now); }
    now += 250;
    for (let catchup = 0; catchup < 5; catchup++) metrics.record(catchup === 0 ? 133 : 1, 0, now);
    const stalled = metrics.snapshot();
    expect(stalled.scheduleLagMs).toBeGreaterThan(100);
    expect(stalled.catchUpLimitHits).toBe(1);
    expect(stalled.droppedSimulationMs).toBeCloseTo(250 - 5 * STEP);
    expect(stalled.pendingSimulationMs).toBe(0);
    for (let tick = 0; tick < 120; tick++) { now += STEP; metrics.record(1, 0, now); }
    const recovered = metrics.snapshot();
    expect(recovered.scheduleLagMs).toBeLessThan(.001);
    expect(recovered.observedTickRate).toBeCloseTo(60);
    expect(recovered.droppedSimulationMs).toBeCloseTo(stalled.droppedSimulationMs);
    // The retained deficit includes the hitch and the one-second recovery window.
    expect(recovered.longestScheduleDeficitMs).toBeLessThan(1250);
    expect(recovered.overBudgetTicks).toBe(1);
  });

  it('detects sustained throughput loss even when the framework repeatedly drops its pending work', () => {
    const metrics = new SimulationMetrics(); metrics.startTimestep(0);
    let now = 0;
    // Starvation permits five fixed steps each 125ms: 40Hz of actual progress.
    for (let batch = 0; batch < 320; batch++) {
      now += 125;
      for (let step = 0; step < 5; step++) metrics.record(1, 0, now);
    }
    const snapshot = metrics.snapshot();
    expect(snapshot.pendingSimulationMs).toBe(0);
    expect(snapshot.scheduleLagMs).toBeGreaterThan(100);
    expect(snapshot.observedTickRate).toBeLessThan(50);
    expect(snapshot.longestScheduleDeficitMs).toBeGreaterThan(30_000);
    expect(snapshot.catchUpLimitHits).toBe(320);
    expect(snapshot.droppedSimulationMs).toBeCloseTo(320 * (125 - 5 * STEP));
  });

  it('does not accumulate fictitious delay from steady 60Hz operation', () => {
    const metrics = new SimulationMetrics(); metrics.startTimestep(0);
    for (let tick = 1; tick <= 3600; tick++) metrics.record(1, 0, tick * STEP);
    const snapshot = metrics.snapshot();
    expect(snapshot.scheduleLagMs).toBeLessThan(.001);
    expect(snapshot.droppedSimulationMs).toBe(0);
    expect(snapshot.longestScheduleDeficitMs).toBe(0);
    expect(snapshot.p99WorkMs).toBe(1);
  });

  it('retains stalls longer than the rolling window instead of reporting an empty healthy window', () => {
    const metrics = new SimulationMetrics(); metrics.startTimestep(0);
    metrics.record(1, 0, STEP);
    let now = STEP;
    for (let batch = 0; batch < 20; batch++) {
      now += 2000;
      for (let step = 0; step < 5; step++) metrics.record(1, 0, now);
    }
    expect(metrics.snapshot().scheduleLagMs).toBeGreaterThan(1000);
    expect(metrics.snapshot().observedTickRate).toBeLessThan(5);
    expect(metrics.snapshot().longestScheduleDeficitMs).toBeGreaterThan(30_000);
  });

  it('retains a thirty-second freeze and a recovered input backlog between HTTP samples', () => {
    const metrics = new SimulationMetrics(); metrics.startTimestep(0);
    metrics.record(1, 12, STEP, 120);
    metrics.record(1, 0, STEP + 31_000);
    const stalled = metrics.snapshot();
    expect(stalled.longestScheduleDeficitMs).toBeGreaterThan(30_000);
    expect(stalled.consecutiveInputBacklogTicks).toBe(0);
    expect(stalled.maxConsecutiveInputBacklogTicks).toBe(120);
  });
});
