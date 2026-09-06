import type { DetailedAppearance } from './appearance';

interface Head { appearance: DetailedAppearance; source: DetailedAppearance; canvas: HTMLCanvasElement; density: number }
const BOUNDS = { x: -32, y: -42, width: 68, height: 66 };
const BUDGET = 8 * 1024 * 1024;

/** Cache only rigid head artwork. Aim, limbs, reload and muzzle geometry remain live. */
export class CharacterParts {
  private heads = new Map<DetailedAppearance, Head>();
  private bytes = 0;
  drawHead(ctx: CanvasRenderingContext2D, appearance: DetailedAppearance, paint: (ctx: CanvasRenderingContext2D) => void): void {
    // Inert test contexts and non-DOM callers retain the vector path.
    if (!ctx.canvas?.ownerDocument) { paint(ctx); return; }
    const matrix = ctx.getTransform();
    const density = Math.min(4, Math.max(1, Math.ceil(Math.hypot(matrix.a, matrix.b))));
    let head = this.heads.get(appearance);
    if (head && (head.density < density || (Object.keys(appearance) as (keyof DetailedAppearance)[]).some(key => head!.appearance[key] !== appearance[key]))) {
      this.release(head); head = undefined;
    }
    if (!head) {
      const canvas = ctx.canvas.ownerDocument.createElement('canvas');
      canvas.width = BOUNDS.width * density; canvas.height = BOUNDS.height * density;
      const buffer = canvas.getContext('2d');
      if (!buffer) { paint(ctx); return; }
      buffer.setTransform(density, 0, 0, density, -BOUNDS.x * density, -BOUNDS.y * density);
      buffer.lineCap = 'round'; buffer.lineJoin = 'round'; paint(buffer);
      const bytes = canvas.width * canvas.height * 4;
      while (this.bytes + bytes > BUDGET && this.heads.size) this.release(this.heads.values().next().value!);
      head = { appearance: { ...appearance }, source: appearance, canvas, density };
      this.heads.set(appearance, head); this.bytes += bytes;
    } else {
      this.heads.delete(appearance); this.heads.set(appearance, head);
    }
    ctx.drawImage(head.canvas, BOUNDS.x, BOUNDS.y, BOUNDS.width, BOUNDS.height);
  }
  private release(head: Head): void {
    this.bytes -= head.canvas.width * head.canvas.height * 4;
    head.canvas.width = head.canvas.height = 0; this.heads.delete(head.source);
  }
  destroy(): void { for (const head of this.heads.values()) this.release(head); }
  get cacheBytes(): number { return this.bytes; }
}
