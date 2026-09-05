/** Shared local bounds include vertical aim, articulated limbs and boot exhaust. */
const BOUNDS = { x: -64, y: -112, width: 128, height: 144 };
const FLASH_COLOR = '#fff3db';
const FLASH_OPACITY = .78;

interface FlashSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  density: number;
}

// Each destination retains its surface. A hit never decodes art or creates a
// canvas per frame; a larger preview only grows its existing surface as needed.
const surfaces = new WeakMap<CanvasRenderingContext2D, FlashSurface>();

/**
 * Tint the rendered silhouette, including image-based cosmetics and outlines.
 * drawLocal must draw the normal character at (0, 0), with scale 1 and hit false.
 * Source-atop keeps the transparent surroundings transparent, so nearby scenery
 * and other characters are never included in this character's hit flash.
 */
export function drawCharacterHitFlash(
  ctx: CanvasRenderingContext2D, x: number, y: number, scale: number,
  drawLocal: (context: CanvasRenderingContext2D) => void,
) {
  let surface = surfaces.get(ctx);
  if (!surface) {
    const canvas = ctx.canvas.ownerDocument.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      ctx.save();ctx.translate(x, y);ctx.scale(scale, scale);drawLocal(ctx);ctx.restore();
      return;
    }
    surface = { canvas, context, density: 0 };
    surfaces.set(ctx, surface);
  }

  const transform = ctx.getTransform();
  const density = Math.max(1, Math.ceil(Math.abs(scale) * Math.max(
    Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d),
  )));
  if (density > surface.density) {
    surface.density = density;
    surface.canvas.width = BOUNDS.width * density;
    surface.canvas.height = BOUNDS.height * density;
  }

  const buffer = surface.context;
  buffer.save();
  buffer.resetTransform();
  buffer.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
  buffer.setTransform(surface.density, 0, 0, surface.density, -BOUNDS.x * surface.density, -BOUNDS.y * surface.density);
  drawLocal(buffer);
  buffer.resetTransform();
  buffer.globalCompositeOperation = 'source-atop';
  buffer.globalAlpha = FLASH_OPACITY;
  buffer.fillStyle = FLASH_COLOR;
  buffer.fillRect(0, 0, surface.canvas.width, surface.canvas.height);
  buffer.restore();

  ctx.save();ctx.translate(x, y);ctx.scale(scale, scale);
  ctx.drawImage(surface.canvas, BOUNDS.x, BOUNDS.y, BOUNDS.width, BOUNDS.height);
  ctx.restore();
}
