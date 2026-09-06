import { schema, t, type SchemaType } from '@colyseus/schema';
import { normalizeAppearance, type DetailedAppearance } from '../game/appearance';
import type { MatchPlayer, MatchState } from './model';

/** Input is flat and identically ordered in both bundles; the socket supplies identity. */
export const InputWire = schema({
  moveX: t.int8<-1 | 0 | 1>().default(0),
  jumpPressed: t.boolean().default(false), jumpHeld: t.boolean().default(false),
  jetPressed: t.boolean().default(false), jetHeld: t.boolean().default(false), jetSeparate: t.boolean().default(false),
  crouchHeld: t.boolean().default(false), fireHeld: t.boolean().default(false), reloadPressed: t.boolean().default(false),
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

export const MatchWire = schema({
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
  wire.ammo = player.weapon.ammo;
  wire.reloadTicks = player.weapon.reloadTicks;
  wire.cooldownTicks = player.weapon.cooldownTicks;
}

export function playerFromWire(wire: PlayerWire): MatchPlayer {
  const player = {} as MatchPlayer;
  for (const key of PLAYER_FIELDS) player[key] = wire[key] as never;
  player.appearance = decodeAppearance(wire);
  player.weapon = { ammo: wire.ammo, reloadTicks: wire.reloadTicks, cooldownTicks: wire.cooldownTicks };
  return player;
}

const PLAYER_FIELDS = [
  'id', 'nickname', 'x', 'y', 'width', 'height', 'vx', 'vy', 'grounded', 'coyoteTicks', 'jumpBufferTicks',
  'aimAngle', 'crouchAmount', 'health', 'fuel', 'thrusting', 'thrustLatched', 'fuelDelayTicks',
  'connected', 'ready', 'joinedOrder', 'lifeId', 'kills', 'deaths', 'respawnTicks', 'protectionTicks',
] as const;

export function syncMatchWire(wire: MatchWire, match: MatchState): void {
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
