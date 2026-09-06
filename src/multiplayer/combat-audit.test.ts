import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { compileArena, createWorld, getWeaponOrigin, stepSimulation } from '../game/simulation';
import type { Arena } from '../game/types';
import { createWeapon, WEAPONS, weaponRandom } from '../game/weapons';
import { addPlayer, createMatch, stepMatch } from './match';
import { neutralInput } from './model';

const arena: Arena = { width: 2400, height: 1000, floorY: 600, platforms: [],
  playerSpawn: { x: 100, y: 532 }, targetSpawn: { x: 650, y: 532 } };
function match() {
  const state = createMatch('AUDIT');
  for (const id of ['a', 'b', 'c']) {
    const p = addPlayer(state, { id, nickname: id, appearance: DEFAULT_APPEARANCE }, arena);
    p.lifeId = 1; p.x = id === 'a' ? 100 : id === 'b' ? 650 : 1000;
  }
  state.phase = 'playing';
  return state;
}

describe('combat authority edge conditions', () => {
  it.each(['rectangle', 'polygon'] as const)('keeps historical and practice targets exactly flush with %s cover blocked across spread angles', shape => {
    const map: Arena = { ...arena, ...(shape === 'rectangle'
      ? { platforms: [{ x: 400, y: 0, width: 40, height: 600 }] }
      : { terrain: [{ id: 'wall', material: 'rock', points: [{ x: 400, y: 0 }, { x: 440, y: 0 }, { x: 440, y: 600 }, { x: 400, y: 600 }] }] }) };
    const wall = compileArena(map);
    const leaks: number[] = [];
    const practiceLeaks: number[] = [];
    for (let i = 0; i < 128; i++) {
      const state = match();
      state.players.a.weapon = createWeapon('ak47', `cover:${i}`);
      const events = stepMatch(state, { a: { ...neutralInput(), fireHeld: true } }, wall,
        (_shooter, target) => ({ ...target, x: 400 }));
      if (events.some(e => e.type === 'hit')) leaks.push(i);
      const practice = createWorld(map); practice.target.x = 400;
      practice.player.weapon = createWeapon('ak47', `cover:${i}`);
      const practiceEvents = stepSimulation(practice, { tick: 0, actorId: 'player', ...neutralInput(), fireHeld: true }, map);
      if (practiceEvents.some(e => e.type === 'hit')) practiceLeaks.push(i);
    }
    expect(leaks).toEqual([]);
    expect(practiceLeaks).toEqual([]);
  });

  it.each([{ fraction: .25, region: 'body', damage: 28 }, { fraction: .7, region: 'legs', damage: 21 }])(
    'uses the lower-damage $region seam and lets a measurably exposed target beat cover', ({ fraction, region, damage }) => {
      const map: Arena = { ...arena, terrain: [{ id: 'wall', material: 'rock', points:
        [{ x: 400, y: 0 }, { x: 440, y: 0 }, { x: 440, y: 600 }, { x: 400, y: 600 }] }] };
      for (const gap of [0, .001]) {
        const state = match(), weapon = createWeapon('ak47', 'seam'); state.players.a.weapon = weapon;
        const aimAngle = -(weaponRandom(weapon.instanceId, 1, 0) * 2 - 1) * WEAPONS.ak47.spreadDegrees * Math.PI / 180;
        const command = { ...neutralInput(aimAngle), fireHeld: true };
        const target = { x: 400 - gap, y: getWeaponOrigin(state.players.a).y - state.players.b.height * fraction };
        const events = stepMatch(state, { a: command }, map, (_shooter, player) => ({ ...player, ...target }));
        const practice = createWorld(map); practice.player.weapon = createWeapon('ak47', 'seam'); Object.assign(practice.target, target);
        const practiceEvents = stepSimulation(practice, { tick: 0, actorId: 'player', ...command }, map);
        for (const shots of [events, practiceEvents]) {
          const hit = shots.find(e => e.type === 'hit');
          if (gap === 0) expect(hit).toBeUndefined();
          else expect(hit).toMatchObject({ region, damage });
        }
      }
    });

  it('a protected nearest body blocks bullets from damaging the player behind it', () => {
    const state = match(); state.players.b.x = 260; state.players.c.x = 400; state.players.b.protectionTicks = 60;
    const events = stepMatch(state, { a: { ...neutralInput(), fireHeld: true } }, arena);
    expect(events.find(e => e.type === 'shot')).toMatchObject({ hit: false, targetId: 'b' });
    expect(events.some(e => e.type === 'hit')).toBe(false);
    expect(state.players.b.health).toBe(100); expect(state.players.c.health).toBe(100);
  });

  it('opposing punches trade and cancel shields at windup without hitting a distant bystander', () => {
    const state = match(); state.players.b.x = 145; state.players.c.x = 1000;
    state.players.a.health = 20; state.players.b.health = 20;
    state.players.a.protectionTicks = 60; state.players.b.protectionTicks = 60;
    stepMatch(state, { a: { ...neutralInput(), punchPressed: true }, b: { ...neutralInput(Math.PI), punchPressed: true } }, arena);
    expect(state.players.a.protectionTicks).toBe(0); expect(state.players.b.protectionTicks).toBe(0);
    for (let i = 0; i < 6; i++) stepMatch(state, {}, arena);
    expect([state.players.a.health, state.players.b.health]).toEqual([0, 0]);
    expect([state.players.a.kills, state.players.b.kills]).toEqual([1, 1]);
    expect(state.players.c.health).toBe(100);
  });
});
