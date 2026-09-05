import { describe, expect, it } from 'vitest';
import type { ActorEvent } from '../multiplayer/model';
import { OnlineEffects } from './effects';

const shot = (id: string, actorId = 'me', lifeId = 1): ActorEvent => ({ id, actorId, lifeId,
  shotId: `${actorId}:${lifeId}:42`, type: 'shot', x: 10, y: 10, toX: 30, toY: 30, hit: false });

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
