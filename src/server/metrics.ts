/** One minute rolling work samples, plus lifetime peaks, with bounded memory. */
export class SimulationMetrics {
  private samples = new Float64Array(3600);
  private cursor = 0;
  private sampleCount = 0;
  private tickCount = 0;
  private overBudgetCount = 0;
  private peakMs = 0;
  private maxInputBacklog = 0;
  private backlogTicks = 0;
  private maxBacklogTicks = 0;
  private resyncCount = 0;
  private lastWallTime = 0;
  private scheduleLagMs = 0;
  private times = new Float64Array(128);
  private timeCursor = 0;
  private timeCount = 0;
  private scheduleWindowMs = 0;
  private observedTickRate = 60;
  private deficitSince: number | undefined;
  private longestScheduleDeficitMs = 0;
  private previousSimulationClock: number | undefined;
  private batchSteps = 0;
  private pendingSimulationMs = 0;
  private droppedSimulationMs = 0;
  private catchUpLimitHits = 0;
  private peakPendingSimulationMs = 0;
  private readonly stepMs = 1000 / 60;

  /** Call immediately before setFixedTimestep so the mirror starts with its empty accumulator. */
  startTimestep(clockElapsedMs: number): void { this.previousSimulationClock = clockElapsedMs; }

  record(workMs: number, backlog: number, now: number, consecutiveClientBacklogTicks = 0, simulationClockMs = now): void {
    this.samples[this.cursor] = workMs; this.cursor = (this.cursor + 1) % this.samples.length;
    this.sampleCount = Math.min(this.sampleCount + 1, this.samples.length);
    this.tickCount++; this.peakMs = Math.max(this.peakMs, workMs);
    if (workMs >= 1000 / 60) this.overBudgetCount++;
    this.maxInputBacklog = Math.max(this.maxInputBacklog, backlog);
    // A different jittered client each tick must not create a fictitious single
    // continuous backlog. The room measures each channel separately after cleanup.
    this.backlogTicks = consecutiveClientBacklogTicks;
    this.maxBacklogTicks = Math.max(this.maxBacklogTicks, consecutiveClientBacklogTicks);
    this.lastWallTime = Date.now();
    this.recordSchedule(now, simulationClockMs);
  }

  private recordSchedule(now: number, simulationClockMs: number): void {
    // The pinned core 0.18 loop executes up to five steps at the same room-clock
    // instant, then discards its accumulator. Mirroring that separately records
    // dropped time instead of misreporting it forever as still-pending work.
    this.previousSimulationClock ??= simulationClockMs - this.stepMs;
    if (simulationClockMs !== this.previousSimulationClock) {
      this.pendingSimulationMs += Math.max(0, simulationClockMs - this.previousSimulationClock);
      this.previousSimulationClock = simulationClockMs;
      this.batchSteps = 0;
    }
    this.pendingSimulationMs = Math.max(0, this.pendingSimulationMs - this.stepMs);
    this.peakPendingSimulationMs = Math.max(this.peakPendingSimulationMs, this.pendingSimulationMs);
    if (++this.batchSteps === 5) {
      this.catchUpLimitHits++;
      this.droppedSimulationMs += this.pendingSimulationMs;
      this.pendingSimulationMs = 0;
    }

    const previousTickAt = this.timeCount ? this.times[(this.timeCursor - 1 + this.times.length) % this.times.length] : now;
    this.times[this.timeCursor] = now;
    this.timeCursor = (this.timeCursor + 1) % this.times.length;
    this.timeCount = Math.min(this.timeCount + 1, this.times.length);
    let oldest = now, intervals = 0;
    for (let offset = 2; offset <= this.timeCount; offset++) {
      const candidate = this.times[(this.timeCursor - offset + this.times.length) % this.times.length];
      oldest = candidate; intervals++;
      // Include the boundary interval: dropping it would make a >1s stall
      // leave an empty window and incorrectly report a healthy 60Hz loop.
      if (candidate <= now - 1000) break;
    }
    this.scheduleWindowMs = now - oldest;
    this.scheduleLagMs = Math.max(0, this.scheduleWindowMs - intervals * this.stepMs);
    this.observedTickRate = this.scheduleWindowMs > 0 ? intervals * 1000 / this.scheduleWindowMs : 60;
    if (this.scheduleLagMs > 100) {
      this.deficitSince ??= now - Math.max(0, now - previousTickAt - this.stepMs);
      this.longestScheduleDeficitMs = Math.max(this.longestScheduleDeficitMs, now - this.deficitSince);
    } else this.deficitSince = undefined;
  }
  resynchronized(): void { this.resyncCount++; }
  snapshot() {
    const sorted = Array.from(this.samples.slice(0, this.sampleCount)).sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
    return {
      ticks: this.tickCount, sampledTicks: this.sampleCount, p50WorkMs: percentile(.5), p99WorkMs: percentile(.99),
      peakWorkMs: this.peakMs, overBudgetTicks: this.overBudgetCount, maxInputBacklog: this.maxInputBacklog,
      consecutiveInputBacklogTicks: this.backlogTicks, resynchronizations: this.resyncCount,
      maxConsecutiveInputBacklogTicks: this.maxBacklogTicks,
      scheduleLagMs: this.scheduleLagMs, lastTickAt: this.lastWallTime,
      scheduleWindowMs: this.scheduleWindowMs, observedTickRate: this.observedTickRate,
      longestScheduleDeficitMs: this.longestScheduleDeficitMs,
      pendingSimulationMs: this.pendingSimulationMs, peakPendingSimulationMs: this.peakPendingSimulationMs,
      droppedSimulationMs: this.droppedSimulationMs, catchUpLimitHits: this.catchUpLimitHits,
    };
  }
}
