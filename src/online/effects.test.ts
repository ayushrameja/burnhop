import { describe, expect, it } from 'vitest';
import type { ActorEvent } from '../multiplayer/model';
import { OnlineEffects, currentLifeEvent, PRESENTATION_EVENT_LIMIT, queuePresentationEvents, resetPresentationEvents } from './effects';

const shot = (id: string, actorId = 'me', lifeId = 1): ActorEvent => ({ id, actorId, lifeId,
  shotId: `${actorId}:${lifeId}:42`, type: 'shot', weaponId: 'pistol', hand: 'main', instanceId: 'test-pistol', shotCounter: 1, originX: 0, originY: 0, directionX: 1, directionY: 0, range: 1000, distance: Math.hypot(30, 30), x: 10, y: 10, toX: 30, toY: 30, hit: false });

describe('online effect identity', () => {
  it('deduplicates predicted shots by shotId and received messages by event id', () => {
    const effects = new OnlineEffects();
    expect(effects.predicted([shot('predicted')])).toHaveLength(1);
    expect(effects.predicted([shot('predicted')])).toEqual([]);
    expect(effects.authoritative([shot('server')], 'me')).toEqual([]);
    expect(effects.authoritative([shot('remote', 'other')], 'me')).toHaveLength(1);
    expect(effects.authoritative([shot('remote', 'other')], 'me')).toEqual([]);
  });
  it('keeps confirmed hits even after predicting their shot, and never predicts damage', () => {
    const effects = new OnlineEffects(); effects.predicted([shot('predicted')]);
    const hit: ActorEvent = { id: 'confirmed', actorId: 'me', targetId: 'other', lifeId: 1,
      shotId: 'me:1:42', type: 'hit', x: 30, y: 30, damage: 20 };
    expect(effects.authoritative([hit], 'me')).toEqual([hit]);
    expect(effects.predicted([{ ...hit, id: 'optimistic-hit' }])).toEqual([]);
  });
  it('does not confuse the same input counter across different actor lives', () => {
    const effects = new OnlineEffects(); effects.predicted([shot('old-life')]);
    expect(effects.authoritative([shot('new-life', 'me', 2)], 'me')).toHaveLength(1);
  });
  it('allows a later unpredicted cue of the same type while suppressing the exact predicted input cue', () => {
    const effects = new OnlineEffects();
    const jump: ActorEvent = { id: 'predicted-jump', actorId: 'me', lifeId: 1, inputId: 4, type: 'jump', x: 0, y: 0 };
    effects.predicted([jump]);
    expect(effects.authoritative([{ ...jump, id: 'confirmed-jump' }], 'me')).toEqual([]);
    expect(effects.authoritative([{ ...jump, id: 'later-jump', inputId: 8 }], 'me')).toHaveLength(1);
  });
});

describe('bounded presentation delivery through lifecycle resets', () => {
  const death: ActorEvent = { id: '12:me:4', actorId: 'me', targetId: 'me', lifeId: 2, targetLifeId: 2,
    type: 'targetDeath', x: 20, y: 30, killerId: 'other', cosmeticSeed: 123 };

  it('retains the authoritative local death while discarding predicted shots on a same-life reset', () => {
    const effects = new OnlineEffects();
    const predicted = shot('predicted:me:2:4:0', 'me', 2);
    const queue = [...effects.predicted([predicted]), ...effects.authoritative([death], 'me')];
    resetPresentationEvents(queue);
    expect(queue).toEqual([death]);
    expect(currentLifeEvent(queue[0], 2, 2)).toBe(true);
    // Keeping the delivery ledger across death/resync prevents a duplicate body.
    expect(effects.authoritative([death], 'me')).toEqual([]);
    expect(effects.authoritative([shot('confirmed-prediction', 'me', 2)], 'me')).toEqual([]);
  });

  it('rejects stale target/source lives after respawn, and clears everything at a new match phase', () => {
    expect(currentLifeEvent(death, 3, 3)).toBe(false);
    expect(currentLifeEvent({ ...death, actorId: 'other', lifeId: 8 }, 8, 3)).toBe(false);
    expect(currentLifeEvent(death, undefined, undefined)).toBe(true);
    const queue = [death]; resetPresentationEvents(queue, true); expect(queue).toEqual([]);
  });

  it('retains only the newest 512 events after a stalled frame, including oversized batches', () => {
    const incoming = Array.from({ length: 1400 }, (_, index) => shot(`server:${index}`, 'other'));
    const queue: ActorEvent[] = [];
    queuePresentationEvents(queue, incoming.slice(0, 400));
    queuePresentationEvents(queue, incoming.slice(400));
    expect(queue).toHaveLength(PRESENTATION_EVENT_LIMIT);
    expect(queue).toEqual(incoming.slice(-PRESENTATION_EVENT_LIMIT));
  });

  it('drops hidden-tab delivery after deduplication instead of replaying it on return', () => {
    const effects = new OnlineEffects(), queue = [shot('old-render')];
    queuePresentationEvents(queue, effects.authoritative([death], 'me'), true);
    expect(queue).toEqual([]);
    queuePresentationEvents(queue, effects.authoritative([death], 'me'));
    expect(queue).toEqual([]);
    const next = { ...death, id: '13:me:5' };
    queuePresentationEvents(queue, effects.authoritative([next], 'me'));
    expect(queue).toEqual([next]);
  });
});
