import { useEffect, useRef } from 'react';
import { advanceFeedback, emptyFeedback, feedbackOpacity } from './game/feedback';
import './combat-feedback.css';

/** Cosmetic envelopes consume confirmed event counters, never infer a kill from damage. */
export default function CombatFeedback({ health, damagePulse, killPulse, reducedMotion, intensity = 1, active = true }: {
  health: number; damagePulse: number; killPulse: number; reducedMotion: boolean; intensity?: number; active?: boolean;
}) {
  const red = useRef<HTMLDivElement>(null), blue = useRef<HTMLDivElement>(null);
  const state = useRef(emptyFeedback());
  const latest = useRef({ health, reducedMotion, intensity, active });
  latest.current = { health, reducedMotion, intensity, active };
  const previous = useRef({ damagePulse, killPulse });
  useEffect(() => {
    if (active) {
      if (damagePulse > previous.current.damagePulse) state.current.damage = .24;
      if (killPulse > previous.current.killPulse) state.current.kill = .3;
    }
    previous.current = { damagePulse, killPulse };
  }, [damagePulse, killPulse, active, health]);
  useEffect(() => {
    let frame = 0, previousTime = 0;
    const clear = () => {
      state.current = emptyFeedback();
      if (red.current) red.current.style.opacity = '0';
      if (blue.current) blue.current.style.opacity = '0';
    };
    const draw = (time: number) => {
      const props = latest.current;
      if (!props.active || document.hidden) { clear(); previousTime = 0; }
      else {
        state.current = advanceFeedback(state.current, previousTime ? (time - previousTime) / 1000 : 0, props.health);
        const opacity = feedbackOpacity(state.current, time / 1000, props.intensity, props.reducedMotion);
        if (red.current) red.current.style.opacity = String(opacity.red);
        if (blue.current) blue.current.style.opacity = String(opacity.blue);
        previousTime = time;
      }
      frame = requestAnimationFrame(draw);
    };
    const visibility = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); clear(); };
  }, []);
  return <div className="combat-feedback" aria-hidden="true" data-testid="combat-feedback">
    <div ref={red} className="combat-feedback-edge combat-feedback-damage" />
    <div ref={blue} className="combat-feedback-edge combat-feedback-kill" />
  </div>;
}
