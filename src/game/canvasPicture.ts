/** Precompile static vector paths without allocating large transparent bitmap layers. */
export class CanvasPicture {
  private commands: ((ctx: CanvasRenderingContext2D) => void)[] = [];
  constructor(paint: (ctx: CanvasRenderingContext2D) => void) {
    let path = new Path2D();
    const pathMethods = new Set(['moveTo', 'lineTo', 'closePath', 'rect', 'roundRect', 'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo']);
    const recorder = new Proxy({}, {
      set: (_target, name: string, value: unknown) => {
        this.commands.push(ctx => { (ctx as unknown as Record<string, unknown>)[name] = value; }); return true;
      },
      get: (_target, name: string) => (...args: unknown[]) => {
        if (name === 'beginPath') { path = new Path2D(); return; }
        if (pathMethods.has(name)) {
          (path as unknown as Record<string, (...values: unknown[]) => void>)[name](...args); return;
        }
        if (name === 'fill' || name === 'stroke' || name === 'clip') {
          const saved = new Path2D(path);
          this.commands.push(ctx => ctx[name](saved)); return;
        }
        this.commands.push(ctx => (ctx as unknown as Record<string, (...values: unknown[]) => void>)[name](...args));
      },
    }) as CanvasRenderingContext2D;
    paint(recorder);
  }
  draw(ctx: CanvasRenderingContext2D): void { for (const command of this.commands) command(ctx); }
}
