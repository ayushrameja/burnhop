import type { ActorEvent } from '../multiplayer/model';

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
      if (event.inputId !== undefined) this.remember(this.predictedCues, `${event.actorId}:${event.lifeId}:${event.inputId}:${event.type}`);
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
      if (['jump', 'land', 'reloadStart', 'reloadEnd'].includes(event.type)
        && event.inputId !== undefined && this.predictedCues.has(`${event.actorId}:${event.lifeId}:${event.inputId}:${event.type}`)) return false;
      return true;
    });
  }
  reset(): void { this.seen.clear(); this.predictedShots.clear(); this.predictedCues.clear(); }
}
