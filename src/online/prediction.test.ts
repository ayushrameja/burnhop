import { createWeapon } from '../game/weapons';
import { describe, expect, it } from 'vitest';
import { Reconciler, type InputHandle } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { cloneActor, compileArena } from '../game/simulation';
import { addPlayer, createMatch } from '../multiplayer/match';
import { MATCH_CONFIG, neutralInput, OUTPOST_ARENA, type NetworkInput } from '../multiplayer/model';
import { stepPredictedActor } from '../multiplayer/prediction';
import { PlayerWire, playerFromWire, syncPlayerWire } from '../multiplayer/wire';
import { stepWireActor } from './prediction';

function setup() {
  const actor = addPlayer(createMatch('test'), { id: 'me', nickname: 'Pilot', appearance: DEFAULT_APPEARANCE }, OUTPOST_ARENA);
  actor.lifeId = 3;
  const source = new PlayerWire(); syncPlayerWire(source, actor);
  const arena = compileArena(OUTPOST_ARENA);
  const queued = new Map<number, NetworkInput>();
  let listener = () => {};
  const input = { epoch: 0, sentCount: 0, lastProcessed: 0, stepMs: 1000 / 60, stepSeconds: 1 / 60, patchRate: 1000 / MATCH_CONFIG.stateRate,
    replayBufferSize: 128, at: (seq: number) => queued.get(seq), reckonTimeAt: () => 0,
    onSend: (callback: () => void) => { listener = callback; return () => { listener = () => {}; }; } };
  let liveEffects = 0;
  const controller = new Reconciler<PlayerWire, NetworkInput>(source, {
    input: input as unknown as InputHandle<NetworkInput>, smoothMs: 65,
    step: (ctx, mirror, command) => {
      const events = stepWireActor(mirror, command, arena);
      if (!ctx.isReplay) liveEffects += events.length;
    },
  });
  const send = (command: NetworkInput) => { queued.set(++input.sentCount, { ...command }); listener(); };
  return { actor, source, arena, input, controller, send, effects: () => liveEffects };
}

describe('Colyseus full-state prediction', () => {
  it('restores authoritative weapon/fuel/stance/timers and replays only buffered input without replaying effects', () => {
    const { actor, source, arena, input, controller, send, effects } = setup();
    const first = { ...neutralInput(0, 1), moveX: 1 as const, fireHeld: true };
    const second = { ...neutralInput(0.4, 2), crouchHeld: true, jetSeparate: true, jetHeld: true, jetPressed: true, reloadPressed: true };
    send(first); send(second);
    const effectCount = effects();
    // Emulate a correction after the first accepted input, deliberately including non-position scalars.
    const authoritative = cloneActor(actor);
    stepPredictedActor(authoritative, first, arena);
    authoritative.x += 19; authoritative.fuel = 37; authoritative.fuelDelayTicks = 11;
    authoritative.coyoteTicks = 4; authoritative.jumpBufferTicks = 2;
    authoritative.weapon = { ...createWeapon('pistol'), ammo: 7, reloadTicks: 24, cooldownTicks: 3 };
    authoritative.thrustLatched = true;
    syncPlayerWire(source, authoritative);
    const expected = cloneActor(authoritative); stepPredictedActor(expected, second, arena);
    input.lastProcessed = 1; controller.tick(100);
    expect(playerFromWire(controller.state)).toEqual(expected);
    expect(effects()).toBe(effectCount);
    controller.dispose();
  });
  it('clears prior-life pending prediction on death and resumes with a fresh authoritative actor', () => {
    const { source, input, controller, send } = setup();
    send({ ...neutralInput(0, 1), moveX: 1, fireHeld: true });
    source.health = 0; source.vx = 0; source.respawnTicks = 120;
    controller.reset();
    send({ ...neutralInput(0, 2), jumpPressed: true, fireHeld: true });
    expect(controller.state.health).toBe(0);
    expect(controller.state.x).toBe(source.x);
    source.health = 100; source.lifeId++; source.x += 500; source.ammo = 30; source.respawnTicks = 0;
    controller.reset(); input.lastProcessed = input.sentCount; controller.tick(200);
    expect(controller.state.x).toBe(source.x);
    expect(controller.state.lifeId).toBe(source.lifeId);
    expect(controller.state.ammo).toBe(30);
    controller.dispose();
  });
});
