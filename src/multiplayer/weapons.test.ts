import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { compileArena } from '../game/simulation';
import { createWeapon, equipWeapon } from '../game/weapons';
import type { Arena } from '../game/types';
import { addPlayer, createMatch, setReady, startCountdown, stepMatch } from './match';
import { MATCH_CONFIG, neutralInput } from './model';
import { advancePickups, collectPickups, dropWeapons, PICKUP_CONFIG, pickupDistance } from './pickups';
import { PlayerWire, playerFromWire, syncPlayerWire } from './wire';
import { stepPredictedActor } from './prediction';

const arena: Arena = { width: 2400, height: 900, floorY: 600, platforms: [],
  playerSpawn: { x: 100, y: 532 }, targetSpawn: { x: 1800, y: 532 },
  spawnPoints: [{ id: 'a', x: 100, y: 532 }, { id: 'b', x: 1800, y: 532 }],
  pickupPads: [200, 500, 800, 1100, 1400, 1700].map((x, i) => ({ id: `pad${i}`, x, y: 600, kind: 'ordinary' as const }))
    .concat([{ id: 'supply', x: 1200, y: 600, kind: 'sniper' as never }]) };
const map = compileArena(arena);
function playing() {
  const state = createMatch('COMBAT');
  for (const id of ['a', 'b']) { addPlayer(state, { id, nickname: id, appearance: DEFAULT_APPEARANCE }, arena); setReady(state, id, true); }
  startCountdown(state, 'a');
  for (let i = 0; i < 180; i++) stepMatch(state, {}, map);
  for (const p of Object.values(state.players)) p.protectionTicks = 0;
  return state;
}

describe('authoritative acquisition and equipment', () => {
  it('starts with one of every ordinary weapon and unique pistol lives', () => {
    const state = playing();
    expect(Object.values(state.pickups).map(p => p.weapon.weaponId).sort()).toEqual(['ak47', 'm416', 'pistol', 'revolver', 'ump', 'uzi']);
    expect(state.players.a.weapon.instanceId).not.toBe(state.players.b.weapon.instanceId);
    expect(state.players.a.weapon.ammo).toBe(12);
  });
  it('atomically awards a contested pickup to the nearest player, then stable roster order', () => {
    const state = playing(), pickup = state.pickups.pad0, instanceId = pickup.weapon.instanceId;
    state.players.a.x = 162; state.players.b.x = 182;
    collectPickups(state, { a: { ...neutralInput(), pickupPressed: true }, b: { ...neutralInput(), pickupPressed: true } }, map, []);
    expect(state.players.b.weapon.instanceId).toBe(instanceId);
    expect(state.players.a.weapon.instanceId).not.toBe(instanceId);
    expect(pickup.available).toBe(false); expect(pickup.respawnTicks).toBe(1200);
    expect(state.players.b.equipTicks).toBe(18);
  });
  it('preserves ammunition, counters and cooldown through pairing and replacement', () => {
    const state = playing(), p = state.players.a;
    p.x = 182;
    const incoming = createWeapon('uzi', 'used-uzi');
    Object.assign(incoming, { ammo: 3, cooldownTicks: 42, shotCounter: 17, reloadTicks: 50, reloadQueued: true });
    state.pickups.pad0.weapon = incoming;
    collectPickups(state, { a: { ...neutralInput(), pairPressed: true } }, map, []);
    expect(p.offhand).toMatchObject({ instanceId: 'used-uzi', ammo: 3, cooldownTicks: 42, shotCounter: 17, reloadTicks: 0 });
    expect(p.weapon.weaponId).toBe('pistol');
    state.pickups.pad0.available = true; state.pickups.pad0.weapon = createWeapon('m416', 'fresh-rifle');
    collectPickups(state, { a: { ...neutralInput(), pickupPressed: true } }, map, []);
    expect(p.offhand).toBeNull(); expect(p.weapon.weaponId).toBe('m416');
    expect(Object.values(state.pickups).find(item => item.kind === 'dropped' && item.weapon.instanceId === 'used-uzi')?.weapon.ammo).toBe(3);
  });
  it('allows revolvers as either hand while preserving separate weapon identities', () => {
    const state = playing(), p = state.players.a;
    p.x = 150; p.weapon = createWeapon('revolver', 'main-revolver');
    state.pickups.pad0.weapon = createWeapon('revolver', 'second-revolver');
    collectPickups(state, { a: { ...neutralInput(), pairPressed: true } }, map, []);
    expect(p.weapon.instanceId).toBe('main-revolver');
    expect(p.offhand).toMatchObject({ weaponId: 'revolver', instanceId: 'second-revolver', ammo: 6 });
  });
  it('blocks pairing rifles and collection through a wall', () => {
    const state = playing(), p = state.players.a;
    p.x = 150; state.pickups.pad0.weapon = createWeapon('ak47', 'rifle');
    collectPickups(state, { a: { ...neutralInput(), pairPressed: true } }, map, []);
    expect(p.offhand).toBeNull(); expect(state.pickups.pad0.available).toBe(true);
    const wall = compileArena({ ...arena, platforms: [{ x: 185, y: 520, width: 5, height: 80 }] });
    expect(pickupDistance(p, state.pickups.pad0, wall)).toBeNull();
  });
  it('bounds ordinary drops and refills pads only when their cooldown completes', () => {
    const state = playing();
    for (let i = 0; i < 24; i++) dropWeapons(state, state.players.a, [createWeapon('pistol', `drop-${i}`)]);
    expect(Object.values(state.pickups).filter(p => p.kind === 'dropped')).toHaveLength(16);
    state.pickups.pad0.available = false; state.pickups.pad0.respawnTicks = 2;
    advancePickups(state, map, []); expect(state.pickups.pad0.available).toBe(false);
    advancePickups(state, map, []); expect(state.pickups.pad0.available).toBe(true);
    for (let i = 0; i < PICKUP_CONFIG.dropTicks; i++) advancePickups(state, map, []);
    expect(Object.values(state.pickups).filter(p => p.kind === 'dropped')).toHaveLength(0);
  });
  it('announces the sniper, limits it to one instance, and never refills transferred reserve', () => {
    const state = playing(), events: ReturnType<typeof stepMatch> = [];
    state.remainingTicks = MATCH_CONFIG.durationTicks - 37 * 60;
    advancePickups(state, map, events);
    expect(events.map(e => e.type)).toContain('sniperWarning'); expect(state.sniperWarningTicks).toBe(480);
    state.remainingTicks = MATCH_CONFIG.durationTicks - 45 * 60;
    advancePickups(state, map, events);
    const sniper = Object.values(state.pickups).find(p => p.weapon.weaponId === 'sniper')!;
    expect(sniper.weapon).toMatchObject({ ammo: 5, reserve: 10 });
    state.players.a.x = sniper.x - 18; sniper.weapon.reserve = 2; sniper.weapon.ammo = 1;
    collectPickups(state, { a: { ...neutralInput(), pickupPressed: true } }, map, events);
    state.remainingTicks = MATCH_CONFIG.durationTicks - 135 * 60;
    advancePickups(state, map, events);
    expect(Object.values(state.pickups).some(p => p.available && p.weapon.weaponId === 'sniper')).toBe(false);
    expect(state.players.a.weapon).toMatchObject({ ammo: 1, reserve: 2 });
  });
});

describe('combat snapshots and effects', () => {
  it('restores every per-hand scalar and impulse through the wire without aliasing', () => {
    const p = playing().players.a;
    equipWeapon(p, createWeapon('ump', 'offhand'), 'pair');
    Object.assign(p.offhand!, { ammo: 4, shotCounter: 83, recoil: 1.4, bloom: .4, reloadTicks: 12, reloadQueued: true });
    Object.assign(p, { impulseX: -220, impulseY: -80, meleeAimAngle: .2, meleeSequence: 4, fireLockTicks: 12, nextShotOffhand: true });
    const wire = new PlayerWire(); syncPlayerWire(wire, p);
    const restored = playerFromWire(wire);
    expect(restored).toEqual(p);
    restored.offhand!.ammo = 0; expect(p.offhand!.ammo).toBe(4);
  });
  it('gives simultaneous hands unique identities and ignores client IDs for ballistic randomness', () => {
    const p = playing().players.a;
    p.weapon = createWeapon('uzi', 'main'); p.offhand = createWeapon('ump', 'offhand'); p.fireHeldLast = true;
    const wire = new PlayerWire(); syncPlayerWire(wire, p);
    const a = playerFromWire(wire), b = playerFromWire(wire);
    const events = stepPredictedActor(a, { ...neutralInput(), fireHeld: true, inputId: 1 }, map);
    const other = stepPredictedActor(b, { ...neutralInput(), fireHeld: true, inputId: 99999 }, map);
    const shots = events.filter(e => e.type === 'shot'), otherShots = other.filter(e => e.type === 'shot');
    expect(shots).toHaveLength(2); expect(new Set(shots.map(e => e.shotId)).size).toBe(2);
    expect(shots.map(e => [e.directionX, e.directionY])).toEqual(otherShots.map(e => [e.directionX, e.directionY]));
  });
  it('applies a server punch after windup and reconciles a separate knockback impulse', () => {
    const state = playing(); state.players.a.x = 200; state.players.b.x = 245;
    const events = stepMatch(state, { a: { ...neutralInput(), punchPressed: true } }, map);
    expect(events.some(e => e.type === 'meleeStart')).toBe(true); expect(state.players.b.health).toBe(100);
    for (let i = 0; i < 6; i++) events.push(...stepMatch(state, {}, map));
    expect(state.players.b.health).toBe(80); expect(state.players.b.impulseX).toBeGreaterThan(0);
    const previousX = state.players.b.x;
    stepMatch(state, {}, map); expect(state.players.b.x).toBeGreaterThan(previousX);
  });
});
