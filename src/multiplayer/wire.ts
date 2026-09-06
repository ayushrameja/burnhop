import { schema, t, type SchemaType } from '@colyseus/schema';
import { normalizeAppearance, type DetailedAppearance } from '../game/appearance';
import type { MatchPlayer, MatchState, WeaponPickup } from './model';
import { createWeapon, type WeaponId } from '../game/weapons';
import type { WeaponState } from '../game/types';

/** Input is flat and identically ordered in both bundles; the socket supplies identity. */
export const InputWire = schema({
  moveX: t.int8<-1 | 0 | 1>().default(0),
  jumpPressed: t.boolean().default(false), jumpHeld: t.boolean().default(false),
  jetPressed: t.boolean().default(false), jetHeld: t.boolean().default(false), jetSeparate: t.boolean().default(false),
  crouchHeld: t.boolean().default(false), fireHeld: t.boolean().default(false), reloadPressed: t.boolean().default(false),
  pickupPressed: t.boolean().default(false), pairPressed: t.boolean().default(false), punchPressed: t.boolean().default(false),
  aimAngle: t.float64().default(0), inputId: t.uint32().default(0),
}, 'BurnhopInput');
export type InputWire = SchemaType<typeof InputWire>;

/** Float64 preserves the arithmetic of the shared JavaScript actor step during replay. */
export const PlayerWire = schema({
  id: t.string().default(''),
  nickname: t.string().default(''),
  appearance: t.string().default(''),
  x: t.float64().default(0),
  y: t.float64().default(0),
  width: t.float64().default(0),
  height: t.float64().default(0),
  vx: t.float64().default(0),
  vy: t.float64().default(0),
  grounded: t.boolean().default(false),
  coyoteTicks: t.uint16().default(0),
  jumpBufferTicks: t.uint16().default(0),
  aimAngle: t.float64().default(0),
  crouchAmount: t.float64().default(0),
  health: t.uint8().default(0),
  fuel: t.float64().default(0),
  thrusting: t.boolean().default(false),
  thrustLatched: t.boolean().default(false),
  fuelDelayTicks: t.uint16().default(0),
  ammo: t.uint8().default(0),
  reloadTicks: t.uint16().default(0),
  cooldownTicks: t.uint16().default(0),
  weaponId: t.string<WeaponId>().default('pistol'),
  instanceId: t.string().default(''),
  reserve: t.int16().default(-1),
  shotCounter: t.uint32().default(0),
  recoil: t.float64().default(0),
  bloom: t.float64().default(0),
  reloadQueued: t.boolean().default(false),
  offhandWeaponId: t.string<WeaponId>().default('pistol'),
  offhandInstanceId: t.string().default(''),
  offhandAmmo: t.uint8().default(0),
  offhandReserve: t.int16().default(-1),
  offhandReloadTicks: t.uint16().default(0),
  offhandCooldownTicks: t.uint16().default(0),
  offhandShotCounter: t.uint32().default(0),
  offhandRecoil: t.float64().default(0),
  offhandBloom: t.float64().default(0),
  offhandReloadQueued: t.boolean().default(false),
  hasOffhand: t.boolean().default(false),
  equipTicks: t.uint32().default(0),
  fireLockTicks: t.uint32().default(0),
  meleeWindupTicks: t.uint32().default(0),
  meleeCooldownTicks: t.uint32().default(0),
  meleeSequence: t.uint32().default(0),
  meleeAimAngle: t.float64().default(0),
  impulseX: t.float64().default(0),
  impulseY: t.float64().default(0),
  fireHeldLast: t.boolean().default(false),
  nextShotOffhand: t.boolean().default(false),
  connected: t.boolean().default(true),
  ready: t.boolean().default(false),
  joinedOrder: t.uint32().default(0),
  lifeId: t.uint32().default(0),
  kills: t.uint16().default(0),
  deaths: t.uint16().default(0),
  respawnTicks: t.uint16().default(0),
  protectionTicks: t.uint16().default(0),
}, 'BurnhopPlayer');
export type PlayerWire = SchemaType<typeof PlayerWire>;

export const PickupWire = schema({
  id: t.string().default(''), x: t.float64().default(0), y: t.float64().default(0),
  weaponId: t.string<WeaponId>().default('pistol'), available: t.boolean().default(false),
  kind: t.string<WeaponPickup['kind']>().default('pad'),
  respawnTicks: t.uint16().default(0), expiresTicks: t.uint16().default(0),
}, 'BurnhopPickup');
export type PickupWire = SchemaType<typeof PickupWire>;

export const MatchWire = schema({
  pickups: t.map(PickupWire), sniperWarningTicks: t.uint16().default(0),
  players: t.map(PlayerWire), phase: t.string<MatchState['phase']>().default('lobby'),
  tick: t.uint32().default(0), remainingTicks: t.uint32().default(0), countdownTicks: t.uint16().default(0),
  hostId: t.string().default(''), code: t.string().default(''), compatibility: t.string().default(''),
  winnerIds: t.array('string'),
}, 'BurnhopMatch');
export type MatchWire = SchemaType<typeof MatchWire>;

// Match cosmetics are immutable. Weak keys release cached recipes with their actors.
const encodedAppearances = new WeakMap<DetailedAppearance, string>();
const decodedAppearances = new WeakMap<object, { source: string; value: DetailedAppearance }>();
function encodeAppearance(value: DetailedAppearance): string {
  if (!Object.isFrozen(value)) return JSON.stringify(value);
  let encoded = encodedAppearances.get(value);
  if (encoded === undefined) { encoded = JSON.stringify(value); encodedAppearances.set(value, encoded); }
  return encoded;
}
function decodeAppearance(wire: PlayerWire): DetailedAppearance {
  const cached = decodedAppearances.get(wire);
  if (cached?.source === wire.appearance) return cached.value;
  let value: DetailedAppearance;
  try { value = normalizeAppearance(JSON.parse(wire.appearance)); }
  catch { value = normalizeAppearance(undefined); }
  Object.freeze(value);
  decodedAppearances.set(wire, { source: wire.appearance, value });
  return value;
}

export function syncPlayerWire(wire: PlayerWire, player: MatchPlayer): void {
  for (const key of PLAYER_FIELDS) wire[key] = player[key] as never;
  wire.appearance = encodeAppearance(player.appearance);
  syncWeapon(wire, player.weapon);
  wire.hasOffhand = player.offhand !== null;
  syncWeapon(wire, player.offhand ?? createWeapon('pistol', ''), 'offhand');
}

export function playerFromWire(wire: PlayerWire, target?: MatchPlayer): MatchPlayer {
  const player = target ?? { weapon: createWeapon('pistol') } as MatchPlayer;
  for (const key of PLAYER_FIELDS) player[key] = wire[key] as never;
  player.appearance = decodeAppearance(wire);
  player.weapon = readWeapon(wire, '', player.weapon);
  player.offhand = wire.hasOffhand ? readWeapon(wire, 'offhand', player.offhand ?? undefined) : null;
  return player;
}

const PLAYER_FIELDS = [
  'id', 'nickname', 'x', 'y', 'width', 'height', 'vx', 'vy', 'grounded', 'coyoteTicks', 'jumpBufferTicks',
  'aimAngle', 'crouchAmount', 'health', 'fuel', 'thrusting', 'thrustLatched', 'fuelDelayTicks',
  'equipTicks', 'fireLockTicks', 'fireHeldLast', 'nextShotOffhand', 'meleeWindupTicks', 'meleeCooldownTicks', 'meleeAimAngle', 'meleeSequence', 'impulseX', 'impulseY',
  'connected', 'ready', 'joinedOrder', 'lifeId', 'kills', 'deaths', 'respawnTicks', 'protectionTicks',
] as const;

export function syncMatchWire(wire: MatchWire, match: MatchState): void {
  wire.sniperWarningTicks = match.sniperWarningTicks;
  for (const id of wire.pickups.keys()) if (!match.pickups[id]) wire.pickups.delete(id);
  for (const pickup of Object.values(match.pickups)) {
    let target = wire.pickups.get(pickup.id);
    if (!target) { target = new PickupWire(); wire.pickups.set(pickup.id, target); }
    target.id = pickup.id; target.x = pickup.x; target.y = pickup.y;
    target.weaponId = pickup.weapon.weaponId; target.available = pickup.available; target.kind = pickup.kind;
    target.respawnTicks = pickup.respawnTicks; target.expiresTicks = pickup.expiresTicks;
  }
  wire.phase = match.phase; wire.tick = match.tick; wire.remainingTicks = match.remainingTicks;
  wire.countdownTicks = match.countdownTicks; wire.hostId = match.hostId; wire.code = match.code;
  for (const id of wire.players.keys()) if (!match.players[id]) wire.players.delete(id);
  for (const player of Object.values(match.players)) {
    let target = wire.players.get(player.id);
    if (!target) { target = new PlayerWire(); wire.players.set(player.id, target); }
    syncPlayerWire(target, player);
  }
  if (wire.winnerIds.join('|') !== match.winnerIds.join('|')) {
    wire.winnerIds.splice(0, wire.winnerIds.length, ...match.winnerIds);
  }
}

const WEAPON_FIELDS = ['weaponId', 'instanceId', 'ammo', 'reserve', 'reloadTicks', 'cooldownTicks', 'shotCounter', 'recoil', 'bloom', 'reloadQueued'] as const;
function weaponKey(key: typeof WEAPON_FIELDS[number], prefix: string): keyof PlayerWire {
  return (prefix ? prefix + key[0].toUpperCase() + key.slice(1) : key) as keyof PlayerWire;
}
function syncWeapon(wire: PlayerWire, weapon: WeaponState, prefix = ''): void {
  for (const key of WEAPON_FIELDS) (wire as unknown as Record<string, unknown>)[weaponKey(key, prefix) as string] = weapon[key];
}
function readWeapon(wire: PlayerWire, prefix: string, target = createWeapon('pistol')): WeaponState {
  for (const key of WEAPON_FIELDS) (target as unknown as Record<string, unknown>)[key] = wire[weaponKey(key, prefix)];
  return target;
}
