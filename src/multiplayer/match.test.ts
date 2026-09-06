import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { CONFIG, compileArena, getWeaponOrigin } from '../game/simulation';
import type { Arena } from '../game/types';
import { addPlayer, createMatch, removePlayer, returnToLobby, selectSpawn, setConnected, setReady, startCountdown, stepMatch } from './match';
import { MATCH_CONFIG, OUTPOST_ARENA, neutralInput, type MatchState, type NetworkInput } from './model';

const arena: Arena = { width: 2000, height: 1000, floorY: 600, platforms: [],
  playerSpawn: { x: 100, y: 532 }, targetSpawn: { x: 400, y: 532 },
  spawnPoints: [{ id: 'west', x: 100, y: 532 }, { id: 'east', x: 1600, y: 532 }, { id: 'middle', x: 800, y: 532 }] };
const guest = (id: string) => ({ id, nickname: `Player ${id}`, appearance: { ...DEFAULT_APPEARANCE } });
function lobby(count = 2, map = arena): MatchState {
  const state = createMatch('K8RTY9Q2');
  for (let i = 0; i < count; i++) addPlayer(state, guest(String(i)), map);
  return state;
}
function playing(count = 2, map = arena): MatchState {
  const state = lobby(count, map);
  for (const p of Object.values(state.players)) setReady(state, p.id, true);
  expect(startCountdown(state, '0')).toBe(true);
  for (let i = 0; i < MATCH_CONFIG.countdownTicks; i++) stepMatch(state, {}, map);
  return state;
}
const input = (changes: Partial<NetworkInput> = {}): NetworkInput => ({ ...neutralInput(), ...changes });
function faceOff(state: MatchState) {
  Object.assign(state.players['0'], { x: 200, y: 532, aimAngle: 0, protectionTicks: 0 });
  Object.assign(state.players['1'], { x: 400, y: 532, aimAngle: Math.PI, protectionTicks: 0 });
}

describe('multiplayer match lifecycle', () => {
  it('admits eight players, rejects a ninth, and keeps cosmetic choices off the hitbox', () => {
    const state = lobby(8);
    expect(() => addPlayer(state, guest('8'), arena)).toThrow('Room is full');
    expect(state.players['7'].width).toBe(CONFIG.bodyWidth);
    expect(state.players['7'].height).toBe(CONFIG.bodyHeight);
    expect(state.hostId).toBe('0');
  });
  it('requires two connected players, everyone ready, and the current host', () => {
    const state = lobby(1); setReady(state, '0', true);
    expect(startCountdown(state, '0')).toBe(false);
    addPlayer(state, guest('1'), arena);
    expect(startCountdown(state, '0')).toBe(false);
    setReady(state, '1', true);
    expect(startCountdown(state, '1')).toBe(false);
    expect(startCountdown(state, '0')).toBe(true);
    expect(() => addPlayer(state, guest('2'), arena)).toThrow('Match in progress');
  });
  it('counts exactly three seconds and starts every player with full resources', () => {
    const state = lobby();
    for (const p of Object.values(state.players)) { setReady(state, p.id, true); p.health = 1; p.fuel = 3; p.weapon.ammo = 0; }
    startCountdown(state, '0');
    for (let i = 0; i < 179; i++) stepMatch(state, {}, arena);
    expect(state.phase).toBe('countdown'); expect(state.countdownTicks).toBe(1);
    const events = stepMatch(state, {}, arena);
    expect(state.phase).toBe('playing'); expect(state.remainingTicks).toBe(18_000);
    expect(events.filter(e => e.type === 'targetRespawn')).toHaveLength(2);
    for (const p of Object.values(state.players)) {
      expect(p).toMatchObject({ health: 100, fuel: 100, lifeId: 1, protectionTicks: 60 });
      expect(p.weapon).toMatchObject({ weaponId: 'pistol', ammo: 12, reserve: -1, reloadTicks: 0, cooldownTicks: 0 });
    }
  });
  it.each(['unready', 'disconnect'] as const)('cancels countdown on %s', action => {
    const state = lobby(); setReady(state, '0', true); setReady(state, '1', true); startCountdown(state, '0');
    if (action === 'unready') setReady(state, '1', false); else setConnected(state, '1', false);
    expect(state.phase).toBe('lobby'); expect(state.countdownTicks).toBe(0);
  });
  it('transfers host by continuous connection time and puts a returning guest after existing peers', () => {
    const state = playing(3);
    setConnected(state, '0', false);
    expect(state.hostId).toBe('1'); expect(state.phase).toBe('playing');
    setConnected(state, '0', true); expect(state.hostId).toBe('1');
    expect(state.players['0'].joinedOrder).toBeGreaterThan(state.players['2'].joinedOrder);
    removePlayer(state, '1'); expect(state.hostId).toBe('2');
  });
  it('keeps reserved slots occupied but explicit departure immediately frees them', () => {
    const state = lobby(8); setConnected(state, '7', false);
    expect(() => addPlayer(state, guest('8'), arena)).toThrow('Room is full');
    removePlayer(state, '7'); expect(addPlayer(state, guest('8'), arena).connected).toBe(true);
  });
  it('expires after exactly five minutes, computes draws, and prevents results combat', () => {
    const state = playing(); faceOff(state);
    for (let i = 0; i < MATCH_CONFIG.durationTicks - 1; i++) stepMatch(state, {}, arena);
    expect(state.phase).toBe('playing'); expect(state.remainingTicks).toBe(1);
    stepMatch(state, {}, arena);
    expect(state.phase).toBe('results'); expect(state.winnerIds).toEqual(['0', '1']);
    const ammo = state.players['0'].weapon.ammo;
    expect(stepMatch(state, { '0': input({ fireHeld: true }) }, arena)).toEqual([]);
    expect(state.players['0'].weapon.ammo).toBe(ammo);
  });
  it('selects kills as the winning score and permits only the host to reset the lobby', () => {
    const state = playing(3); state.remainingTicks = 1;
    state.players['1'].kills = 4; state.players['2'].kills = 4; state.players['0'].deaths = 1;
    stepMatch(state, {}, arena); expect(state.winnerIds).toEqual(['1', '2']);
    expect(returnToLobby(state, '1', arena)).toBe(false);
    expect(returnToLobby(state, '0', arena)).toBe(true);
    expect(state.code).toBe('K8RTY9Q2'); expect(state.phase).toBe('lobby');
    for (const p of Object.values(state.players)) expect(p).toMatchObject({ ready: false, kills: 0, deaths: 0 });
    expect(addPlayer(state, guest('3'), arena)).toBeDefined();
  });
});

describe('spawn, movement and neutral connections', () => {
  it('selects the farthest valid spawn with stable authored-order ties', () => {
    const state = lobby(); state.players['1'].health = 0;
    expect(selectSpawn(state, '0', arena)).toEqual({ x: 100, y: 532 });
    state.players['1'].health = 100; state.players['1'].x = 100;
    expect(selectSpawn(state, '0', arena)).toEqual({ x: 1600, y: 532 });
    const blocked = { ...arena, platforms: [{ x: 1600, y: 520, width: 50, height: 50 }] };
    expect(selectSpawn(state, '0', blocked)).toEqual({ x: 800, y: 532 });
  });
  it('uses all eight authored Outpost spawns without overlapping map terrain', () => {
    const state = playing(8, OUTPOST_ARENA);
    expect(new Set(Object.values(state.players).map(p => `${p.x},${p.y}`)).size).toBe(8);
    expect(compileArena(OUTPOST_ARENA)).toBe(compileArena(OUTPOST_ARENA));
  });
  it('allows players to pass through one another while preserving terrain collision', () => {
    const state = playing(); faceOff(state); state.players['1'].x = 280;
    for (let tick = 0; tick < 60; tick++) stepMatch(state, { '0': input({ moveX: 1 }), '1': input({ moveX: -1 }) }, arena);
    expect(state.players['0'].x).toBeGreaterThan(state.players['1'].x);
    expect(state.players['0'].y + state.players['0'].height).toBe(arena.floorY);
  });
  it('neutralizes a disconnected actor while leaving it vulnerable', () => {
    const state = playing(); faceOff(state); setConnected(state, '1', false);
    state.players['1'].health = 18;
    const events = stepMatch(state, { '0': input({ fireHeld: true }), '1': input({ fireHeld: true, jumpPressed: true }) }, arena);
    expect(events.filter(e => e.type === 'shot').map(e => e.actorId)).toEqual(['0']);
    expect(state.players['1'].health).toBe(0); expect(state.players['0'].kills).toBe(1);
    for (let i = 0; i < 300; i++) stepMatch(state, {}, arena);
    expect(state.players['1'].health).toBe(0); expect(state.players['1'].respawnTicks).toBe(0);
    setConnected(state, '1', true); stepMatch(state, {}, arena);
    expect(state.players['1'].health).toBe(100); expect(state.players['1'].lifeId).toBe(2);
  });
  it('counts falling as a death with no kill and respawns exactly two seconds later', () => {
    const openMap = { ...arena, openFloor: true, platforms: [{ x: 0, y: 600, width: 1800, height: 100 }] };
    const state = playing(2, openMap); state.players['0'].y = 1001;
    stepMatch(state, {}, openMap);
    expect(state.players['0']).toMatchObject({ health: 0, deaths: 1, respawnTicks: 120 });
    expect(state.players['1'].kills).toBe(0);
    for (let i = 0; i < 119; i++) stepMatch(state, {}, openMap);
    expect(state.players['0'].health).toBe(0);
    stepMatch(state, {}, openMap);
    expect(state.players['0']).toMatchObject({ health: 100, lifeId: 2, protectionTicks: 60 });
  });
  it('grants one second of protection and cancels it immediately on firing', () => {
    const state = playing(); faceOff(state); state.players['1'].protectionTicks = 60;
    expect(stepMatch(state, { '0': input({ fireHeld: true }) }, arena).filter(e => e.type === 'hit')).toHaveLength(0);
    for (let i = 0; i < 59; i++) stepMatch(state, {}, arena);
    expect(state.players['1'].protectionTicks).toBe(0);
    state.players['1'].protectionTicks = 60;
    stepMatch(state, { '1': input({ fireHeld: true, aimAngle: Math.PI }) }, arena);
    expect(state.players['1'].protectionTicks).toBe(0);
  });
});

describe('authoritative hitscan and bounded-history contract', () => {
  it('supports same-tick trades without depending on shooter iteration order', () => {
    const state = playing(); faceOff(state); state.players['0'].health = 18; state.players['1'].health = 18;
    const events = stepMatch(state, { '0': input({ fireHeld: true, inputId: 10 }), '1': input({ fireHeld: true, aimAngle: Math.PI, inputId: 20 }) }, arena);
    expect(Object.values(state.players).map(p => [p.health, p.kills, p.deaths])).toEqual([[0, 1, 1], [0, 1, 1]]);
    const hits = events.filter(e => e.type === 'hit');
    expect(hits.map(e => [e.actorId, e.targetId])).toEqual([['0', '1'], ['1', '0']]);
    expect(hits[0].shotId).toBe(`0:1:${state.players['0'].weapon.instanceId}:main:1`);
    expect(new Set(events.map(e => e.id)).size).toBe(events.length);
  });
  it('cancels protection on firing even when rewind history still contains the old shield', () => {
    const state = playing(); faceOff(state);
    state.players['0'].health = 18; state.players['1'].health = 18;
    state.players['0'].protectionTicks = 60; state.players['1'].protectionTicks = 60;
    const history = Object.fromEntries(Object.values(state.players).map(p => [p.id, { ...p }]));
    stepMatch(state, { '0': input({ fireHeld: true }), '1': input({ fireHeld: true, aimAngle: Math.PI }) }, arena,
      (_shooter, target) => history[target.id]);
    expect(state.players['0'].health).toBe(0); expect(state.players['1'].health).toBe(0);
  });
  it('does not permit fire-held or message bursts to bypass weapon cooldown', () => {
    const state = playing(); faceOff(state); let shots = 0;
    for (let tick = 0; tick < 60; tick++) shots += stepMatch(state, { '0': input({ fireHeld: true, inputId: tick }) }, arena).filter(e => e.type === 'shot').length;
    expect(shots).toBe(5); expect(state.players['0'].weapon.ammo).toBe(7);
  });
  it('clips hits to terrain and gives cover exact-distance ties', () => {
    const state = playing(); faceOff(state);
    const wall = { ...arena, platforms: [{ x: 400, y: 500, width: 30, height: 100 }] };
    const events = stepMatch(state, { '0': input({ fireHeld: true }) }, wall);
    expect(events.some(e => e.type === 'hit')).toBe(false);
    expect(state.players['1'].health).toBe(100);
    expect(events.find(e => e.type === 'shot')).toMatchObject({ hit: false, toX: 400 });
  });
  it('uses historical position and crouch height while keeping current target life authoritative', () => {
    const state = playing(); faceOff(state); state.players['1'].y = 300;
    const history = { x: 400, y: 532, width: 36, height: 68, lifeId: 1, health: 100, protectionTicks: 0 };
    const events = stepMatch(state, { '0': input({ fireHeld: true }) }, arena, () => history);
    expect(events.some(e => e.type === 'hit')).toBe(true); expect(state.players['1'].health).toBe(82);
    state.players['0'].weapon.cooldownTicks = 0;
    const crouched = { ...history, y: 580, height: 20 };
    expect(stepMatch(state, { '0': input({ fireHeld: true }) }, arena, () => crouched).some(e => e.type === 'hit')).toBe(false);
  });
  it('rejects stale-life, dead-history and unavailable-history targets', () => {
    for (const sample of [null, { lifeId: 0, health: 100 }, { lifeId: 1, health: 0 }]) {
      const state = playing(); faceOff(state);
      const events = stepMatch(state, { '0': input({ fireHeld: true }) }, arena, () => sample && ({ ...state.players['1'], ...sample }));
      expect(events.some(e => e.type === 'hit')).toBe(false); expect(state.players['1'].health).toBe(100);
    }
  });
  it('cannot rewind through terrain even when a historical target is on the other side', () => {
    const state = playing(); faceOff(state); state.players['1'].y = 300;
    const wall = { ...arena, platforms: [{ x: 300, y: 500, width: 20, height: 100 }] };
    const historical = { ...state.players['1'], x: 400, y: 532 };
    expect(stepMatch(state, { '0': input({ fireHeld: true }) }, wall, () => historical).some(e => e.type === 'hit')).toBe(false);
    expect(getWeaponOrigin(state.players['0']).x).toBeLessThan(300);
  });
});
