import { randomBytes } from 'node:crypto';
import { normalizeAppearance, type DetailedAppearance } from '../game/appearance';
import type { NetworkInput } from '../multiplayer/model';

export const GAME_ORIGIN = 'https://burnhop.lowhp.studio';
export const MAX_REQUEST_BYTES = 4096;

export function allowedOrigins(environment: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const origins = new Set([GAME_ORIGIN]);
  for (const entry of (environment.ALLOWED_PREVIEW_ORIGINS ?? '').split(',')) {
    if (!entry.trim()) continue;
    const url = new URL(entry.trim());
    if (url.protocol !== 'https:' || url.origin !== entry.trim()) throw new Error('Preview origins must be exact HTTPS origins.');
    origins.add(url.origin);
  }
  return origins;
}

export function isAllowedOrigin(origin: string | undefined | null, environment: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin || origin === 'null') return false;
  if (allowedOrigins(environment).has(origin)) return true;
  if (environment.NODE_ENV === 'production') return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export function invitationCode(): string {
  // 80 bits, URL-safe, case-insensitive and practical to copy or type.
  return randomBytes(10).toString('hex').toUpperCase();
}

export function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Choose a nickname.');
  const nickname = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if ([...nickname].length < 2 || [...nickname].length > 20 || /[\p{C}<>]/u.test(nickname)) {
    throw new Error('Use a nickname with 2–20 visible characters.');
  }
  return nickname;
}

export function validateAppearance(value: unknown): DetailedAppearance {
  if (value === undefined) return normalizeAppearance(undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid appearance.');
  if (JSON.stringify(value).length > 2048) throw new Error('Invalid appearance.');
  const normalized = normalizeAppearance(value);
  for (const [key, selected] of Object.entries(value)) {
    if (!Object.hasOwn(normalized, key) || normalized[key as keyof DetailedAppearance] !== selected) {
      throw new Error('Update your saved appearance before joining.');
    }
  }
  return normalized;
}

/** Names/recipes are validated before room allocation as well as at socket admission. */
export function validateJoinOptions(options: unknown, compatibility: string): { nickname: string; appearance: DetailedAppearance } {
  if (!options || typeof options !== 'object') throw new Error('Invalid room request.');
  const value = options as Record<string, unknown>;
  if (value.compatibility !== compatibility) throw new Error('Game update available. Refresh Burnhop before joining.');
  return { nickname: normalizeNickname(value.nickname), appearance: validateAppearance(value.appearance) };
}

export function sanitizeInput(input: NetworkInput): void {
  input.moveX = input.moveX === -1 || input.moveX === 1 ? input.moveX : 0;
  if (!Number.isFinite(input.aimAngle)) input.aimAngle = 0;
  else if (input.aimAngle < -Math.PI || input.aimAngle > Math.PI) input.aimAngle = Math.atan2(Math.sin(input.aimAngle), Math.cos(input.aimAngle));
  if (!Number.isSafeInteger(input.inputId) || input.inputId < 0 || input.inputId > 0xffff_ffff) input.inputId = 0;
  for (const key of ['jumpPressed', 'jumpHeld', 'jetPressed', 'jetHeld', 'jetSeparate', 'crouchHeld', 'fireHeld', 'reloadPressed'] as const) {
    input[key] = input[key] === true;
  }
}

/** Fixed-memory token buckets. Slow clients sharing an IP still get a generous join burst. */
export class RateLimiter {
  private entries = new Map<string, { tokens: number; time: number }>();
  constructor(private capacity: number, private refillPerSecond: number, private maxKeys = 4096) {}
  take(key: string, now = Date.now()): boolean {
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value!);
      entry = { tokens: this.capacity, time: now }; this.entries.set(key, entry);
    }
    entry.tokens = Math.min(this.capacity, entry.tokens + Math.max(0, now - entry.time) * this.refillPerSecond / 1000);
    entry.time = now;
    if (entry.tokens < 1) return false;
    entry.tokens--;
    return true;
  }
  delete(key: string): void { this.entries.delete(key); }
}
