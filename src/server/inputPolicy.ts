import { neutralInput, type NetworkInput } from '../multiplayer/model';

/** Bridge a short ordered-WebSocket arrival gap without repeating one-shot actions. */
export function idleInput(latest: NetworkInput | undefined, aimAngle: number, missingTicks: number, connected: boolean): NetworkInput {
  const input = neutralInput(aimAngle, latest?.inputId ?? 0);
  if (!connected || !latest || missingTicks > 6) return input;
  input.moveX = latest.moveX;
  input.jumpHeld = latest.jumpHeld;
  input.jetHeld = latest.jetHeld;
  input.jetSeparate = latest.jetSeparate;
  input.crouchHeld = latest.crouchHeld;
  return input;
}

/** TCP can deliver seconds of legitimately paced input in one read after a stall.
 * This admits that bounded burst while rejecting a sustained excessive cadence.
 * It limits decode work only; simulation still consumes exactly one frame/tick. */
export class InputRateBudget {
  private tokens = 360;
  private lastTime: number;
  private previousReceived = 0;
  constructor(now: number) { this.lastTime = now; }
  accept(receivedTotal: number, now: number): boolean {
    const elapsed = Math.max(0, now - this.lastTime);
    this.lastTime = Math.max(this.lastTime, now);
    this.tokens = Math.min(360, this.tokens + elapsed * 90 / 1000);
    const received = Math.max(0, receivedTotal - this.previousReceived);
    this.previousReceived = receivedTotal;
    this.tokens -= received;
    return this.tokens >= 0;
  }
}
