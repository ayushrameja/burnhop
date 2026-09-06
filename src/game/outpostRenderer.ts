import type { Arena, Vec2 } from './types';
import type { Detail } from './graphics';
import { OutpostArtwork, type ArtworkRequest } from './outpostArtwork';

type Surface = ArtworkRequest & { bitmap: ImageBitmap | null; used: number; priority: number; wanted: number };
const TEXTURE_BUDGET = 128 * 1024 * 1024;
const overlaps = (s: ArtworkRequest, camera: Vec2, viewport: Vec2, margin = 0) =>
  s.x + s.width >= camera.x - margin && s.x <= camera.x + viewport.x + margin
  && s.y + s.height >= camera.y - margin && s.y <= camera.y + viewport.y + margin;

/** Bounded artwork cache. Expensive texture painting never runs in a gameplay frame. */
export class OutpostScenery {
  private surfaces: Surface[] = [];
  private artwork = new OutpostArtwork();
  private worker: Worker | null = null;
  private unavailable = false;
  private disposed = false;
  private frame = 0;
  private serial = 0;
  private pending: { surface: Surface; serial: number } | null = null;
  private detail: Detail = 'high';
  private bytes = 0;
  private completed = 0;
  private evictions = 0;
  constructor(arena: Arena) {
    const add = (request: ArtworkRequest) => this.surfaces.push({ ...request, bitmap: null, used: 0, priority: 2, wanted: 1 });
    for (const [index, terrain] of (arena.terrain ?? []).entries()) {
      const xs = terrain.points.map(p => p.x), ys = terrain.points.map(p => p.y);
      const x = Math.floor(Math.min(...xs)) - 12, y = Math.floor(Math.min(...ys)) - 18;
      add({ id: terrain.id, terrain, index, x, y,
        width: Math.ceil(Math.max(...xs)) - x + 12, height: Math.ceil(Math.max(...ys)) - y + 12, resolution: 0 });
    }
  }
  setDetail(detail: Detail): void { this.detail = detail; }
  getDiagnostics() {
    return { mode: this.unavailable ? 'fallback' : 'worker', cacheBytes: this.bytes, budgetBytes: TEXTURE_BUDGET,
      readyTextures: this.surfaces.filter(s => s.bitmap).length, preparedTextures: this.completed, evictions: this.evictions,
      pendingTextures: this.surfaces.filter(s => s.priority < 2 && this.needsTexture(s)).length };
  }
  destroy(): void {
    this.disposed = true; this.worker?.terminate(); this.worker = null; this.pending = null;
    for (const s of this.surfaces) this.release(s);
  }
  private release(s: Surface): void {
    if (s.bitmap) { this.bytes -= s.bitmap.width * s.bitmap.height * 4; s.bitmap.close(); }
    s.bitmap = null; s.resolution = 0;
  }
  private needsTexture(s: Surface): boolean {
    return !s.bitmap || s.resolution < s.wanted || s.resolution > (this.detail === 'low' ? 1 : this.detail === 'medium' ? 2 : 3);
  }
  private prepare(ctx: CanvasRenderingContext2D, camera: Vec2, viewport: Vec2): void {
    this.frame++;
    const transform = ctx.getTransform();
    const cap = this.detail === 'low' ? 1 : this.detail === 'medium' ? 2 : 3;
    let resolution = Math.min(cap, Math.max(1, Math.ceil(Math.hypot(transform.a, transform.b))));
    const visible = this.surfaces.filter(s => overlaps(s, camera, viewport));
    const area = (r: number) => visible.reduce((sum, s) => sum + s.width * s.height * 4 * r ** 2, 0);
    while (resolution > 1 && area(resolution) > TEXTURE_BUDGET) resolution--;
    for (const s of this.surfaces) {
      s.priority = overlaps(s, camera, viewport) ? 0 : overlaps(s, camera, viewport, 240) ? 1 : 2;
      if (s.priority === 0) s.used = this.frame;
      s.wanted = resolution;
    }
    this.dispatch();
  }
  /** Lobby preparation uses the same queue as camera look-ahead, without painting. */
  warm(ctx: CanvasRenderingContext2D, camera: Vec2, viewport: Vec2): void { this.prepare(ctx, camera, viewport); }
  private dispatch(): void {
    if (this.disposed || this.unavailable || this.pending) return;
    if (!this.worker) {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') { this.unavailable = true; return; }
      try {
        this.worker = new Worker(new URL('./outpost.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }: MessageEvent<{ serial: number; resolution: number; bitmap?: ImageBitmap; error?: boolean }>) => {
          const pending = this.pending;
          if (!pending || data.serial !== pending.serial || this.disposed) { data.bitmap?.close(); return; }
          this.pending = null;
          if (data.error || !data.bitmap) { this.failWorker(); return; }
          const s = pending.surface;
          if (s.priority === 2 || !this.reserve(data.bitmap.width * data.bitmap.height * 4, s)) data.bitmap.close();
          else {
            this.release(s); s.bitmap = data.bitmap; s.resolution = data.resolution;
            this.bytes += data.bitmap.width * data.bitmap.height * 4; this.completed++;
          }
          // Yield to the next camera/lobby update after an allocation cannot fit.
          // This also prevents a rejected texture being immediately requested again.
        };
        this.worker.onerror = () => this.failWorker();
        this.worker.onmessageerror = () => this.failWorker();
      } catch { this.failWorker(); return; }
    }
    const candidates = this.surfaces.filter(s => s.priority < 2 && this.needsTexture(s))
      .sort((a, b) => a.priority - b.priority || Number(!!a.bitmap) - Number(!!b.bitmap));
    const candidate = candidates.find(s => this.reserve(s.width * s.height * s.wanted * s.wanted * 4, s));
    if (!candidate) return;
    this.pending = { surface: candidate, serial: ++this.serial };
    const { bitmap: _bitmap, priority: _priority, wanted, used: _used, ...recipe } = candidate;
    try { this.worker!.postMessage({ ...recipe, resolution: wanted, serial: this.serial }); }
    catch { this.failWorker(); }
  }
  private failWorker(): void {
    this.worker?.terminate(); this.worker = null; this.pending = null; this.unavailable = true;
  }
  private reserve(bytes: number, replacement: Surface): boolean {
    const previous = replacement.bitmap ? replacement.bitmap.width * replacement.bitmap.height * 4 : 0;
    for (const s of this.surfaces.filter(s => s.bitmap && s !== replacement && s.priority !== 0).sort((a, b) => a.used - b.used)) {
      if (this.bytes - previous + bytes <= TEXTURE_BUDGET) break;
      this.release(s); this.evictions++;
    }
    return this.bytes - previous + bytes <= TEXTURE_BUDGET;
  }
  background(ctx: CanvasRenderingContext2D, camera: Vec2): void { this.artwork.background(ctx, camera); }
  draw(ctx: CanvasRenderingContext2D, camera: Vec2, viewport: Vec2): void {
    this.prepare(ctx, camera, viewport);
    this.artwork.decoration(ctx);
    for (const s of this.surfaces) {
      if (s.priority !== 0) continue;
      if (s.bitmap) ctx.drawImage(s.bitmap, s.x, s.y, s.width, s.height);
      else this.fallbackTerrain(ctx, s);
    }
    this.artwork.decoration(ctx, true);
  }

  private fallbackTerrain(ctx: CanvasRenderingContext2D, s: Surface): void {
    // The exact collision contour remains visible while texture detail arrives.
    const terrain = s.terrain;
    ctx.beginPath(); ctx.moveTo(terrain.points[0].x, terrain.points[0].y);
    for (let i = 1; i < terrain.points.length; i++) ctx.lineTo(terrain.points[i].x, terrain.points[i].y);
    ctx.closePath(); ctx.fillStyle = terrain.material === 'rock' ? '#98947c' : terrain.material === 'wood' ? '#ac996b' : '#a3a79c'; ctx.fill();
    ctx.strokeStyle = '#3e483a'; ctx.lineWidth = 3; ctx.stroke();
  }
}
