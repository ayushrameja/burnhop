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
  type Request = { id: string; serial: number; resolution: number; x: number; y: number; width: number; height: number };
  const requests: Request[] = [], bitmaps: (ImageBitmap & { close: ReturnType<typeof vi.fn> })[] = [];
  const createElement = vi.fn(() => { throw new Error('Artwork must not bake on the main thread'); });
  vi.stubGlobal('document', { createElement });
  vi.stubGlobal('OffscreenCanvas', class {});
  let worker: FakeWorker;
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    constructor() { worker = this; }
    postMessage(request: Request) { requests.push(request); }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const arena: Arena = { width: 7000, height: 3000, floorY: 2500, platforms: [],
    playerSpawn: { x: 0, y: 0 }, targetSpawn: { x: 20, y: 0 }, terrain };
  const scene = new OutpostScenery(arena);
  const context = drawingContext();
  const finish = () => {
    const request = requests.shift()!;
    const bitmap = { width: Math.ceil(request.width * request.resolution), height: Math.ceil(request.height * request.resolution), close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
    bitmaps.push(bitmap);
    worker!.onmessage!({ data: { ...request, bitmap } });
    return { request, bitmap };
  };
  const drawAt = (x = 0, viewport = { x: 600, y: 400 }) => scene.draw(context.ctx, { x, y: 0 }, viewport);
  const settleAt = (x = 0, viewport = { x: 600, y: 400 }) => {
    for (let i = 0; i < 100; i++) { drawAt(x, viewport); if (!requests.length) break; finish(); }
  };
  return { scene, requests, bitmaps, finish, drawAt, settleAt, createElement, worker: () => worker!, ...context };
}
afterEach(() => vi.unstubAllGlobals());

describe('asynchronous Outpost artwork lifecycle', () => {
  it('keeps the collision silhouette visible while one worker paints, then reuses the result', () => {
    const f = setup();
    f.scene.warm(f.ctx, { x: 0, y: 0 }, { x: 600, y: 400 });
    expect(f.requests).toHaveLength(1); expect(f.drawImage).not.toHaveBeenCalled();
    for (let i = 0; i < 120; i++) f.drawAt();
    expect(f.requests).toHaveLength(1); expect(f.createElement).not.toHaveBeenCalled();
    const { request, bitmap } = f.finish();
    expect(request.id).toBe('visible');
    f.drawAt();
    expect(f.drawImage).toHaveBeenCalledWith(bitmap, request.x, request.y, request.width, request.height);
    f.settleAt();
    f.drawAt(); expect(f.requests).toHaveLength(0);
    f.scene.destroy(); expect(f.bitmaps.every(b => b.close.mock.calls.length === 1)).toBe(true);
    expect(f.scene.getDiagnostics().cacheBytes).toBe(0);
  });
  it('keeps a usable bitmap during a density upgrade, and reuses high density when zooming back out', () => {
    const f = setup(); f.settleAt();
    const original = f.bitmaps[0];
    f.ctx.setTransform(3, 0, 0, 3, -120, -60); f.drawImage.mockClear(); f.drawAt();
    expect(f.requests[0]).toMatchObject({ id: 'visible', resolution: 3 });
    expect(original.close).not.toHaveBeenCalled();
    expect(f.drawImage.mock.calls.some(call => call[0] === original)).toBe(true);
    const upgraded = f.finish(); expect(original.close).toHaveBeenCalledOnce();
    f.settleAt(); f.ctx.setTransform(1.5, 0, 0, 1.5, 0, 0); f.drawAt();
    expect(f.requests).toHaveLength(0); expect(upgraded.bitmap.close).not.toHaveBeenCalled();
    f.scene.setDetail('low'); f.drawAt();
    expect(f.requests[0]).toMatchObject({ id: 'visible', resolution: 1 });
    f.finish(); expect(upgraded.bitmap.close).toHaveBeenCalledOnce();
    f.scene.destroy();
  });
  it('discards a stale result after travel and closes late results after destruction', () => {
    const f = setup(); f.drawAt(); f.drawAt(4000);
    const stale = f.finish(); expect(stale.bitmap.close).toHaveBeenCalledOnce();
    f.drawAt(2000); f.scene.destroy();
    const late = f.finish(); expect(late.bitmap.close).toHaveBeenCalledOnce();
    expect(f.worker().terminate).toHaveBeenCalledOnce();
    expect(f.scene.getDiagnostics().cacheBytes).toBe(0);
  });
  it('bounds retained texture memory and evicts offscreen artwork during traversal', () => {
    const f = setup([polygon('west', 100, 100, 1200, 1200), polygon('middle', 2300, 100, 1200, 1200), polygon('east', 4500, 100, 1200, 1200)]);
    f.ctx.setTransform(3, 0, 0, 3, 0, 0);
    for (const x of [0, 2200, 4400, 0, 4400]) {
      f.settleAt(x, { x: 1000, y: 1000 });
      const retained = f.bitmaps.filter(b => !b.close.mock.calls.length).reduce((sum, b) => sum + b.width * b.height * 4, 0);
      expect(retained).toBeLessThanOrEqual(128 * 1024 * 1024);
      expect(f.scene.getDiagnostics().cacheBytes).toBe(retained);
    }
    expect(f.scene.getDiagnostics().evictions).toBeGreaterThan(0);
    f.scene.destroy();
  });
  it('reduces requested density when all visible terrain exceeds the budget', () => {
    const f = setup([polygon('west', 100, 100, 1600, 1600), polygon('east', 2300, 100, 1600, 1600)]);
    f.ctx.setTransform(3, 0, 0, 3, 0, 0); f.drawAt(0, { x: 4100, y: 2000 });
    expect(f.requests[0].resolution).toBeLessThan(3);
    f.scene.destroy();
  });
  it('falls back to playable vector geometry after a worker error without retrying every frame', () => {
    const f = setup(); f.drawAt(); f.worker().onerror!();
    for (let i = 0; i < 10; i++) f.drawAt();
    expect(f.scene.getDiagnostics().mode).toBe('fallback');
    expect(f.requests).toHaveLength(1); expect(f.createElement).not.toHaveBeenCalled();
    f.scene.destroy();
  });
});
