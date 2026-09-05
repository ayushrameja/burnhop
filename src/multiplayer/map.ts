import authoredOutpost from '../../public/assets/outpost.json';
import { validateArena } from '../game/arenaValidation';
import { CONFIG } from '../game/simulation';

function freezeGeometry<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeGeometry(child);
    Object.freeze(value);
  }
  return value;
}

/** Both bundles use this exact immutable authored map; the server never fetches Vercel assets. */
export const OUTPOST_ARENA = freezeGeometry(validateArena(authoredOutpost));
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 0x01000193);
  return (result >>> 0).toString(16).padStart(8, '0');
}
// Increment the gameplay revision when simulation behavior changes without tuning/schema changes.
export const COMPATIBILITY_ID = `burnhop-1:gameplay-1:${hash(JSON.stringify(CONFIG))}:${hash(JSON.stringify(authoredOutpost))}`;
