import type { ActorEvent } from '../multiplayer/model';

export const PRESENTATION_EVENT_LIMIT = 512;

/** A hidden or stalled renderer must never accumulate an entire match of effects. */
export function queuePresentationEvents(queue: ActorEvent[], incoming: readonly ActorEvent[], hidden = false): void {
  if (hidden) { queue.length = 0; return; }
  const latest = incoming.length > PRESENTATION_EVENT_LIMIT ? incoming.slice(-PRESENTATION_EVENT_LIMIT) : incoming;
  const overflow = queue.length + latest.length - PRESENTATION_EVENT_LIMIT;
  if (overflow > 0) queue.splice(0, overflow);
  queue.push(...latest);
}

/** Resetting prediction does not invalidate confirmed damage or a same-life death pose. */
export function resetPresentationEvents(queue: ActorEvent[], phaseChanged = false): void {
  if (phaseChanged) { queue.length = 0; return; }
  let count = 0;
  for (const event of queue) if (!event.id.startsWith('predicted:')) queue[count++] = event;
  queue.length = count;
}

export function currentLifeEvent(event: ActorEvent, sourceLife?: number, targetLife?: number): boolean {
  return (sourceLife === undefined || event.lifeId >= sourceLife)
    && (targetLife === undefined || event.targetLifeId === undefined || event.targetLifeId >= targetLife);
}

const cueKey = (event: ActorEvent) => `${event.actorId}:${event.lifeId}:${event.inputId}:${event.type}:${'hand' in event ? event.hand : ''}:${'instanceId' in event ? event.instanceId : ''}`;

/** Separate event delivery IDs from shot prediction IDs; replay never touches this ledger. */
export class OnlineEffects {
  private seen = new Set<string>();
  private predictedShots = new Set<string>();
  private predictedCues = new Set<string>();
  private remember(set: Set<string>, key: string): void {
    set.add(key);
    if (set.size > 1024) set.delete(set.values().next().value!);
  }
  predicted(events: ActorEvent[]): ActorEvent[] {
    return events.filter(event => {
      if (this.seen.has(event.id)) return false;
      this.remember(this.seen, event.id);
      if (event.shotId) this.remember(this.predictedShots, event.shotId);
      if (event.inputId !== undefined) this.remember(this.predictedCues, cueKey(event));
      return event.type !== 'hit' && event.type !== 'targetDeath' && event.type !== 'targetRespawn';
    });
  }
  authoritative(events: ActorEvent[], localId: string): ActorEvent[] {
    return events.filter(event => {
      if (this.seen.has(event.id)) return false;
      this.remember(this.seen, event.id);
      if (event.actorId !== localId) return true;
      if (event.type === 'shot' && event.shotId && this.predictedShots.has(event.shotId)) return false;
      // Locally predicted movement/reload cues never repeat on server confirmation.
      if (['jump', 'land', 'reloadStart', 'reloadEnd', 'meleeStart', 'melee', 'dryfire'].includes(event.type)
        && event.inputId !== undefined && this.predictedCues.has(cueKey(event))) return false;
      return true;
    });
  }
  reset(): void { this.seen.clear(); this.predictedShots.clear(); this.predictedCues.clear(); }
}
