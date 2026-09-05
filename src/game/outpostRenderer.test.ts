import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutpostScenery } from './outpostRenderer';
import type { Arena, TerrainPolygon } from './types';

interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }
const identity = (): Matrix => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** Inert paint operations, with actual affine transform/restore semantics.
 * The canvas records dimensions without allocating large test bitmaps.
 */
function drawingContext() {
  let matrix = identity();
  const stack: Matrix[] = [];
  const noop = () => {};
  const multiply = (other: Matrix) => {
    const current = matrix;
    matrix = {
      a: current.a * other.a + current.c * other.b,
      b: current.b * other.a + current.d * other.b,
      c: current.a * other.c + current.c * other.d,
      d: current.b * other.c + current.d * other.d,
      e: current.a * other.e + current.c * other.f + current.e,
      f: current.b * other.e + current.d * other.f + current.f,
    };
  };
  const drawImage = vi.fn();
  const methods = {
    drawImage,
    createLinearGradient: () => ({ addColorStop: noop }),
    getTransform: () => ({ ...matrix }),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      matrix = { a, b, c, d, e, f };
    },
    save: () => stack.push({ ...matrix }),
    restore: () => { matrix = stack.pop() ?? identity(); },
    scale: (x: number, y: number) => multiply({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }),
    translate: (x: number, y: number) => multiply({ ...identity(), e: x, f: y }),
    rotate: (angle: number) => multiply({ a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: 0, f: 0 }),
  };
  const ctx = new Proxy<Record<string, unknown>>(methods, {
    get: (target, key: string) => target[key] ?? noop,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, drawImage };
}

function polygon(id: string, x: number, y: number, width = 300, height = 180): TerrainPolygon {
  return {
    id, material: 'rock', grass: true,
    points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }],
  };
}

function setup(terrain = [polygon('visible', 100, 100), polygon('distant', 2100, 100)]) {
  const bitmaps: HTMLCanvasElement[] = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
      const { ctx } = drawingContext();
      const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
      bitmaps.push(canvas);
      return canvas;
    },
  });
  const arena: Arena = {
    width: 7000, height: 3000, floorY: 2500, platforms: [],
    playerSpawn: { x: 0, y: 0 }, targetSpawn: { x: 20, y: 0 }, terrain,
  };
  const scene = new OutpostScenery(arena);
  return { scene, bitmaps, ...drawingContext() };
}

afterEach(() => vi.unstubAllGlobals());

describe('Outpost scenery bitmap lifecycle', () => {
  it('bakes only visible islands and reuses their bitmaps across stationary frames', () => {
    const { scene, ctx, bitmaps, drawImage } = setup();
    expect(bitmaps).toHaveLength(0);
    scene.background(ctx, { x: 0, y: 0 });
    expect(bitmaps).toHaveLength(0);
    for (let frame = 0; frame < 120; frame++) scene.draw(ctx, { x: 0, y: 0 }, { x: 600, y: 400 });
    expect(bitmaps).toHaveLength(1);
    expect(drawImage).toHaveBeenCalledTimes(120);
    expect(drawImage.mock.calls.every(call => call[0] === bitmaps[0])).toBe(true);

    drawImage.mockClear();
    scene.draw(ctx, { x: 2000, y: 0 }, { x: 600, y: 400 });
    expect(bitmaps).toHaveLength(2);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.calls[0][0]).toBe(bitmaps[1]);
  });

  it('increases backing resolution for a high-DPI zoom without changing logical island bounds', () => {
    const { scene, ctx, bitmaps, drawImage } = setup();
    scene.draw(ctx, { x: 0, y: 0 }, { x: 600, y: 400 });
    const logicalBounds = drawImage.mock.calls[0].slice(1);
    const [, , logicalWidth, logicalHeight] = logicalBounds as number[];
    expect(bitmaps[0].width).toBe(logicalWidth);
    expect(bitmaps[0].height).toBe(logicalHeight);

    // DPR 2 × 1.5 close zoom. Translation must not affect texture density.
    ctx.setTransform(3, 0, 0, 3, -120, -60);
    const before = ctx.getTransform();
    scene.draw(ctx, { x: 0, y: 0 }, { x: 600, y: 400 });
    expect(bitmaps).toHaveLength(2);
    expect(bitmaps[0].width).toBe(0);
    expect(bitmaps[0].height).toBe(0);
    expect(bitmaps[1].width).toBe(logicalWidth * 3);
    expect(bitmaps[1].height).toBe(logicalHeight * 3);
    expect(drawImage.mock.calls.at(-1)!.slice(1)).toEqual(logicalBounds);
    expect(ctx.getTransform()).toEqual(before);
  });

  it('rebuilds for a new zoom density and releases all retained bitmap storage on destroy', () => {
    const { scene, ctx, bitmaps, drawImage } = setup();
    ctx.setTransform(3, 0, 0, 3, 0, 0);
    scene.draw(ctx, { x: 0, y: 0 }, { x: 600, y: 400 });
    const closeBounds = drawImage.mock.calls[0].slice(1);

    // DPR 2 × 0.75 wide zoom needs two physical pixels per world pixel.
    ctx.setTransform(1.5, 0, 0, 1.5, 0, 0);
    scene.draw(ctx, { x: 0, y: 0 }, { x: 600, y: 400 });
    expect(bitmaps).toHaveLength(2);
    expect(bitmaps[0].width).toBe(0);
    expect(bitmaps[1].width).toBe(Number(closeBounds[2]) * 2);
    expect(drawImage.mock.calls.at(-1)!.slice(1)).toEqual(closeBounds);
    scene.draw(ctx, { x: 2000, y: 0 }, { x: 600, y: 400 });
    expect(bitmaps).toHaveLength(3);
    scene.destroy();
    scene.destroy();
    expect(bitmaps.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('evicts the least recently viewed offscreen texture before exceeding the cache budget', () => {
    const { scene, ctx, bitmaps, drawImage } = setup([
      polygon('west', 100, 100, 1200, 1200),
      polygon('middle', 2300, 100, 1200, 1200),
      polygon('east', 4500, 100, 1200, 1200),
    ]);
    ctx.setTransform(3, 0, 0, 3, 0, 0);
    const drawAt = (x: number) => scene.draw(ctx, { x, y: 0 }, { x: 1000, y: 1000 });
    drawAt(0);
    drawAt(2200);
    const [west, middle] = bitmaps;
    drawAt(0); // West is now more recent than middle.
    drawAt(4400);
    expect(bitmaps).toHaveLength(3);
    expect(west.width).toBeGreaterThan(0);
    expect(middle.width).toBe(0);
    expect(middle.height).toBe(0);
    expect(bitmaps[2].width).toBeGreaterThan(0);
    expect(bitmaps.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0)).toBeLessThanOrEqual(128 * 1024 * 1024);

    drawAt(0);
    expect(bitmaps).toHaveLength(3);
    expect(drawImage.mock.calls.at(-1)![0]).toBe(west);
    drawAt(2200);
    expect(bitmaps).toHaveLength(4);
    expect(bitmaps[2].width).toBe(0);
    expect(drawImage.mock.calls.at(-1)![0]).toBe(bitmaps[3]);
  });

  it('reduces raster density when currently visible islands would exceed the budget', () => {
    const { scene, ctx, bitmaps, drawImage } = setup([
      polygon('west', 100, 100, 1600, 1600), polygon('east', 2300, 100, 1600, 1600),
    ]);
    ctx.setTransform(3, 0, 0, 3, 0, 0);
    scene.draw(ctx, { x: 0, y: 0 }, { x: 4100, y: 2000 });
    expect(bitmaps).toHaveLength(2);
    expect(drawImage).toHaveBeenCalledTimes(2);
    for (const [bitmap, , , width, height] of drawImage.mock.calls) {
      expect(bitmap.width).toBe(width * 2);
      expect(bitmap.height).toBe(height * 2);
    }
    expect(bitmaps.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0)).toBeLessThanOrEqual(128 * 1024 * 1024);
  });
});
