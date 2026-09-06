import { createWeapon } from '../game/weapons';
import { describe, expect, it } from 'vitest';
import arenaData from '../../public/assets/arena.json';
import { cloneActor, compileArena, CONFIG, createWorld, restoreActor, stepSimulation } from '../game/simulation';
import { getStanceHeight } from '../game/stance';
import type { Arena, PlayerState } from '../game/types';
import { neutralInput, type NetworkInput } from './model';
import { stepPredictedActor } from './prediction';

const arena: Arena = { width: 2000, height: 1000, floorY: 600, platforms: [], playerSpawn: { x: 150, y: 532 }, targetSpawn: { x: 1500, y: 532 } };
const input = (changes: Partial<NetworkInput> = {}): NetworkInput => ({ ...neutralInput(), ...changes });

function replayAfterCorrection(snapshot: PlayerState, pending: NetworkInput[], map = arena) {
  const geometry = compileArena(map), expected = cloneActor(snapshot), predicted = cloneActor(snapshot);
  const expectedEvents = pending.flatMap(frame => stepPredictedActor(expected, frame, geometry));
  // Simulate a divergent prediction with corrupt values in every field that affects future gameplay.
  Object.assign(predicted, { x: 0, y: 0, width: 1, height: 1, vx: -99, vy: 99,
    grounded: !snapshot.grounded, coyoteTicks: 99, jumpBufferTicks: 99, aimAngle: 3,
    crouchAmount: 0.3, health: 0, fuel: 50, thrusting: !snapshot.thrusting,
    thrustLatched: !snapshot.thrustLatched, fuelDelayTicks: 99, weapon: { ...createWeapon('pistol'), ammo: 0, reloadTicks: 99, cooldownTicks: 99 } });
  restoreActor(predicted, snapshot);
  const replayEvents = pending.flatMap(frame => stepPredictedActor(predicted, frame, geometry));
  expect(predicted).toEqual(expected);
  expect(replayEvents).toEqual(expectedEvents);
  expect(predicted.weapon).not.toBe(snapshot.weapon);
  return { predicted, events: replayEvents };
}

describe('shared prediction and reconciliation', () => {
  it('preserves the existing practice actor behavior across a mixed replay stream', () => {
    const practice = createWorld(arenaData), online = cloneActor(practice.player), geometry = compileArena(arenaData);
    practice.target.health = 0;
    for (let tick = 0; tick < 240; tick++) {
      const frame = input({ inputId: tick, moveX: tick < 120 ? 1 : -1,
        jumpPressed: tick === 10 || tick === 28, jumpHeld: tick >= 10 && tick < 90,
        jetPressed: tick === 10 || tick === 28, jetHeld: tick >= 10 && tick < 90,
        fireHeld: tick < 170, reloadPressed: tick === 175, crouchHeld: tick > 210, aimAngle: -0.3 });
      stepPredictedActor(online, frame, geometry);
      stepSimulation(practice, { tick, actorId: practice.player.id, moveX: frame.moveX,
        jumpPressed: frame.jumpPressed, jumpHeld: frame.jumpHeld, aimAngle: frame.aimAngle,
        fireHeld: frame.fireHeld, reloadPressed: frame.reloadPressed, crouchHeld: frame.crouchHeld,
        jetpack: { source: 'combined', pressed: frame.jetPressed, held: frame.jetHeld } }, arenaData);
      expect(online).toEqual(practice.player);
    }
  });
  it('replays a pending buffered jump from corrected descending state', () => {
    const player = createWorld(arena).player;
    Object.assign(player, { y: 500, vy: 300, grounded: false, coyoteTicks: 0 });
    stepPredictedActor(player, input({ jumpPressed: true, jumpHeld: true, jetPressed: true, jetHeld: true }), compileArena(arena));
    expect(player.jumpBufferTicks).toBeGreaterThan(0);
    const { events } = replayAfterCorrection(player, Array.from({ length: 20 }, (_, inputId) => input({ inputId, jumpHeld: true, jetHeld: true })));
    expect(events.filter(event => event.type === 'jump')).toHaveLength(1);
  });
  it('restores jet toggles and fuel-delay state before replay', () => {
    const player = createWorld(arena).player;
    Object.assign(player, { y: 300, grounded: false, coyoteTicks: 0, thrustLatched: true, thrusting: true, fuel: 13, fuelDelayTicks: 24 });
    const { predicted } = replayAfterCorrection(player, [
      input({ inputId: 1, jetSeparate: true, jetHeld: true }),
      input({ inputId: 2, jetSeparate: true }),
      input({ inputId: 3, jetSeparate: true, jetPressed: true, jetHeld: true }),
    ]);
    expect(predicted.thrustLatched).toBe(true); expect(predicted.fuel).toBeLessThan(13);
  });
  it('cannot resurrect thrust by replaying across complete fuel depletion', () => {
    const player = createWorld(arena).player;
    Object.assign(player, { y: 300, grounded: false, coyoteTicks: 0, thrustLatched: true, thrusting: true, fuel: 0.1 });
    const { predicted } = replayAfterCorrection(player, Array.from({ length: 10 }, (_, inputId) => input({ inputId, jetHeld: true })));
    expect(predicted.fuel).toBe(0); expect(predicted.thrustLatched).toBe(false); expect(predicted.thrusting).toBe(false);
  });
  it('restores crouched height and feet before clearance checks under a low ceiling', () => {
    const map = { ...arena, platforms: [{ x: 100, y: 500, width: 200, height: 45 }] };
    const player = createWorld(map).player;
    Object.assign(player, { crouchAmount: 1, height: getStanceHeight(1), y: 600 - getStanceHeight(1) });
    const { predicted } = replayAfterCorrection(player, Array.from({ length: 30 }, (_, inputId) => input({ inputId })), map);
    expect(predicted.crouchAmount).toBeGreaterThan(0); expect(predicted.y).toBeGreaterThanOrEqual(545);
    expect(predicted.y + predicted.height).toBe(600);
  });
  it('replays reload completion and cooldown without double-spending ammunition', () => {
    const player = createWorld(arena).player;
    player.weapon = { ...createWeapon('pistol'), ammo: 7, reloadTicks: 12, cooldownTicks: 4 };
    const { predicted, events } = replayAfterCorrection(player,
      Array.from({ length: 24 }, (_, inputId) => input({ inputId, fireHeld: true })));
    expect(events.filter(event => event.type === 'reloadEnd')).toHaveLength(1);
    expect(events.filter(event => event.type === 'shot')).toHaveLength(2);
    expect(predicted.weapon.ammo).toBe(CONFIG.magazineSize - 2);
  });
  it('does not simulate dead actors or treat predicted shots as confirmed hits', () => {
    const player = createWorld(arena).player; player.health = 0;
    const snapshot = cloneActor(player);
    expect(stepPredictedActor(player, input({ moveX: 1, fireHeld: true }), compileArena(arena))).toEqual([]);
    expect(player).toEqual(snapshot);
    player.health = 100;
    const events = stepPredictedActor(player, input({ fireHeld: true, inputId: 4 }), compileArena(arena));
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ type: 'shot', hit: false, shotId: `player:0:${player.weapon.instanceId}:main:1` });
  });
});
