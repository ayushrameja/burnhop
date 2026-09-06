import { expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { createMatch, addPlayer } from './match';
import { OUTPOST_ARENA } from './model';
import { PlayerWire, playerFromWire, syncPlayerWire } from './wire';

it('reuses immutable cosmetics across prediction and invalidates on changed wire appearance', () => {
  const actor = addPlayer(createMatch('test'), { id: 'me', nickname: 'Pilot', appearance: DEFAULT_APPEARANCE }, OUTPOST_ARENA);
  const wire = new PlayerWire(); syncPlayerWire(wire, actor);
  const first = playerFromWire(wire);
  expect(Object.isFrozen(first.appearance)).toBe(true);
  wire.x += 50;
  expect(playerFromWire(wire).appearance).toBe(first.appearance);
  const mirror = new PlayerWire(); syncPlayerWire(mirror, first);
  expect(mirror.appearance).toBe(wire.appearance);
  wire.appearance = JSON.stringify({ ...first.appearance, topColor: 'rust' });
  expect(playerFromWire(wire).appearance.topColor).toBe('rust');
  expect(playerFromWire(wire).appearance).not.toBe(first.appearance);
  wire.appearance = 'invalid';
  expect(() => playerFromWire(wire)).not.toThrow();
});
