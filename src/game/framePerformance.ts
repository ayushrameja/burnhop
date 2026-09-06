/** Fixed storage; sampling allocates nothing. Sorting only happens when a report is requested. */
export class FramePerformance {
  private intervals = new Float64Array(1800);
  private work = new Float64Array(1800);
  private cursor = 0;
  private count = 0;
  private sum = 0;
  private recentSum = 0;
  private recentCount = 0;
  private currentFps: number | null = null;
  private total = 0;
  private slow = 0;
  private hitches = 0;
  record(interval: number, workMs = 0): void {
    if (interval <= 0 || !Number.isFinite(interval)) return;
    if (this.count === this.intervals.length) this.sum -= this.intervals[this.cursor];
    else this.count++;
    this.intervals[this.cursor] = interval;
    this.work[this.cursor] = workMs;
    this.sum += interval; this.total++;
    this.recentSum += interval; this.recentCount++;
    if (this.recentSum >= 500) {
      this.currentFps = this.recentCount * 1000 / this.recentSum;
      this.recentCount = 0; this.recentSum = 0;
    }
    if (interval > 1000 / 30 + .5) this.slow++;
    if (interval >= 100) this.hitches++;
    this.cursor = (this.cursor + 1) % this.intervals.length;
  }
  get fps(): number | null { return this.currentFps; }
  snapshot() {
    const intervals = this.intervals.slice(0, this.count).sort();
    const work = this.work.slice(0, this.count).sort();
    const percentile = (samples: Float64Array, p: number) => samples[Math.max(0, Math.ceil(samples.length * p) - 1)] ?? 0;
    return { samples: this.count, measuredFrames: this.total, windowSeconds: this.sum / 1000,
      fps: this.fps, frameP95Ms: percentile(intervals, .95), frameP99Ms: percentile(intervals, .99),
      maxFrameMs: intervals.at(-1) ?? 0, slowFrames: this.slow, hitchesOver100Ms: this.hitches,
      submissionP95Ms: percentile(work, .95), submissionP99Ms: percentile(work, .99) };
  }
}
