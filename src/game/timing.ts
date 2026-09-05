/** Fixed simulation ticks, independent of browser refresh rate. */
export class FixedStepClock {
  readonly step = 1 / 60;
  private accumulator = 0;
  advance(elapsedSeconds: number, tick: () => void): number {
    this.accumulator += Math.min(Math.max(0, elapsedSeconds), 0.1);
    let count = 0;
    while (this.accumulator + 1e-10 >= this.step && count < 5) {
      tick();
      this.accumulator -= this.step;
      count++;
    }
    if (count === 5 && this.accumulator >= this.step) this.accumulator %= this.step;
    return Math.max(0, Math.min(1, this.accumulator / this.step));
  }
  reset(): void { this.accumulator = 0; }
}
