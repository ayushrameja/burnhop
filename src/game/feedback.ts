export interface FeedbackSettings {
  intensity: number;
  heartbeat: boolean;
}

export const defaultFeedbackSettings = (): FeedbackSettings => ({ intensity: 1, heartbeat: true });
export function normalizeFeedbackSettings(value: unknown): FeedbackSettings {
  const result = defaultFeedbackSettings();
  if (!value || typeof value !== 'object') return result;
  const input = value as Record<string, unknown>;
  if (typeof input.intensity === 'number' && Number.isFinite(input.intensity)) result.intensity = Math.max(0, Math.min(1, input.intensity));
  if (typeof input.heartbeat === 'boolean') result.heartbeat = input.heartbeat;
  return result;
}

/** Keep recovery at 30 HP from rapidly toggling a 25 HP warning. */
export function lowHealthActive(health: number, previous: boolean): boolean {
  return Number.isFinite(health) && health > 0 && (previous ? health <= 30 : health <= 25);
}

export interface FeedbackState { damage: number; kill: number; lowHealth: boolean }
export const emptyFeedback = (): FeedbackState => ({ damage: 0, kill: 0, lowHealth: false });
export function advanceFeedback(state: FeedbackState, dt: number, health: number): FeedbackState {
  const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  return { damage: Math.max(0, state.damage - elapsed), kill: Math.max(0, state.kill - elapsed),
    lowHealth: lowHealthActive(health, state.lowHealth) };
}
export function feedbackOpacity(state: FeedbackState, time: number, intensity: number, reducedMotion: boolean) {
  const amount = Math.max(0, Math.min(1, intensity));
  const warning = state.lowHealth ? (reducedMotion ? .05 : .07 + .02 * Math.sin(time * Math.PI * 2)) : 0;
  const red = Math.max(warning, .18 * Math.min(1, state.damage / .24));
  // Incoming damage wins; a blue kill confirmation never dilutes the warning.
  return { red: red * amount, blue: state.damage > 0 ? 0 : .12 * Math.min(1, state.kill / .3) * amount };
}
