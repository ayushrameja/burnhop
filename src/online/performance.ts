import { FramePerformance } from '../game/framePerformance';
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
  private frames = new FramePerformance();
  private lastArrival: number | null = null;
  private corrections = 0;
  private reconciliations = 0;
  private maximumCorrection = 0;
  patch(now: number): void {
    if (this.lastArrival !== null) this.arrivals.add(Math.max(0, now - this.lastArrival));
    this.lastArrival = now;
  }
  resetArrivalClock(): void { this.lastArrival = null; }
  get fps(): number | null { return this.frames.fps; }
  frame(ms: number, workMs = 0): void { this.frames.record(ms, workMs); }
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
      arrivalP95Ms: arrival.p95, fps: frame.fps, frameSamples: frame.samples, frameP95Ms: frame.frameP95Ms, frameP99Ms: frame.frameP99Ms, maxFrameMs: frame.maxFrameMs,
      measuredFrames: frame.measuredFrames, slowFrames: frame.slowFrames, hitchesOver100Ms: frame.hitchesOver100Ms,
      frameWindowSeconds: frame.windowSeconds, submissionP95Ms: frame.submissionP95Ms, submissionP99Ms: frame.submissionP99Ms, reconciliations: this.reconciliations,
      corrections: this.corrections, correctionFraction: this.corrections / (this.reconciliations || 1),
      maximumCorrectionWorldUnits: this.maximumCorrection };
  }
}
