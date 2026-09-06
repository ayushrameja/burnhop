import { normalizeAppearance, type DetailedAppearance } from '../game/appearance';
import { moveAndCollide, rectOverlapsSolid } from '../game/collision';
import { CONFIG, compileArena, createWorld, getWeaponOrigin, type CompiledArena } from '../game/simulation';
import { applyKnockback, calculateDamage, isCloserHit, rayHitRegions, resolveMeleeTarget } from '../game/combat';
import { createWeapon, equippedWeapons, MELEE_CONFIG } from '../game/weapons';
import { advancePickups, collectPickups, dropWeapons, resetPickups } from './pickups';
import type { Arena, GameEvent, Vec2, HitRegion, WeaponId, WeaponHand } from '../game/types';
import { MATCH_CONFIG, neutralInput, type ActorEvent, type MatchPlayer, type MatchState, type NetworkInput, type TargetHistory } from './model';
import { stepPredictedActor } from './prediction';

const compiled = (arena: Arena | CompiledArena): CompiledArena => 'solids' in arena ? arena : compileArena(arena);
const ordered = (state: MatchState): MatchPlayer[] => Object.values(state.players).sort((a, b) => a.joinedOrder - b.joinedOrder || a.id.localeCompare(b.id));

export function createMatch(code: string): MatchState {
  return { tick: 0, phase: 'lobby', hostId: '', code, countdownTicks: 0,
    remainingTicks: MATCH_CONFIG.durationTicks, players: {}, winnerIds: [],
    pickups: {}, pickupSequence: 0, pickupSeed: [...code].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0 || 1,
    weaponBag: [], dropScheduleIndex: 0, sniperWarningTicks: 0 };
}

export function addPlayer(state: MatchState, guest: { id: string; nickname: string; appearance: DetailedAppearance }, arena: Arena): MatchPlayer {
  if (state.players[guest.id]) throw new Error('This player is already in the room.');
  if (state.phase !== 'lobby') throw new Error('Match in progress.');
  if (Object.keys(state.players).length >= MATCH_CONFIG.maxPlayers) throw new Error('Room is full.');
  const joinedOrder = Math.max(0, ...Object.values(state.players).map(p => p.joinedOrder)) + 1;
  const player: MatchPlayer = { ...createWorld(arena).player, id: guest.id,
    connected: true, ready: false, joinedOrder, lifeId: 0, kills: 0, deaths: 0,
    respawnTicks: 0, protectionTicks: 0, nickname: guest.nickname, appearance: Object.freeze(normalizeAppearance(guest.appearance)) };
  state.players[guest.id] = player;
  if (!state.hostId) state.hostId = guest.id;
  return player;
}

function canStart(state: MatchState): boolean {
  const connected = ordered(state).filter(p => p.connected);
  return connected.length >= MATCH_CONFIG.minPlayers && connected.every(p => p.ready);
}
function cancelCountdown(state: MatchState): void {
  if (state.phase === 'countdown') { state.phase = 'lobby'; state.countdownTicks = 0; }
}
export function setReady(state: MatchState, id: string, ready: boolean): boolean {
  const player = state.players[id];
  if (!player?.connected || (state.phase !== 'lobby' && state.phase !== 'countdown')) return false;
  player.ready = ready;
  if (!ready) cancelCountdown(state);
  return true;
}
export function startCountdown(state: MatchState, hostId: string): boolean {
  if (state.phase !== 'lobby' || state.hostId !== hostId || !canStart(state)) return false;
  state.phase = 'countdown'; state.countdownTicks = MATCH_CONFIG.countdownTicks;
  return true;
}

export function setConnected(state: MatchState, id: string, connected: boolean): void {
  const player = state.players[id];
  if (!player || player.connected === connected) return;
  player.connected = connected;
  player.ready = false;
  player.thrusting = false; player.thrustLatched = false; player.jumpBufferTicks = 0;
  if (!connected) {
    cancelCountdown(state);
    if (state.hostId === id) state.hostId = ordered(state).find(p => p.connected)?.id ?? '';
  } else {
    // Rejoining starts a new continuous connection interval. Existing peers keep host priority.
    player.joinedOrder = Math.max(0, ...Object.values(state.players).map(p => p.joinedOrder)) + 1;
    if (!state.hostId) state.hostId = ordered(state).find(p => p.connected)?.id ?? '';
  }
}
export function removePlayer(state: MatchState, id: string): void {
  if (!state.players[id]) return;
  setConnected(state, id, false);
  delete state.players[id];
  if (state.hostId === id) state.hostId = ordered(state).find(p => p.connected)?.id ?? '';
}

/** Authored order is the stable tie-break. An invalid spawn can never win a distance comparison. */
export function selectSpawn(state: MatchState, actorId: string, map: Arena | CompiledArena): Vec2 {
  const { arena, solids } = compiled(map);
  const candidates = arena.spawnPoints?.length ? arena.spawnPoints : [arena.playerSpawn];
  const living = ordered(state).filter(p => p.id !== actorId && p.health > 0);
  let best: Vec2 | undefined, bestDistance = -1;
  for (const point of candidates) {
    const body = { x: point.x, y: point.y, width: CONFIG.bodyWidth, height: CONFIG.bodyHeight };
    if (body.x < 0 || body.y < 0 || body.x + body.width > arena.width || body.y + body.height > arena.height ||
      solids.some(solid => rectOverlapsSolid(body, solid))) continue;
    const support = { ...body };
    if (!moveAndCollide(support, { x: 0, y: 2 }, solids).grounded) continue;
    const distance = living.length ? Math.min(...living.map(p =>
      (point.x + CONFIG.bodyWidth / 2 - p.x - p.width / 2) ** 2 +
      (point.y + CONFIG.bodyHeight / 2 - p.y - p.height / 2) ** 2)) : Infinity;
    if (best === undefined || distance > bestDistance) { best = point; bestDistance = distance; }
  }
  if (!best) throw new Error('The arena has no valid multiplayer spawn.');
  return { x: best.x, y: best.y };
}

function eventFor(state: MatchState, player: MatchPlayer, event: GameEvent & Partial<Pick<ActorEvent, 'targetId' | 'shotId' | 'targetLifeId' | 'killerId'>>, sequence: number): ActorEvent {
  return { ...event, id: `${state.tick}:${player.id}:${sequence}`, actorId: player.id, lifeId: player.lifeId } as ActorEvent;
}
function spawn(state: MatchState, player: MatchPlayer, arena: CompiledArena, events: ActorEvent[]): void {
  const location = selectSpawn(state, player.id, arena);
  Object.assign(player, createWorld(arena.arena).player, { id: player.id, ...location });
  player.lifeId++; player.weapon = createWeapon('pistol', `spawn:${state.code}:${player.id}:${player.lifeId}`); player.respawnTicks = 0; player.protectionTicks = MATCH_CONFIG.protectionTicks;
  events.push(eventFor(state, player, { type: 'targetRespawn', x: player.x + player.width / 2, y: player.y + player.height / 2 }, events.length));
}
function die(state: MatchState, victim: MatchPlayer, events: ActorEvent[], killer?: MatchPlayer, impactDirection: Vec2 = { x: 0, y: -1 }): void {
  dropWeapons(state, victim, equippedWeapons(victim).map(entry => entry.weapon));
  victim.health = 0; victim.deaths++; victim.respawnTicks = MATCH_CONFIG.respawnTicks;
  victim.protectionTicks = 0; victim.thrusting = false; victim.thrustLatched = false; victim.jumpBufferTicks = 0;
  if (killer && killer.id !== victim.id) killer.kills++;
  events.push(eventFor(state, victim, { type: 'targetDeath', x: victim.x + victim.width / 2,
    y: victim.y + victim.height / 2, targetId: victim.id, targetLifeId: victim.lifeId, impactDirection,
    cosmeticSeed: (state.tick * 1664525 + victim.lifeId) >>> 0,
    deathPose: { x: victim.x, y: victim.y, width: victim.width, height: victim.height, aimAngle: victim.aimAngle,
      crouchAmount: victim.crouchAmount, vx: victim.vx, vy: victim.vy, appearance: victim.appearance },
    ...(killer ? { killerId: killer.id } : {}) }, events.length));
}
function beginMatch(state: MatchState, arena: CompiledArena, events: ActorEvent[]): void {
  state.phase = 'playing'; state.countdownTicks = 0; state.remainingTicks = MATCH_CONFIG.durationTicks; state.winnerIds = [];
  resetPickups(state, arena);
  for (const player of ordered(state)) { player.health = 0; player.kills = 0; player.deaths = 0; }
  for (const player of ordered(state)) spawn(state, player, arena, events);
}
export function returnToLobby(state: MatchState, hostId: string, map: Arena | CompiledArena): boolean {
  if (state.phase !== 'results' || state.hostId !== hostId || !state.players[hostId]?.connected) return false;
  const { arena } = compiled(map);
  state.pickups = {}; state.sniperWarningTicks = 0;
  state.phase = 'lobby'; state.countdownTicks = 0; state.remainingTicks = MATCH_CONFIG.durationTicks; state.winnerIds = [];
  for (const player of ordered(state)) {
    Object.assign(player, createWorld(arena).player, { id: player.id });
    player.ready = false; player.kills = 0; player.deaths = 0; player.respawnTicks = 0; player.protectionTicks = 0;
  }
  return true;
}

/** One input per actor per tick; collecting all shots before damage allows genuine same-tick trades. */
export function stepMatch(state: MatchState, inputs: Readonly<Record<string, NetworkInput | undefined>>, map: Arena | CompiledArena, history?: TargetHistory): ActorEvent[] {
  const arena = compiled(map), events: ActorEvent[] = [];
  if (state.phase === 'countdown') {
    if (!canStart(state)) cancelCountdown(state);
    else if (--state.countdownTicks === 0) beginMatch(state, arena, events);
    state.tick++; return events;
  }
  if (state.phase !== 'playing') { state.tick++; return events; }
  advancePickups(state, arena, events);
  const punches: Array<{ player: MatchPlayer; event: Extract<ActorEvent, { type: 'melee' | 'meleeStart' }> }> = [];
  const shots: Array<{ player: MatchPlayer; input: NetworkInput; event: Extract<ActorEvent, { type: 'shot' }> }> = [];
  const justSpawned = new Set<string>();
  for (const player of ordered(state)) {
    if (player.health <= 0) {
      player.respawnTicks = Math.max(0, player.respawnTicks - 1);
      if (player.respawnTicks === 0 && player.connected) { spawn(state, player, arena, events); justSpawned.add(player.id); }
      continue;
    }
    const input = player.connected ? inputs[player.id] ?? neutralInput(player.aimAngle) : neutralInput(player.aimAngle);
    const actorEvents = stepPredictedActor(player, input, arena);
    if (arena.arena.openFloor && player.y > arena.arena.height) { die(state, player, events); continue; }
    for (const event of actorEvents) {
      const authoritative = { ...event, id: `${state.tick}:${player.id}:${events.length}` };
      events.push(authoritative);
      if (authoritative.type === 'meleeStart') player.protectionTicks = 0;
      if (authoritative.type === 'melee') punches.push({ player, event: authoritative });
      if (authoritative.type === 'shot') {
        player.protectionTicks = 0;
        shots.push({ player, input, event: authoritative });
      }
    }
  }
  const hits: Array<{ shooter: MatchPlayer; target: MatchPlayer; shotId?: string; x: number; y: number; damage: number; direction: Vec2;
    weaponId?: WeaponId; hand?: WeaponHand; region?: HitRegion; melee?: boolean }> = [];
  for (const { player: shooter, input, event } of shots) {
    const origin = { x: event.originX, y: event.originY }, direction = { x: event.directionX, y: event.directionY };
    let distance = event.distance, selected: MatchPlayer | undefined;
    let protectedTarget = false, selectedRegion: HitRegion = 'body';
    for (const target of ordered(state)) {
      if (target.id === shooter.id || target.health <= 0) continue;
      const rectangle = history ? history(shooter, target, input) : target;
      if (!rectangle || rectangle.lifeId !== target.lifeId || (rectangle.health !== undefined && rectangle.health <= 0)) continue;
      const contact = rayHitRegions(origin, direction, rectangle, distance);
      const targetDistance = contact?.distance ?? null;
      // Cover wins numerically coincident surfaces. Player ties follow stable roster order.
      if (targetDistance !== null && isCloserHit(targetDistance, distance)) {
        distance = targetDistance; selected = target; selectedRegion = contact!.region;
        // Protection is current authority: firing cancels it immediately, including same-tick trades.
        protectedTarget = target.protectionTicks > 0;
      }
    }
    if (selected) {
      event.distance = distance;
      event.toX = origin.x + direction.x * distance; event.toY = origin.y + direction.y * distance;
      if (distance < Math.hypot(event.x - origin.x, event.y - origin.y)) { event.x = origin.x; event.y = origin.y; }
      event.hit = !protectedTarget; event.surface = 'body';
      event.targetId = selected.id; event.targetLifeId = selected.lifeId;
      if (!protectedTarget) hits.push({ shooter, target: selected, shotId: event.shotId, x: event.toX, y: event.toY, direction,
        damage: calculateDamage(event.weaponId, selectedRegion, distance), weaponId: event.weaponId, hand: event.hand, region: selectedRegion });
    }
  }
  for (const { player: shooter, event } of punches) {
    const origin = { x: event.x, y: event.y }, direction = { x: Math.cos(event.aimAngle), y: Math.sin(event.aimAngle) };
    let selected: MatchPlayer | undefined, point: Vec2 | undefined, distance = Infinity;
    for (const target of ordered(state)) {
      if (target.id === shooter.id || target.health <= 0) continue;
      const contact = resolveMeleeTarget(origin, direction, target, arena.solids);
      if (!contact) continue;
      const d = Math.hypot(contact.x - origin.x, contact.y - origin.y);
      if (d < distance) { selected = target; point = contact; distance = d; }
    }
    if (selected && point && selected.protectionTicks <= 0) hits.push({ shooter, target: selected, x: point.x, y: point.y,
      damage: MELEE_CONFIG.damage, direction, melee: true });
  }
  for (const hit of hits) {
    if (hit.target.health <= 0) continue;
    const damage = Math.min(hit.damage, hit.target.health);
    hit.target.health -= damage;
    if (hit.melee) applyKnockback(hit.target, hit.direction);
    events.push(eventFor(state, hit.shooter, { type: 'hit', x: hit.x, y: hit.y, damage,
      targetId: hit.target.id, targetLifeId: hit.target.lifeId, shotId: hit.shotId, weaponId: hit.weaponId, hand: hit.hand, region: hit.region }, events.length));
    if (hit.target.health === 0) die(state, hit.target, events, hit.shooter, hit.direction);
  }
  collectPickups(state, inputs, arena, events);
  for (const player of ordered(state)) if (!justSpawned.has(player.id)) player.protectionTicks = Math.max(0, player.protectionTicks - 1);
  if (--state.remainingTicks <= 0) {
    state.remainingTicks = 0; state.phase = 'results';
    const players = ordered(state), best = Math.max(0, ...players.map(p => p.kills));
    state.winnerIds = players.filter(p => p.kills === best).map(p => p.id);
    for (const player of players) { player.thrusting = false; player.thrustLatched = false; }
  }
  state.tick++;
  return events;
}
