import type { CompiledArena } from '../game/simulation';
import type { ActorEvent, NetworkInput } from '../multiplayer/model';
import { stepPredictedActor } from '../multiplayer/prediction';
import { playerFromWire, syncPlayerWire, type PlayerWire } from '../multiplayer/wire';

/** Colyseus restores every flat schema scalar before this pure replay adapter runs. */
export function stepWireActor(mirror: PlayerWire, input: NetworkInput, arena: CompiledArena): ActorEvent[] {
  const actor = playerFromWire(mirror);
  const events = stepPredictedActor(actor, input, arena);
  syncPlayerWire(mirror, actor);
  return events;
}
