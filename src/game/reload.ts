/** Shared positions on the simulation-driven reload timeline. */
export const RELOAD_CUES = { remove: 0.2, insert: 0.55, rack: 0.82 } as const;

/** Inactive reloads use -1; presentation never owns or advances this clock. */
export function getReloadProgress(remainingTicks: number, totalTicks: number): number {
  if (!Number.isFinite(remainingTicks) || !Number.isFinite(totalTicks) || remainingTicks <= 0 || totalTicks <= 0) return -1;
  return Math.max(0, Math.min(1, 1 - remainingTicks / totalTicks));
}
