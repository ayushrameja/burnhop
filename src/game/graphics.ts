export type Detail = 'low' | 'medium' | 'high';
export interface GraphicsSettings {
  renderScale: .5 | .75 | 1;
  frameRate: 0 | 60 | 120;
  scenery: Detail;
  effects: Detail;
}
export type GraphicsPreset = 'low' | 'balanced' | 'high';
export const GRAPHICS_PRESETS: Readonly<Record<GraphicsPreset, Readonly<GraphicsSettings>>> = {
  low: Object.freeze({ renderScale: .5, frameRate: 60, scenery: 'low', effects: 'low' }),
  balanced: Object.freeze({ renderScale: .75, frameRate: 60, scenery: 'medium', effects: 'medium' }),
  high: Object.freeze({ renderScale: 1, frameRate: 0, scenery: 'high', effects: 'high' }),
};
export const defaultGraphics = (): GraphicsSettings => ({ ...GRAPHICS_PRESETS.balanced });
export function normalizeGraphics(value: unknown): GraphicsSettings {
  const result = defaultGraphics();
  if (!value || typeof value !== 'object') return result;
  const v = value as Record<string, unknown>;
  if (v.renderScale === .5 || v.renderScale === .75 || v.renderScale === 1) result.renderScale = v.renderScale;
  if (v.frameRate === 0 || v.frameRate === 60 || v.frameRate === 120) result.frameRate = v.frameRate;
  for (const key of ['scenery', 'effects'] as const) {
    if (v[key] === 'low' || v[key] === 'medium' || v[key] === 'high') result[key] = v[key];
  }
  return result;
}
export function graphicsPreset(value: GraphicsSettings): GraphicsPreset | 'custom' {
  return (Object.keys(GRAPHICS_PRESETS) as GraphicsPreset[]).find(key => {
    const preset = GRAPHICS_PRESETS[key];
    return preset.renderScale === value.renderScale && preset.frameRate === value.frameRate
      && preset.scenery === value.scenery && preset.effects === value.effects;
  }) ?? 'custom';
}

/** Gates drawing only. The caller must continue simulation, input and audio on skipped frames. */
export class FramePacer {
  private next = 0;
  private rate = 0;
  reset(): void { this.next = 0; }
  shouldDraw(now: number, rate: GraphicsSettings['frameRate']): boolean {
    if (rate !== this.rate) { this.rate = rate; this.reset(); }
    if (!rate) return true;
    const interval = 1000 / rate;
    if (!this.next) { this.next = now + interval; return true; }
    // Browser timestamps vary slightly around an exact refresh boundary.
    if (now + .5 < this.next) return false;
    this.next += Math.max(1, Math.floor((now + .5 - this.next) / interval) + 1) * interval;
    return true;
  }
}
