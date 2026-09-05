import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { neutralInput } from '../multiplayer/model';
import { allowedOrigins, invitationCode, isAllowedOrigin, normalizeNickname, RateLimiter, sanitizeInput, validateAppearance, validateJoinOptions } from './security';
import { idleInput, InputRateBudget } from './inputPolicy';

describe('guest admission and resource limits', () => {
  it('only allows the exact production origin and explicit previews; localhost is development-only', () => {
    const production = { NODE_ENV: 'production', ALLOWED_PREVIEW_ORIGINS: 'https://burnhop-qa.vercel.app' };
    expect(isAllowedOrigin('https://burnhop.lowhp.studio', production)).toBe(true);
    expect(isAllowedOrigin('https://burnhop-qa.vercel.app', production)).toBe(true);
    for (const origin of [undefined, 'null', 'https://evil.vercel.app', 'https://burnhop.lowhp.studio.evil.test', 'http://localhost:5173', 'https://burnhop.lowhp.studio/']) {
      expect(isAllowedOrigin(origin, production)).toBe(false);
    }
    expect(isAllowedOrigin('http://localhost:5173', { NODE_ENV: 'development' })).toBe(true);
    expect(() => allowedOrigins({ ALLOWED_PREVIEW_ORIGINS: 'https://*.vercel.app/path' })).toThrow();
  });

  it('requires compatible versions, bounded visible names and validated cosmetic recipes', () => {
    expect(normalizeNickname('  Ayush   R  ')).toBe('Ayush R');
    expect(normalizeNickname('किरण')).toBe('किरण');
    for (const name of ['', 'x', '<script>', 'player\u0000', 'x'.repeat(21)]) expect(() => normalizeNickname(name)).toThrow();
    expect(validateAppearance(DEFAULT_APPEARANCE)).toEqual(DEFAULT_APPEARANCE);
    expect(() => validateAppearance({ health: 1000 })).toThrow();
    expect(() => validateAppearance({ top: 'invisible' })).toThrow();
    expect(() => validateJoinOptions({ compatibility: 'old', nickname: 'Ayush' }, 'new')).toThrow(/update/i);
  });

  it('bounds anonymous buckets and refills with time, never backwards time', () => {
    const limiter = new RateLimiter(2, 1, 2);
    expect(limiter.take('ip', 1000)).toBe(true); expect(limiter.take('ip', 1000)).toBe(true);
    expect(limiter.take('ip', 1000)).toBe(false); expect(limiter.take('ip', 500)).toBe(false);
    expect(limiter.take('ip', 1500)).toBe(true);
  });

  it('creates unpredictable case-insensitive invitation codes', () => {
    const codes = new Set(Array.from({ length: 100 }, invitationCode));
    expect(codes.size).toBe(100);
    for (const code of codes) expect(code).toMatch(/^[A-F0-9]{20}$/);
  });

  it('sanitizes non-finite and out-of-range input before simulation', () => {
    const input = neutralInput();
    Object.assign(input, { moveX: 127, aimAngle: NaN, inputId: -8, jumpPressed: 'true' });
    sanitizeInput(input);
    expect(input.moveX).toBe(0); expect(input.aimAngle).toBe(0); expect(input.inputId).toBe(0); expect(input.jumpPressed).toBe(false);
    input.aimAngle = 5 * Math.PI; sanitizeInput(input);
    expect(Math.abs(input.aimAngle)).toBeCloseTo(Math.PI);
    input.aimAngle = .7135123123; sanitizeInput(input);
    expect(input.aimAngle).toBe(.7135123123); // Honest input must retain exact replay arithmetic.
  });

  it('bridges at most 100 ms of input jitter without repeating shots, jump taps or reloads', () => {
    const command = { ...neutralInput(1, 10), moveX: 1 as const, jumpPressed: true, jumpHeld: true,
      jetPressed: true, jetHeld: true, jetSeparate: true, fireHeld: true, reloadPressed: true };
    const bridged = idleInput(command, 1, 6, true);
    expect(bridged.moveX).toBe(1); expect(bridged.jetHeld).toBe(true);
    expect(bridged.jumpPressed).toBe(false); expect(bridged.jetPressed).toBe(false);
    expect(bridged.fireHeld).toBe(false); expect(bridged.reloadPressed).toBe(false);
    expect(idleInput(command, 1, 7, true)).toEqual(neutralInput(1, 10));
    expect(idleInput(command, 1, 1, false)).toEqual(neutralInput(1, 10));
  });

  it('accepts legitimately paced input bunched by TCP and rejects a sustained excessive cadence', () => {
    const budget = new InputRateBudget(0);
    expect(budget.accept(0, 2000)).toBe(true);
    expect(budget.accept(180, 2000)).toBe(true); // Three seconds delivered together.
    for (let second = 1; second <= 30; second++) {
      expect(budget.accept(180 + second * 60, 2000 + second * 1000)).toBe(true);
    }
    const attacker = new InputRateBudget(0);
    let accepted = true;
    for (let second = 1; second <= 20; second++) accepted = attacker.accept(second * 180, second * 1000);
    expect(accepted).toBe(false);
  });
});
