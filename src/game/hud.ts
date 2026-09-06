import type { HudState } from './types';

/** Avoid React commits when none of the displayed values has changed. */
export function retainHud(previous: HudState, next: HudState): HudState {
  if (previous.health === next.health && Math.ceil(previous.fuel) === Math.ceil(next.fuel)
    && Math.ceil(previous.fuel * .12) === Math.ceil(next.fuel * .12)
    && (previous.fuel < 20) === (next.fuel < 20) && (previous.fuel <= 0) === (next.fuel <= 0)
    && previous.ammo === next.ammo && Math.round(previous.reloadProgress * 100) === Math.round(next.reloadProgress * 100)
    && (previous.reloadProgress >= 0) === (next.reloadProgress >= 0)
    && previous.shotsFired === next.shotsFired && previous.hits === next.hits && previous.kills === next.kills
    && previous.targetHealth === next.targetHealth) return previous;
  return next;
}
