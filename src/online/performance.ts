/** Bounded, local-only measurements. Snapshot sorting happens only when inspected. */
class Samples {
  private values: number[] = [];
  private cursor = 0;
  add(value: number): void {
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % 300;
  }
  snapshot() {
    const sorted = this.values.slice().sort((a, b) => a - b);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1);
    return { samples: sorted.length, mean, p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
      p99: sorted[Math.max(0, Math.ceil(sorted.length * .99) - 1)] ?? 0,
      deviation: Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length || 1)) };
  }
}

export class OnlinePerformance {
  private arrivals = new Samples();
  private frames = new Samples();
  private lastArrival: number | null = null;
  private corrections = 0;
  private reconciliations = 0;
  private maximumCorrection = 0;
  private slowFrames = 0;
  private measuredFrames = 0;
  patch(now: number): void {
    if (this.lastArrival !== null) this.arrivals.add(Math.max(0, now - this.lastArrival));
    this.lastArrival = now;
  }
  resetArrivalClock(): void { this.lastArrival = null; }
  frame(ms: number): void {
    if (ms <= 0) return;
    this.frames.add(ms); this.measuredFrames++;
    if (ms > 1000 / 30) this.slowFrames++;
  }
  reconcile(before: { x: number; y: number }, after: { x: number; y: number }): void {
    const distance = Math.hypot(after.x - before.x, after.y - before.y);
    this.reconciliations++;
    // Ignore floating point dust; count spatial changes after replay at the SAME input horizon.
    if (distance > .5) this.corrections++;
    this.maximumCorrection = Math.max(this.maximumCorrection, distance);
  }
  snapshot() {
    const arrival = this.arrivals.snapshot(), frame = this.frames.snapshot();
    return { arrivalSamples: arrival.samples, arrivalIntervalMs: arrival.mean, arrivalJitterMs: arrival.deviation,
      arrivalP95Ms: arrival.p95, frameSamples: frame.samples, frameP95Ms: frame.p95, frameP99Ms: frame.p99,
      measuredFrames: this.measuredFrames, slowFrames: this.slowFrames, reconciliations: this.reconciliations,
      corrections: this.corrections, correctionFraction: this.corrections / (this.reconciliations || 1),
      maximumCorrectionWorldUnits: this.maximumCorrection };
  }
}
