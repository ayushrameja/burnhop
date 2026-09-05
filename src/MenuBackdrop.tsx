import { useEffect, useRef } from 'react';
import type { DetailedAppearance } from './game/appearance';
import type { CharacterPose } from './game/character';
import { drawDetailedCharacter } from './game/detailedCharacter';

interface MenuBackdropProps {
  appearance: DetailedAppearance;
  reducedMotion: boolean;
}

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

function polygon(ctx: CanvasRenderingContext2D, color: string | CanvasGradient, points: number[]) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fill();
}

/** Architectural scenery is cached; only the pilot animates. */
function drawHangar(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const floor = height * .77;
  const wall = ctx.createLinearGradient(0, 0, width, height * .45);
  wall.addColorStop(0, '#111416');
  wall.addColorStop(.52, '#252b2d');
  wall.addColorStop(1, '#414645');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, width, height);

  // A single broad opening behind the pilot establishes the scene's depth.
  const opening = ctx.createLinearGradient(width * .58, 0, width, 0);
  opening.addColorStop(0, '#303637');
  opening.addColorStop(.58, '#74776e');
  opening.addColorStop(1, '#a5a69a');
  polygon(ctx, opening, [
    width * .58, height * .06, width * .95, -height * .12,
    width * .95, floor, width * .58, floor,
  ]);
  polygon(ctx, '#373c3c', [
    width * .65, height * .02, width * .70, 0,
    width * .70, floor, width * .65, floor,
  ]);
  polygon(ctx, '#d1d0bb', [
    width * .89, 0, width * .923, 0,
    width * .923, floor, width * .89, floor,
  ]);
  ctx.fillStyle = '#505650';
  ctx.fillRect(width * .935, 0, width * .016, floor);

  // Recessed ceiling and heavy diagonal supports, without decorative UI marks.
  polygon(ctx, '#161b1e', [0, 0, width, 0, width, height * .09, width * .50, height * .20, 0, height * .12]);
  polygon(ctx, '#1e2426', [
    width * .44, 0, width * .48, 0, width * .60, floor,
    width * .565, floor,
  ]);
  polygon(ctx, '#7d3835', [
    width * .50, height * .12, width * .548, height * .105,
    width * .62, floor, width * .587, floor,
  ]);
  polygon(ctx, '#a84d43', [
    width * .548, height * .105, width * .553, height * .104,
    width * .625, floor, width * .62, floor,
  ]);
  polygon(ctx, '#202629', [width * .975, 0, width, 0, width, floor, width * .975, floor]);

  const ground = ctx.createLinearGradient(0, floor, 0, height);
  ground.addColorStop(0, '#383e3c');
  ground.addColorStop(.33, '#242a2a');
  ground.addColorStop(1, '#111719');
  ctx.fillStyle = ground;
  ctx.fillRect(0, floor, width, height - floor);
  ctx.strokeStyle = '#9b9e8524';
  ctx.lineWidth = 1;
  for (const bottom of [.32, .74, 1.18]) {
    ctx.beginPath();
    ctx.moveTo(width * .72, floor);
    ctx.lineTo(width * bottom, height);
    ctx.stroke();
  }
  ctx.strokeStyle = '#0d141652';
  for (const row of [.84, .96]) {
    ctx.beginPath();
    ctx.moveTo(0, height * row);
    ctx.lineTo(width, height * row);
    ctx.stroke();
  }
  polygon(ctx, '#b6ad8c35', [
    width * .864, floor, width * .89, floor,
    width * .973, height, width * .936, height,
  ]);

  const haze = ctx.createRadialGradient(width * .82, height * .35, 0, width * .82, height * .35, height * .7);
  haze.addColorStop(0, '#ded6b822');
  haze.addColorStop(1, '#ded6b800');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, width, height);

  // The left side remains deliberately quiet for the menu's typography.
  const quiet = ctx.createLinearGradient(0, 0, width, 0);
  quiet.addColorStop(0, '#0c1115f5');
  quiet.addColorStop(.27, '#0c1115e8');
  quiet.addColorStop(.48, '#0c111599');
  quiet.addColorStop(.72, '#0c111508');
  quiet.addColorStop(1, '#0c111520');
  ctx.fillStyle = quiet;
  ctx.fillRect(0, 0, width, height);
}

export default function MenuBackdrop({ appearance, reducedMotion }: MenuBackdropProps) {
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

      const time = reducedMotion ? 7 : elapsed / 1000;
      const cycle = time % 16;
      const forward = smooth(cycle / 6);
      const back = smooth((cycle - 11) / 5);
      const travel = forward - back;
      const walking = reducedMotion ? 0 : cycle < 6
        ? smooth(cycle / .8) * (1 - smooth((cycle - 5.2) / .8))
        : smooth((cycle - 11) / .8) * (1 - smooth((cycle - 15.2) / .8));
      const direction = cycle < 6 ? 1 : -1;
      const aim = .10 - smooth((cycle - 5.3) / 1.2) * .20 + smooth((cycle - 10) / 1.2) * .20;
      const shotAge = Math.min(...[7.15, 8.6, 10.05].map(shot => cycle >= shot ? cycle - shot : Infinity));
      const recoil = reducedMotion || shotAge > .18 ? 0 : (1 - shotAge / .18) * .65;
      const scale = Math.min(height / 150, width / 112);
      const pilotX = width * .715 + (travel - .5) * Math.min(width * .045, 70);
      const pilotY = height * .853;
      const pose: CharacterPose = {
        aimAngle: aim,
        crouchAmount: .035 * (1 - walking),
        locomotion: true,
        moving: walking > .01,
        walkAmount: walking,
        moveSpeed: direction * 320,
        walkPhase: time * 10.5,
        recoil,
        time,
        reducedMotion,
      };

      const shadow = ctx.createRadialGradient(pilotX, pilotY + 5, 0, pilotX, pilotY + 5, scale * 32);
      shadow.addColorStop(0, '#070b0ca6');
      shadow.addColorStop(1, '#070b0c00');
      ctx.save();
      ctx.translate(pilotX, pilotY + 5);
      ctx.scale(1, .18);
      ctx.translate(-pilotX, -pilotY - 5);
      ctx.fillStyle = shadow;
      ctx.fillRect(pilotX - scale * 35, pilotY - scale * 35, scale * 70, scale * 70);
      ctx.restore();

      // The production vector renderer needs no decoded image assets.
      drawDetailedCharacter(ctx, pilotX, pilotY, scale, pose, appearance);

      const vignette = ctx.createLinearGradient(0, 0, 0, height);
      vignette.addColorStop(0, '#09101435');
      vignette.addColorStop(.34, '#09101400');
      vignette.addColorStop(.78, '#09101400');
      vignette.addColorStop(1, '#0910149c');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = scenery.width = Math.max(1, Math.round(width * ratio));
      canvas.height = scenery.height = Math.max(1, Math.round(height * ratio));
      sceneryCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (width && height) drawHangar(sceneryCtx, width, height);
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
  }, [appearance, reducedMotion]);

  return <canvas ref={canvasRef} className="menu-backdrop" role="img" aria-label="Pilot training in the hangar" />;
}
