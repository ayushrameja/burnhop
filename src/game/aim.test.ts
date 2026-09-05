import { describe, expect, it } from 'vitest';
import { AIM_DASH_DISTANCE, AIM_DASH_LENGTH, clampAimPointer, getAimDash, moveAimPointer, resolveAimAngle, type AimMode } from './aim';

describe('mouse aiming', () => {
  it.each(['radial', 'pointer'] as const)('aims immediately through the full circle in %s mode', mode => {
    const origin = { x: 200, y: 150 };
    for (let i = 0; i < 32; i++) {
      const angle = -Math.PI + i * Math.PI / 16;
      const pointer = { x: origin.x + Math.cos(angle) * 100, y: origin.y + Math.sin(angle) * 100 };
      const result = resolveAimAngle(pointer, origin, 1, mode);
      expect(Math.cos(result)).toBeCloseTo(Math.cos(angle), 10);
      expect(Math.sin(result)).toBeCloseTo(Math.sin(angle), 10);
    }
  });

  it('retains the latest angle throughout the six CSS-pixel radial dead zone', () => {
    const origin = { x: 320, y: 180 };
    for (const delta of [{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 3, y: 4 }, { x: -6, y: 0 }]) {
      expect(resolveAimAngle({ x: origin.x + delta.x, y: origin.y + delta.y }, origin, 0.75, 'radial')).toBe(0.75);
    }
    expect(resolveAimAngle({ x: origin.x, y: origin.y + 6.01 }, origin, 0.75, 'radial')).toBe(Math.PI / 2);
  });

  it('shares the latest angle across switches and allows direct aim inside the radial dead zone', () => {
    const origin = { x: 10, y: 20 };
    const pointer = { x: 10, y: 23 };
    let angle = resolveAimAngle(pointer, origin, 0.4, 'radial');
    expect(angle).toBe(0.4);
    angle = resolveAimAngle(pointer, origin, angle, 'pointer');
    expect(angle).toBe(Math.PI / 2);
    expect(resolveAimAngle(pointer, origin, angle, 'radial')).toBe(angle);
    const distantPointer = { x: 120, y: -80 };
    expect(resolveAimAngle(distantPointer, origin, angle, 'radial')).toBe(resolveAimAngle(distantPointer, origin, angle, 'pointer'));
  });

  it.each(['radial', 'pointer'] as AimMode[])('keeps a finite angle at the exact pivot and invalid coordinates in %s mode', mode => {
    const origin = { x: 50, y: 40 };
    expect(resolveAimAngle(origin, origin, -2.5, mode)).toBe(-2.5);
    expect(resolveAimAngle({ x: NaN, y: 100 }, origin, -2.5, mode)).toBe(-2.5);
    expect(resolveAimAngle({ x: Infinity, y: 100 }, origin, -2.5, mode)).toBe(-2.5);
    expect(resolveAimAngle(origin, origin, NaN, mode)).toBe(0);
  });

  it('lets a stationary mouse track a screen position as the weapon pivot moves', () => {
    const pointer = { x: 500, y: 300 };
    const first = resolveAimAngle(pointer, { x: 200, y: 300 }, 0, 'radial');
    const moved = resolveAimAngle(pointer, { x: 200, y: 200 }, first, 'radial');
    expect(first).toBe(0);
    expect(moved).toBeCloseTo(Math.atan2(100, 300));
  });

  it('retains the latest input angle when pointer events enter the dead zone between frames', () => {
    const origin = { x: 300, y: 250 };
    let latestAngle = resolveAimAngle({ x: 300, y: 150 }, origin, 0, 'radial');
    latestAngle = resolveAimAngle({ x: 303, y: 251 }, origin, latestAngle, 'radial');
    expect(latestAngle).toBe(-Math.PI / 2);
    expect(resolveAimAngle({ x: 303, y: 251 }, origin, latestAngle, 'radial')).toBe(-Math.PI / 2);
  });
});

describe('radial dash', () => {
  it('stays aligned with the configured dash length and pivot distance', () => {
    const origin = { x: 149, y: -84 };
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16;
      const dash = getAimDash(origin, angle);
      expect(Math.hypot(dash.start.x - origin.x, dash.start.y - origin.y)).toBeCloseTo(AIM_DASH_DISTANCE);
      expect(Math.hypot(dash.end.x - dash.start.x, dash.end.y - dash.start.y)).toBeCloseTo(AIM_DASH_LENGTH);
      expect((dash.start.x - origin.x) * Math.sin(angle) - (dash.start.y - origin.y) * Math.cos(angle)).toBeCloseTo(0);
      expect((dash.end.x - origin.x) * Math.sin(angle) - (dash.end.y - origin.y) * Math.cos(angle)).toBeCloseTo(0);
    }
  });

  it('does not extend when the mouse moves farther along the same direction', () => {
    const origin = { x: 0, y: 0 };
    const closeAngle = resolveAimAngle({ x: 20, y: 20 }, origin, 0, 'radial');
    const farAngle = resolveAimAngle({ x: 2000, y: 2000 }, origin, 0, 'radial');
    expect(getAimDash(origin, closeAngle)).toEqual(getAimDash(origin, farAngle));
  });
});

describe('captured mouse pointer', () => {
  const bounds = { left: 40, top: 90, right: 1000, bottom: 630 };

  it('integrates relative movement without depending on frozen native client coordinates', () => {
    const first = moveAimPointer({ x: 320, y: 260 }, { x: 17.5, y: -12 }, bounds);
    expect(first).toEqual({ x: 337.5, y: 248 });
    expect(moveAimPointer(first, { x: -7.5, y: 20 }, bounds)).toEqual({ x: 330, y: 268 });
  });

  it('clamps to all four logical playfield edges and moves away from the edge immediately', () => {
    const bottomRight = moveAimPointer({ x: 320, y: 260 }, { x: 5000, y: 5000 }, bounds);
    expect(bottomRight).toEqual({ x: bounds.right, y: bounds.bottom });
    expect(moveAimPointer(bottomRight, { x: -1, y: -1 }, bounds)).toEqual({ x: bounds.right - 1, y: bounds.bottom - 1 });
    expect(moveAimPointer(bottomRight, { x: -5000, y: -5000 }, bounds)).toEqual({ x: bounds.left, y: bounds.top });
  });

  it('preserves an inside pointer on capture and clamps an old pointer after viewport resizing', () => {
    expect(clampAimPointer({ x: 320, y: 260 }, bounds)).toEqual({ x: 320, y: 260 });
    expect(clampAimPointer({ x: 1400, y: 720 }, bounds)).toEqual({ x: bounds.right, y: bounds.bottom });
    expect(clampAimPointer({ x: 0, y: 0 }, bounds)).toEqual({ x: bounds.left, y: bounds.top });
  });

  it('ignores invalid relative deltas and recovers a finite pointer within the viewport', () => {
    expect(moveAimPointer({ x: 320, y: 260 }, { x: NaN, y: Infinity }, bounds)).toEqual({ x: 320, y: 260 });
    expect(clampAimPointer({ x: NaN, y: Infinity }, bounds)).toEqual({ x: 520, y: 360 });
  });
});
