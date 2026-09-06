import { describe, expect, it } from 'vitest';
import { applyKnockback, calculateDamage, getHitRegions, rayHitRegions, resolveMeleeTarget } from './combat';
import { cloneActor, compileArena, createWorld, getWeaponOrigin, stepActor, type ActorInput } from './simulation';
import type { Arena, GameEvent, PlayerState, WeaponId } from './types';
import { cancelReload, createWeapon, equipWeapon, MELEE_CONFIG, WEAPONS } from './weapons';

const arena: Arena = { width: 3000, height: 1000, floorY: 600, platforms: [],
  playerSpawn: { x: 100, y: 532 }, targetSpawn: { x: 250, y: 532 } };
const input = (changes: Partial<ActorInput> = {}): ActorInput => ({ moveX: 0, jumpPressed: false, jumpHeld: false,
  aimAngle: 0, fireHeld: false, reloadPressed: false, ...changes });
const step = (player: PlayerState, changes: Partial<ActorInput> = {}, map = arena) => stepActor(player, input(changes), compileArena(map));
function run(player: PlayerState, ticks: number, changes: Partial<ActorInput> = {}): GameEvent[] {
  return Array.from({ length: ticks }, () => step(player, changes)).flat();
}
const actor = (id: WeaponId = 'pistol') => {
  const player = createWorld(arena).player;
  player.weapon = createWeapon(id, `test:${id}`);
  return player;
};

describe('configurable weapon damage and canonical hit regions', () => {
  it('uses the approved magazines and fire timing for every weapon', () => {
    expect(Object.values(WEAPONS).map(w => [w.id, w.magazineSize, w.cooldownTicks, w.reloadTicks])).toEqual([
      ['pistol', 12, 12, 72], ['revolver', 6, 30, 132], ['ak47', 25, 8, 126], ['m416', 30, 7, 114],
      ['uzi', 20, 4, 90], ['ump', 25, 6, 108], ['sniper', 5, 72, 180],
    ]);
    expect(createWorld(arena).player.weapon.weaponId).toBe('pistol');
  });
  it.each([
    ['pistol', 18, 32, 14], ['revolver', 42, 84, 32], ['ak47', 28, 49, 21], ['m416', 23, 40, 17],
    ['uzi', 15, 23, 11], ['ump', 20, 30, 15], ['sniper', 80, 160, 60],
  ] as const)('%s rounds region damage only once', (id, body, head, legs) => {
    expect(calculateDamage(id, 'body', 100)).toBe(body);
    expect(calculateDamage(id, 'head', 100)).toBe(head);
    expect(calculateDamage(id, 'legs', 100)).toBe(legs);
  });
  it('falls off continuously by distance and enforces maximum weapon range', () => {
    expect(calculateDamage('pistol', 'body', 300)).toBe(18);
    expect(calculateDamage('pistol', 'body', 550)).toBe(13);
    expect(calculateDamage('pistol', 'body', 800)).toBe(7);
    expect(calculateDamage('pistol', 'body', 1001)).toBe(0);
    expect(calculateDamage('uzi', 'body', 700)).toBe(5);
    expect(calculateDamage('sniper', 'head', 2300)).toBe(160);
    expect(calculateDamage('sniper', 'body', 2301)).toBe(0);
  });
  it('tracks 25/45/30 percent regions through stance changes, choosing the lower region at seams', () => {
    const target = { x: 100, y: 200, width: 36, height: 100 };
    expect(getHitRegions(target).map(r => r.rect.height)).toEqual([25, 45, 30]);
    const hitAt = (y: number) => rayHitRegions({ x: 0, y }, { x: 1, y: 0 }, target, 500);
    expect(hitAt(210)).toEqual({ distance: 100, region: 'head' });
    expect(hitAt(225)).toEqual({ distance: 100, region: 'body' });
    expect(hitAt(270)).toEqual({ distance: 100, region: 'legs' });
    expect(hitAt(301)).toBeNull();
    expect(rayHitRegions({ x: 0, y: 210 }, { x: 1, y: 0 }, { ...target, y: 250, height: 50 }, 500)).toBeNull();
  });
});

describe('deterministic per-instance firing', () => {
  it.each(Object.keys(WEAPONS) as WeaponId[])('enforces %s cadence and never fires beyond its magazine', id => {
    const player = actor(id), config = WEAPONS[id];
    const shotTicks: number[] = [];
    for (let tick = 0; tick < (config.magazineSize + 1) * config.cooldownTicks; tick++) {
      if (step(player, { fireHeld: true }).some(e => e.type === 'shot')) shotTicks.push(tick);
    }
    expect(shotTicks).toEqual(Array.from({ length: config.magazineSize }, (_, i) => i * config.cooldownTicks));
    expect(player.weapon.ammo).toBe(0);
    expect(player.weapon.shotCounter).toBe(config.magazineSize);
  });
  it('replays every state and ray identically while different instances have distinct spread', () => {
    const first = actor('ak47'), replay = cloneActor(first), other = actor('ak47');
    other.weapon.instanceId = 'another-ak';
    const firstShot = step(first, { fireHeld: true }), replayShot = step(replay, { fireHeld: true });
    expect(firstShot).toEqual(replayShot);
    expect(step(other, { fireHeld: true })).not.toEqual(firstShot);
    for (let tick = 0; tick < 140; tick++) {
      const command = { fireHeld: tick < 90, crouchHeld: tick > 50, aimAngle: tick / 100 };
      expect(step(first, command)).toEqual(step(replay, command));
      expect(first).toEqual(replay);
    }
    expect(first.weapon.bloom).toBe(0);
    expect(first.weapon.recoil).toBe(0);
  });
  it('carries actual ballistic ray geometry and cover material independently from visual muzzle position', () => {
    const player = actor('ak47'), origin = getWeaponOrigin(player);
    const map = { ...arena, platforms: [{ x: origin.x + 20, y: 500, width: 2, height: 100 }] };
    const shot = step(player, { fireHeld: true }, map).find(e => e.type === 'shot')!;
    expect(shot.originX).toBe(origin.x); expect(shot.originY).toBe(origin.y);
    expect(shot.x).toBe(origin.x); expect(shot.y).toBe(origin.y);
    expect(shot.toX).toBeCloseTo(origin.x + 20);
    expect(shot.surface).toBe('rock');
    expect(Math.hypot(shot.directionX, shot.directionY)).toBeCloseTo(1);
    expect(shot.toY).toBeCloseTo(shot.originY + (shot.toX - shot.originX) / shot.directionX * shot.directionY);
  });
  it('keeps AK kick between sustained shots and restores a rested ray after trigger release', () => {
    const player = actor('ak47'); step(player, { fireHeld: true });
    const kick = player.weapon.recoil;
    expect(Math.abs(kick)).toBeGreaterThan(.8);
    run(player, 7, { fireHeld: true });
    expect(player.weapon.recoil).toBe(kick);
    const rested = cloneActor(player); rested.weapon.recoil = 0;
    const sustainedShot = step(player, { fireHeld: true }).find(e => e.type === 'shot')!;
    const restedShot = step(rested, { fireHeld: true }).find(e => e.type === 'shot')!;
    expect(Math.atan2(sustainedShot.directionY, sustainedShot.directionX)
      - Math.atan2(restedShot.directionY, restedShot.directionX)).toBeCloseTo(kick * Math.PI / 180);
    run(player, 45); expect(player.weapon.recoil).toBe(0); expect(player.weapon.bloom).toBe(0);
  });
  it('staggered dual UMPs alternate four/five-tick spacing and keep unique shot counters', () => {
    const player = actor('ump'); player.offhand = createWeapon('ump', 'second-ump');
    const shots: Array<[number, string, number]> = [];
    for (let tick = 0; tick < 23; tick++) for (const event of step(player, { fireHeld: true })) {
      if (event.type === 'shot') shots.push([tick, event.hand, event.shotCounter]);
    }
    expect(shots).toEqual([[0, 'main', 1], [4, 'offhand', 1], [9, 'main', 2], [13, 'offhand', 2], [18, 'main', 3], [22, 'offhand', 3]]);
  });
  it('continues firing the loaded hand when its partner is empty', () => {
    const player = actor('pistol'); player.offhand = createWeapon('uzi', 'other-uzi'); player.weapon.ammo = 0;
    const events = run(player, 13, { fireHeld: true });
    expect(events.filter(e => e.type === 'shot').map(e => e.hand)).toEqual(['offhand', 'offhand', 'offhand']);
    expect(events.filter(e => e.type === 'dryfire')).toHaveLength(1);
  });
});

describe('reload and equipment instance ownership', () => {
  it('reloads hands sequentially, committing each magazine separately and locking all shots', () => {
    const player = actor('pistol'); player.offhand = createWeapon('uzi', 'paired-uzi');
    player.weapon.ammo = 3; player.offhand.ammo = 2;
    expect(step(player, { reloadPressed: true }).filter(e => e.type === 'reloadStart').map(e => e.hand)).toEqual(['main']);
    expect(player.offhand.reloadQueued).toBe(true);
    expect(run(player, 71, { fireHeld: true }).some(e => e.type === 'shot')).toBe(false);
    const transition = step(player, { fireHeld: true });
    expect(transition.map(e => e.type)).toEqual(['reloadEnd', 'reloadStart']);
    expect(player.weapon.ammo).toBe(12); expect(player.offhand.ammo).toBe(2); expect(player.offhand.reloadTicks).toBe(90);
    expect(run(player, 89, { fireHeld: true }).some(e => e.type === 'shot')).toBe(false);
    step(player);
    expect(player.offhand.ammo).toBe(20);
  });
  it('skips a full hand and cancellation retains completed magazines but discards unfinished progress', () => {
    const player = actor('pistol'); player.offhand = createWeapon('uzi', 'paired-uzi'); player.offhand.ammo = 1;
    expect(step(player, { reloadPressed: true }).find(e => e.type === 'reloadStart')).toMatchObject({ hand: 'offhand' });
    run(player, 40); cancelReload(player);
    expect(player.offhand.ammo).toBe(1);
    step(player, { reloadPressed: true }); expect(player.offhand.reloadTicks).toBe(90);
    cancelReload(player); player.weapon.ammo = 0;
    step(player, { reloadPressed: true }); run(player, 72); cancelReload(player);
    expect(player.weapon.ammo).toBe(12); expect(player.offhand.ammo).toBe(1);
  });
  it('transfers only available sniper reserves at reload completion', () => {
    const player = actor('sniper'); player.weapon.ammo = 0; player.weapon.reserve = 2;
    step(player, { reloadPressed: true }); run(player, 179);
    expect(player.weapon.ammo).toBe(0); expect(player.weapon.reserve).toBe(2);
    step(player); expect(player.weapon.ammo).toBe(2); expect(player.weapon.reserve).toBe(0);
    expect(step(player, { reloadPressed: true }).some(e => e.type === 'reloadStart')).toBe(false);
  });
  it('single equip drops both hands, pair replaces only offhand, and preserves ammunition and long cooldowns', () => {
    const player = actor('pistol'), sidearm = player.weapon;
    expect(equipWeapon(player, createWeapon('uzi', 'one'), 'pair')).toEqual([]);
    expect(equipWeapon(player, createWeapon('ump', 'two'), 'pair')?.map(w => w.instanceId)).toEqual(['one']);
    const sniper = createWeapon('sniper', 'rare'); sniper.ammo = 1; sniper.reserve = 3; sniper.cooldownTicks = 50; sniper.shotCounter = 4;
    expect(equipWeapon(player, sniper, 'single')?.map(w => w.instanceId)).toEqual([sidearm.instanceId, 'two']);
    expect(player.offhand).toBeNull(); expect(player.weapon).toEqual(sniper);
    expect(run(player, 49, { fireHeld: true }).some(e => e.type === 'shot')).toBe(false);
    expect(step(player, { fireHeld: true }).find(e => e.type === 'shot')).toMatchObject({ weaponId: 'sniper', shotCounter: 5 });
    expect(player.weapon.reserve).toBe(3);
    expect(equipWeapon(player, createWeapon('pistol', 'three'), 'pair')).toBeNull();
  });
  it('deep clones both equipped weapon states for prediction', () => {
    const player = actor(); player.offhand = createWeapon('uzi', 'paired');
    const copy = cloneActor(player); copy.offhand!.ammo = 0; copy.weapon.shotCounter = 42;
    expect(player.offhand.ammo).toBe(20); expect(player.weapon.shotCounter).toBe(0);
  });
});

describe('punch timing, visibility and external knockback', () => {
  it('starts a six-tick windup, cancels reload, locks fire and accepts another punch after 36 ticks', () => {
    const player = actor(); player.weapon.ammo = 1; step(player, { reloadPressed: true });
    expect(step(player, { punchPressed: true, fireHeld: true }).map(e => e.type)).toEqual(['meleeStart']);
    expect(player.weapon.reloadTicks).toBe(0);
    expect(run(player, 5, { fireHeld: true })).toEqual([]);
    expect(step(player, { fireHeld: true }).map(e => e.type)).toEqual(['melee']);
    expect(run(player, 5, { fireHeld: true }).some(e => e.type === 'shot')).toBe(false);
    expect(step(player, { fireHeld: true }).some(e => e.type === 'shot')).toBe(true);
    run(player, 23);
    expect(step(player, { punchPressed: true }).some(e => e.type === 'meleeStart')).toBe(true);
  });
  it('hits only the forward cone, within reach and with a clear contact point', () => {
    const origin = { x: 100, y: 100 }, direction = { x: 1, y: 0 }, target = { x: 140, y: 90, width: 36, height: 68 };
    expect(resolveMeleeTarget(origin, direction, target, [])).toEqual({ x: 140, y: 100 });
    expect(resolveMeleeTarget(origin, direction, { ...target, x: 170 }, [])).toBeNull();
    expect(resolveMeleeTarget(origin, direction, { ...target, x: 40 }, [])).toBeNull();
    expect(resolveMeleeTarget(origin, direction, target, [{ x: 120, y: 0, width: 2, height: 300 }])).toBeNull();
  });
  it('moves targets without altering ordinary speed and decays the external impulse against terrain', () => {
    const player = actor(), baseline = cloneActor(player);
    applyKnockback(player, { x: 1, y: 0 });
    expect(player.impulseX).toBe(220); expect(player.impulseY).toBe(-80);
    step(player); step(baseline);
    expect(player.x).toBeGreaterThan(baseline.x + 3); expect(player.vx).toBe(baseline.vx);
    run(player, 11); expect(player.impulseX).toBe(0); expect(player.impulseY).toBe(0);
    const wall = { ...arena, platforms: [{ x: player.x + player.width + 1, y: 0, width: 10, height: 600 }] };
    applyKnockback(player, { x: 1, y: 0 }); step(player, {}, wall);
    expect(player.impulseX).toBe(0);
    expect(MELEE_CONFIG.damage).toBe(20);
  });
  it.each(['rectangle', 'polygon'] as const)('cannot punch targets flush with %s cover at diagonal contact points', shape => {
    const leaks: number[] = [];
    const cover = shape === 'rectangle' ? { x: 140, y: 0, width: 20, height: 300 }
      : { id: 'wall', material: 'rock' as const, points: [{ x: 140, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 300 }, { x: 140, y: 300 }] };
    for (let i = 0; i < 128; i++) {
      const contact = resolveMeleeTarget({ x: 100, y: 100 }, { x: 1, y: 0 },
        { x: 140, y: 100 + i * .127, width: 36, height: 68 }, [cover]);
      if (contact) leaks.push(i);
    }
    expect(leaks).toEqual([]);
  });
});
