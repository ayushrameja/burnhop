import type { Arena, Vec2 } from './types';

export type ZoomLevel = 1 | 3 | 5;
export const DEFAULT_ZOOM_LEVEL: ZoomLevel = 1;

/** View presets: 1× is close, 5× shows the most arena; 3× retains the original scale. */
export const ZOOM_SCALES: Readonly<Record<ZoomLevel, number>> = Object.freeze({
  1: 1.5,
  3: 1.1,
  5: 0.75,
});
export const CAMERA_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const FLOOR_PADDING = 95;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function nextZoomLevel(level: ZoomLevel): ZoomLevel {
  return level === 1 ? 3 : level === 3 ? 5 : 1;
}

type CameraArena = Pick<Arena, 'width' | 'floorY'>;

function cameraBounds(arena: CameraArena, scale: number): Vec2 {
  return {
    x: Math.max(0, arena.width - CAMERA_VIEWPORT.width / scale),
    y: Math.max(0, arena.floorY + FLOOR_PADDING - CAMERA_VIEWPORT.height / scale),
  };
}

/** Center on the standing-body anchor until an arena edge limits the view. */
export function getCameraTarget(anchor: Vec2, arena: CameraArena, scale: number): Vec2 {
  const bounds = cameraBounds(arena, scale);
  return {
    x: clamp(anchor.x - CAMERA_VIEWPORT.width / scale / 2, 0, bounds.x),
    y: clamp(anchor.y - CAMERA_VIEWPORT.height / scale / 2, 0, bounds.y),
  };
}

/** Brief follow lag, capped in logical viewport pixels at every zoom preset. */
export function followCamera(position: Vec2, anchor: Vec2, arena: CameraArena, scale: number, dt: number): Vec2 {
  const target = getCameraTarget(anchor, arena, scale);
  const bounds = cameraBounds(arena, scale);
  const elapsed = clamp(dt, 0, 0.06);
  const followAxis = (value: number, desired: number, rate: number, maxLag: number, bound: number) => {
    const eased = value + (desired - value) * (1 - Math.exp(-rate * elapsed));
    return clamp(clamp(eased, desired - maxLag / scale, desired + maxLag / scale), 0, bound);
  };
  return {
    x: followAxis(position.x, target.x, 20, 24, bounds.x),
    y: followAxis(position.y, target.y, 24, 32, bounds.y),
  };
}
