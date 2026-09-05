import { useEffect, useRef } from 'react';

interface EntryLandscapeProps {
  reducedMotion: boolean;
}

const TAU = Math.PI * 2;

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Star {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  phase: number;
}

const random = seededRandom(4816);
const stars: Star[] = Array.from({ length: 155 }, () => ({
  x: random(),
  y: random() * .58,
  radius: .35 + random() * .65,
  opacity: .16 + random() * .46,
  phase: random() * TAU,
}));

const wind = Array.from({ length: 24 }, () => ({
  x: random(),
  y: .66 + random() * .32,
  length: .035 + random() * .14,
  speed: .008 + random() * .013,
  phase: random() * TAU,
  opacity: .025 + random() * .075,
}));

/** The long exposure landscape is painted once at each viewport size. */
function paintLandscape(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#060b16');
  sky.addColorStop(.36, '#101c2c');
  sky.addColorStop(.61, '#293b4b');
  sky.addColorStop(.76, '#43525a');
  sky.addColorStop(1, '#101a24');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const moonX = width * .72;
  const moonY = height * .235;
  const moonRadius = Math.min(width, height) * .026;
  const glow = ctx.createRadialGradient(moonX, moonY, moonRadius, moonX, moonY, height * .35);
  glow.addColorStop(0, '#c1d6e618');
  glow.addColorStop(.12, '#a9c8e20b');
  glow.addColorStop(.45, '#8eb3ce05');
  glow.addColorStop(1, '#8eb3ce00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // A faint veil at the horizon gives the ridgelines distance and scale.
  const air = ctx.createRadialGradient(width * .62, height * .60, 0, width * .62, height * .60, width * .7);
  air.addColorStop(0, '#81929a0c');
  air.addColorStop(.48, '#81929a03');
  air.addColorStop(1, '#81929a00');
  ctx.save();
  ctx.translate(0, height * .48);
  ctx.scale(1, .22);
  ctx.translate(0, -height * .48);
  ctx.fillStyle = air;
  ctx.fillRect(0, -height, width, height * 4);
  ctx.restore();

  // Moon shading and low-contrast mare details avoid a flat white disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonRadius, 0, TAU);
  ctx.clip();
  const lunarSurface = ctx.createRadialGradient(
    moonX + moonRadius * .42, moonY - moonRadius * .38, 0,
    moonX + moonRadius * .22, moonY - moonRadius * .18, moonRadius * 1.55,
  );
  lunarSurface.addColorStop(0, '#e4e6d9');
  lunarSurface.addColorStop(.58, '#bdc7c7');
  lunarSurface.addColorStop(1, '#738895');
  ctx.fillStyle = lunarSurface;
  ctx.fillRect(moonX - moonRadius, moonY - moonRadius, moonRadius * 2, moonRadius * 2);
  const craterRandom = seededRandom(720);
  for (let index = 0; index < 42; index++) {
    const x = moonX + (craterRandom() - .5) * moonRadius * 2;
    const y = moonY + (craterRandom() - .5) * moonRadius * 2;
    const radius = moonRadius * (.025 + craterRandom() * .22);
    const crater = ctx.createRadialGradient(x, y, 0, x, y, radius);
    crater.addColorStop(0, '#425c6b24');
    crater.addColorStop(.55, '#52677513');
    crater.addColorStop(1, '#52677500');
    ctx.fillStyle = crater;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.restore();

  // The distant rocks have small irregular edges; near dunes remain sweeping.
  const drawMountains = (base: number, amplitude: number, color: string, phase: number) => {
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width + 4; x += 4) {
      const unit = x / width;
      const shape = Math.sin(unit * 12 + phase) * .48
        + Math.sin(unit * 31 + phase) * .25
        + Math.sin(unit * 77 + phase) * .10
        + Math.sin(unit * 163 + phase) * .035;
      ctx.lineTo(x, height * (base + shape * amplitude));
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  drawMountains(.618, .019, '#32434f', 1.1);
  drawMountains(.653, .029, '#2b3c49', 4.2);

  type Ridge = (x: number) => number;
  const drawDune = (ridge: Ridge, top: string, bottom: string, highlight: string, seed: number) => {
    const edge = new Path2D();
    for (let x = -4; x <= width + 4; x += 4) {
      const y = height * ridge(x / width);
      if (x === -4) edge.moveTo(x, y);
      else edge.lineTo(x, y);
    }
    const body = new Path2D(edge);
    body.lineTo(width + 4, height + 4);
    body.lineTo(-4, height + 4);
    body.closePath();
    const sand = ctx.createLinearGradient(width * .66, height * .58, width * .38, height);
    sand.addColorStop(0, top);
    sand.addColorStop(1, bottom);
    ctx.fillStyle = sand;
    ctx.fill(body);

    ctx.save();
    ctx.clip(body);
    const rippleRandom = seededRandom(seed);
    // Broken, unevenly spaced contour marks suggest fine wind-shaped sand.
    for (let index = 0; index < 105; index++) {
      const offset = .003 + (index / 105) ** 1.65 * .36;
      const start = rippleRandom() * 1.2 - .1;
      const length = .018 + rippleRandom() * .2;
      ctx.beginPath();
      for (let segment = 0; segment <= 24; segment++) {
        const x = start + length * segment / 24;
        const y = ridge(x) + offset + Math.sin(x * 38 + index * .3) * .0014;
        if (segment === 0) ctx.moveTo(x * width, y * height);
        else ctx.lineTo(x * width, y * height);
      }
      ctx.lineWidth = .4 + offset * 2;
      ctx.strokeStyle = `rgba(154, 177, 190, ${.015 + rippleRandom() * .028})`;
      ctx.stroke();
    }
    ctx.restore();

    ctx.lineWidth = .8;
    ctx.strokeStyle = highlight;
    ctx.stroke(edge);
  };

  const distant: Ridge = x => .704 + Math.sin(x * 5.6 + .3) * .021 + Math.sin(x * 14) * .006;
  const middle: Ridge = x => .777 - Math.exp(-(((x - .80) / .33) ** 2)) * .097
    + Math.sin(x * 8 + .2) * .011;
  const sweeping: Ridge = x => .817 - Math.exp(-(((x - .19) / .28) ** 2)) * .086
    + Math.sin(x * 5.5 + 1) * .012;
  const foreground: Ridge = x => .91 - Math.exp(-(((x - 1.08) / .54) ** 2)) * .129
    + Math.sin(x * 6.5) * .015;

  drawDune(distant, '#42525e', '#243540', '#82929c28', 18);
  drawDune(middle, '#52636e', '#1a2a37', '#afbdc544', 75);
  drawDune(sweeping, '#374a59', '#121f2b', '#8ca5b938', 195);
  drawDune(foreground, '#293b4b', '#08131f', '#8aa3b72d', 408);

  // A little photographic grain keeps the large gradients from feeling sterile.
  const grainRandom = seededRandom(5820);
  for (let index = 0; index < 12000; index++) {
    const x = grainRandom() * width;
    const y = grainRandom() * height;
    ctx.fillStyle = grainRandom() > .5 ? '#bed0dc08' : '#0108140c';
    ctx.fillRect(x, y, .65, .65);
  }

  const vignette = ctx.createRadialGradient(
    width * .55, height * .43, Math.min(width, height) * .25,
    width * .5, height * .5, Math.max(width, height) * .72,
  );
  vignette.addColorStop(0, '#02071200');
  vignette.addColorStop(.62, '#02071210');
  vignette.addColorStop(1, '#02071280');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export default function EntryLandscape({ reducedMotion }: EntryLandscapeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;
    const scenery = document.createElement('canvas');
    const sceneryCtx = scenery.getContext('2d', { alpha: false });
    if (!sceneryCtx) return;

    let width = 0;
    let height = 0;
    let ratio = 1;
    let animation = 0;
    let elapsed = 0;
    let previousFrame: number | null = null;
    let disposed = false;

    const draw = () => {
      if (!width || !height || disposed) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.drawImage(scenery, 0, 0, width, height);
      const time = reducedMotion ? 0 : elapsed / 1000;

      for (const star of stars) {
        // Stars disappear into the brighter atmosphere near the horizon.
        const atmosphericFade = Math.min(1, (.59 - star.y) / .18);
        const twinkle = .88 + Math.sin(time * .26 + star.phase) * .12;
        ctx.globalAlpha = star.opacity * atmosphericFade * twinkle;
        ctx.fillStyle = '#d2deeb';
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height, star.radius, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (const gust of wind) {
        const progress = (gust.x + time * gust.speed) % 1;
        const x = (progress * 1.45 - .25) * width;
        const y = (gust.y + Math.sin(time * .14 + gust.phase) * .004) * height;
        const length = gust.length * width;
        const opacity = gust.opacity * Math.sin(progress * Math.PI) ** 2;
        const gradient = ctx.createLinearGradient(x, y, x + length, y);
        gradient.addColorStop(0, '#bdcfdb00');
        gradient.addColorStop(.4, `rgba(189, 207, 219, ${opacity})`);
        gradient.addColorStop(1, '#bdcfdb00');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = .6 + (gust.y - .66) * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + length * .35, y - height * .003,
          x + length * .75, y + height * .002, x + length, y - height * .001);
        ctx.stroke();
      }
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = scenery.width = Math.max(1, Math.round(width * ratio));
      canvas.height = scenery.height = Math.max(1, Math.round(height * ratio));
      sceneryCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (width && height) paintLandscape(sceneryCtx, width, height);
      draw();
    };

    const animate = (now: number) => {
      if (disposed || document.hidden || reducedMotion) return;
      if (previousFrame !== null) elapsed += Math.min(now - previousFrame, 100);
      previousFrame = now;
      draw();
      animation = requestAnimationFrame(animate);
    };

    const visibility = () => {
      cancelAnimationFrame(animation);
      previousFrame = null;
      if (!document.hidden) {
        draw();
        if (!reducedMotion) animation = requestAnimationFrame(animate);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener('visibilitychange', visibility);
    resize();
    if (!reducedMotion && !document.hidden) animation = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      cancelAnimationFrame(animation);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="entry-landscape" role="img" aria-label="Moonlit desert with drifting wind" />;
}
