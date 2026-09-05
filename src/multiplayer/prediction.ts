import { stepActor, type CompiledArena } from '../game/simulation';
import type { ActorEvent, NetworkInput } from './model';
import type { PlayerState } from '../game/types';

/** Pure simulation only: historical replay does not read browser controls or emit presentation effects. */
export function stepPredictedActor(player: PlayerState, input: NetworkInput, arena: CompiledArena): ActorEvent[] {
  const lifeId = 'lifeId' in player ? Number(player.lifeId) : 0;
  return stepActor(player, {
    moveX: input.moveX, jumpPressed: input.jumpPressed, jumpHeld: input.jumpHeld,
    jetpack: { source: input.jetSeparate ? 'separate' : 'combined', pressed: input.jetPressed, held: input.jetHeld },
    crouchHeld: input.crouchHeld, fireHeld: input.fireHeld, reloadPressed: input.reloadPressed, aimAngle: input.aimAngle,
  }, arena).map((event, index) => ({ ...event,
    id: `predicted:${player.id}:${lifeId}:${input.inputId}:${index}`, actorId: player.id, lifeId, inputId: input.inputId,
    ...(event.type === 'shot' ? { shotId: `${player.id}:${lifeId}:${input.inputId}` } : {}),
  }));
}
