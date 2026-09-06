import { describe, expect, it } from 'vitest';
import { advanceFeedback, emptyFeedback, feedbackOpacity, lowHealthActive, normalizeFeedbackSettings } from './feedback';

describe('restrained local feedback', () => {
  it('uses low-health hysteresis and never warns for a dead or invalid health state', () => {
    expect(lowHealthActive(25, false)).toBe(true);
    expect(lowHealthActive(26, false)).toBe(false);
    expect(lowHealthActive(30, true)).toBe(true);
    for (const health of [31, 0, -1, NaN]) expect(lowHealthActive(health, true)).toBe(false);
  });
  it('prioritizes incoming damage, bounds stacked hits and preserves lethal-hit/trade cues while stopping low-health warning', () => {
    const state = { damage: .24, kill: .3, lowHealth: false };
    expect(feedbackOpacity(state, 0, 1, false)).toEqual({ red: .18, blue: 0 });
    const settled = advanceFeedback(state, .25, 50);
    expect(feedbackOpacity(settled, 0, 1, false).blue).toBeGreaterThan(0);
    expect(advanceFeedback({ ...state, lowHealth: true }, 0, 0)).toEqual(state);
    expect(advanceFeedback(state, .31, 0)).toEqual(emptyFeedback());
    expect(feedbackOpacity({ ...state, damage: 99 }, 0, 1, false).red).toBe(.18);
    expect(feedbackOpacity(state, 0, 0, false)).toEqual({ red: 0, blue: 0 });
  });
  it('holds reduced-motion low-health feedback still and normalizes older/corrupt preferences', () => {
    const state = { damage: 0, kill: 0, lowHealth: true };
    expect(feedbackOpacity(state, 0, 1, true)).toEqual(feedbackOpacity(state, .8, 1, true));
    expect(normalizeFeedbackSettings(undefined)).toEqual({ intensity: 1, heartbeat: true });
    expect(normalizeFeedbackSettings({ intensity: -3, heartbeat: false })).toEqual({ intensity: 0, heartbeat: false });
    expect(normalizeFeedbackSettings({ intensity: NaN })).toEqual({ intensity: 1, heartbeat: true });
  });
});
