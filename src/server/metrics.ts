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
  private resyncCount = 0;
  private lastWallTime = 0;
  private startWallTime = 0;
  private simulationElapsedMs = 0;
  private scheduleLagMs = 0;

  record(workMs: number, backlog: number, now: number, consecutiveClientBacklogTicks = 0): void {
    this.samples[this.cursor] = workMs; this.cursor = (this.cursor + 1) % this.samples.length;
    this.sampleCount = Math.min(this.sampleCount + 1, this.samples.length);
    this.tickCount++; this.peakMs = Math.max(this.peakMs, workMs);
    if (workMs >= 1000 / 60) this.overBudgetCount++;
    this.maxInputBacklog = Math.max(this.maxInputBacklog, backlog);
    // A different jittered client each tick must not create a fictitious single
    // continuous backlog. The room measures each channel separately after cleanup.
    this.backlogTicks = consecutiveClientBacklogTicks;
    if (!this.startWallTime) this.startWallTime = now;
    else this.simulationElapsedMs += 1000 / 60;
    this.lastWallTime = now;
    this.scheduleLagMs = Math.max(0, now - this.startWallTime - this.simulationElapsedMs);
  }
  resynchronized(): void { this.resyncCount++; }
  snapshot() {
    const sorted = Array.from(this.samples.slice(0, this.sampleCount)).sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
    return {
      ticks: this.tickCount, sampledTicks: this.sampleCount, p50WorkMs: percentile(.5), p99WorkMs: percentile(.99),
      peakWorkMs: this.peakMs, overBudgetTicks: this.overBudgetCount, maxInputBacklog: this.maxInputBacklog,
      consecutiveInputBacklogTicks: this.backlogTicks, resynchronizations: this.resyncCount,
      scheduleLagMs: this.scheduleLagMs, lastTickAt: this.lastWallTime,
    };
  }
}
