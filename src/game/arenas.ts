export type ArenaId = 'range' | 'outpost';

export interface ArenaDefinition {
  id: ArenaId;
  name: string;
  eyebrow: string;
  description: string;
  dataPath: string;
  preview?: string;
}

export const ARENAS: readonly ArenaDefinition[] = [
  {
    id: 'range',
    name: 'Practice range',
    eyebrow: 'Learn the controls',
    description: 'Open sightlines and four platforms. Find your aim, then take flight.',
    dataPath: '/assets/arena.json',
  },
  {
    id: 'outpost',
    name: 'Outpost',
    eyebrow: 'Classic layout',
    description: 'Rocky islands, sheltered tunnels and high jet routes. A familiar place to fly.',
    dataPath: '/assets/outpost.json',
    preview: '/assets/outpost-preview.svg',
  },
];

export function arenaIdFromSearch(search: string): ArenaId {
  return new URLSearchParams(search).get('map') === 'outpost' ? 'outpost' : 'range';
}

export function getArena(id: ArenaId): ArenaDefinition {
  return ARENAS.find(arena => arena.id === id)!;
}
