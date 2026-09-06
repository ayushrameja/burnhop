import { useEffect, useRef } from 'react';
import type { DetailedAppearance } from './game/appearance';
import { drawDancingCharacter } from './game/detailedCharacter';
import { DANCE_BEATS, DANCE_BPM } from './game/audioSynthesis';

export function danceBeat(seconds: number, reducedMotion = false): number {
  return reducedMotion ? 2.25 : ((Math.max(0, seconds) * DANCE_BPM / 60) % DANCE_BEATS);
}

/** One shared procedural pilot; no downloaded video, decoded sprites or gameplay simulation. */
export default function DancePilot({ appearance, reducedMotion, getDanceTime }: {
  appearance: DetailedAppearance; reducedMotion: boolean; getDanceTime: () => number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let width = 0, height = 0, density = 1, frame = 0, elapsed = 0, previous = 0, drawn = -Infinity;
    const draw = () => {
      context.setTransform(density, 0, 0, density, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!width || !height) return;
      const compact = width < 700;
      const x = width * (compact ? .53 : .745), y = height * (compact ? .49 : .8);
      const scale = Math.min(height / (compact ? 215 : 150), width / (compact ? 135 : 180));
      const beat = danceBeat(getDanceTime() ?? elapsed / 1000, reducedMotion);
      const shadow = context.createRadialGradient(x, y, 2, x, y, scale * 38);
      shadow.addColorStop(0, '#03080cab'); shadow.addColorStop(1, '#03080c00');
      context.save(); context.translate(x, y); context.scale(1, .18); context.fillStyle = shadow;
      context.translate(-x, -y); context.fillRect(x - scale * 40, y - scale * 40, scale * 80, scale * 80); context.restore();
      // A tiny field speaker makes the beat visible even with sound switched off.
      context.save(); context.translate(x - scale * 39, y - scale * 20); context.scale(scale, scale);
      context.fillStyle = '#1d292c'; context.strokeStyle = '#86908c'; context.lineWidth = .7;
      context.beginPath(); context.roundRect(0, 0, 15, 20, 1.4); context.fill(); context.stroke();
      for (const [cy, radius] of [[6, 3.3], [14, 4.4]]) {
        context.beginPath(); context.arc(7.5, cy, radius, 0, Math.PI * 2); context.fillStyle = '#0c171c'; context.fill();
        context.strokeStyle = '#5e706e'; context.stroke();
      }
      context.fillStyle = '#76e1e2'; context.globalAlpha = reducedMotion ? .65 : .5 + Math.max(0, Math.cos(beat * Math.PI * 2)) * .5;
      context.fillRect(11, 1.6, 1.5, 1); context.restore();
      drawDancingCharacter(context, x, y, scale, appearance, beat, reducedMotion);
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect(); width = bounds.width; height = bounds.height;
      density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * density)); canvas.height = Math.max(1, Math.round(height * density)); draw();
    };
    const animate = (time: number) => {
      if (document.hidden || reducedMotion) return;
      if (previous) elapsed += Math.min(time - previous, 100);
      previous = time;
      if (time - drawn >= 1000 / 30 - .5) { draw(); drawn = time; }
      frame = requestAnimationFrame(animate);
    };
    const visibility = () => { cancelAnimationFrame(frame); previous = 0;
      if (!document.hidden) { draw(); if (!reducedMotion) frame = requestAnimationFrame(animate); }
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    document.addEventListener('visibilitychange', visibility); resize();
    if (!reducedMotion && !document.hidden) frame = requestAnimationFrame(animate);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); cancelAnimationFrame(frame); };
  }, [appearance, reducedMotion, getDanceTime]);
  return <canvas ref={canvasRef} className="entry-dancer" aria-hidden="true" data-testid="entry-dancer" />;
}
