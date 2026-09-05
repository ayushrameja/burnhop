import { describe, expect, it } from 'vitest';
import { getReloadProgress } from './reload';

describe('simulation-driven reload progress', () => {
  it('uses remaining ticks and leaves completed or invalid reloads inactive', () => {
    expect(getReloadProgress(72, 72)).toBe(0);
    expect(getReloadProgress(54, 72)).toBe(.25);
    expect(getReloadProgress(18, 72)).toBe(.75);
    expect(getReloadProgress(1, 72)).toBeCloseTo(71 / 72);
    expect(getReloadProgress(80, 72)).toBe(0);
    for (const remaining of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(getReloadProgress(remaining, 72)).toBe(-1);
    for (const total of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(getReloadProgress(20, total)).toBe(-1);
  });
});
