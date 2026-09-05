import { describe, expect, it } from 'vitest';
import arena from '../../public/assets/arena.json';
import { CAMERA_VIEWPORT, ZOOM_SCALES, followCamera, getCameraTarget, nextZoomLevel, type ZoomLevel } from './camera';

const levels: ZoomLevel[] = [1, 3, 5];

describe('camera framing', () => {
  it('cycles from 1× through 3× and 5×', () => {
    expect([nextZoomLevel(1), nextZoomLevel(3), nextZoomLevel(5)]).toEqual([3, 5, 1]);
  });

  it('uses 1× for the closest view, 3× for original framing, and 5× for the widest view', () => {
    expect(ZOOM_SCALES).toEqual({ 1: 1.5, 3: 1.1, 5: 0.75 });
    expect(CAMERA_VIEWPORT.width / ZOOM_SCALES[1]).toBeLessThan(CAMERA_VIEWPORT.width / ZOOM_SCALES[3]);
    expect(CAMERA_VIEWPORT.width / ZOOM_SCALES[3]).toBeLessThan(CAMERA_VIEWPORT.width / ZOOM_SCALES[5]);
  });

  it.each(levels)('centers interior anchors and stops at every arena edge at %s×', level => {
    const scale = ZOOM_SCALES[level];
    const viewport = { width: CAMERA_VIEWPORT.width / scale, height: CAMERA_VIEWPORT.height / scale };
    const anchor = { x: 1200, y: 650 };
    const centered = getCameraTarget(anchor, arena, scale);
    expect((anchor.x - centered.x) * scale).toBeCloseTo(640);
    expect((anchor.y - centered.y) * scale).toBeCloseTo(360);
    expect(getCameraTarget({ x: 0, y: 0 }, arena, scale)).toEqual({ x: 0, y: 0 });
    expect(getCameraTarget({ x: arena.width, y: arena.floorY }, arena, scale)).toEqual({
      x: arena.width - viewport.width,
      y: arena.floorY + 95 - viewport.height,
    });
    expect(viewport.width).toBeLessThan(arena.width);
    expect(viewport.height).toBeLessThan(arena.floorY + 95);
  });

  it.each(levels)('keeps only a small trailing distance during movement and reversals at %s×', level => {
    const scale = ZOOM_SCALES[level];
    const anchor = { x: 1000, y: 850 };
    let position = getCameraTarget(anchor, arena, scale);
    for (const direction of [1, -1]) {
      for (let frame = 0; frame < 30; frame++) {
        anchor.x += direction * 320 / 60;
        anchor.y -= direction * 480 / 60;
        position = followCamera(position, anchor, arena, scale, 1 / 60);
        const desired = getCameraTarget(anchor, arena, scale);
        expect(Math.abs(position.x - desired.x) * scale).toBeLessThanOrEqual(24 + 1e-9);
        expect(Math.abs(position.y - desired.y) * scale).toBeLessThanOrEqual(32 + 1e-9);
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.x + CAMERA_VIEWPORT.width / scale).toBeLessThanOrEqual(arena.width);
        expect(position.y + CAMERA_VIEWPORT.height / scale).toBeLessThanOrEqual(arena.floorY + 95);
      }
    }
    const desired = getCameraTarget(anchor, arena, scale);
    expect(Math.abs(position.x - desired.x)).toBeGreaterThan(1);
    for (let frame = 0; frame < 60; frame++) position = followCamera(position, anchor, arena, scale, 1 / 60);
    expect(position.x).toBeCloseTo(desired.x, 6);
    expect(position.y).toBeCloseTo(desired.y, 6);
  });

  it('caps sudden movement even before easing can catch up', () => {
    const anchor = { x: 1200, y: 650 };
    const scale = ZOOM_SCALES[5];
    const desired = getCameraTarget(anchor, arena, scale);
    const position = followCamera({ x: 0, y: 0 }, anchor, arena, scale, 0);
    expect((desired.x - position.x) * scale).toBeCloseTo(24);
    expect((desired.y - position.y) * scale).toBeCloseTo(32);
  });
});
