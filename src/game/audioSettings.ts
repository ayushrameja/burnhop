export interface AudioSettings {
  masterVolume: number;
  musicVolume: number;
  weaponsVolume: number;
  movementVolume: number;
  uiVolume: number;
  feedbackVolume: number;
}

/** Linear gains from 0 (silent) to 1 (full volume). Each caller receives its own mix. */
export function defaultAudioSettings(): AudioSettings {
  return { masterVolume: 1, musicVolume: 0.1, weaponsVolume: 0.8, movementVolume: 0.85, uiVolume: 1, feedbackVolume: 0.8 };
}

/** Keep valid channels when a saved mix is incomplete or corrupt. */
export function normalizeAudioSettings(value: unknown): AudioSettings {
  const next = defaultAudioSettings();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return next;
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(next) as (keyof AudioSettings)[]) {
    const gain = source[key];
    if (typeof gain === 'number' && Number.isFinite(gain)) next[key] = Math.max(0, Math.min(1, gain));
  }
  return next;
}
