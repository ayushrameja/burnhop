import type { GameAssets } from './assets';
import { validateArena } from './arenaValidation';
export { validateArena } from './arenaValidation';
import { getArena, type ArenaId } from './arenas';

export interface LoadProgress { progress: number; label: string }
// Character parts are native Canvas paths; only environmental artwork needs decoding.
const ASSET_NAMES = ['insignia', 'range-banner'];

interface ArenaLoad {
  task: Promise<GameAssets>;
  progress: LoadProgress;
  listeners: Set<(state: LoadProgress) => void>;
}
const arenaLoads = new Map<ArenaId, ArenaLoad>();

async function request(path: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  return response;
}
async function decodeSvg(source: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  const image = new Image();
  image.src = url;
  try { await image.decode(); return image; }
  finally { URL.revokeObjectURL(url); }
}

export function loadGame(onProgress: (state: LoadProgress) => void, arenaId: ArenaId = 'range'): Promise<GameAssets> {
  const cached = arenaLoads.get(arenaId);
  if (cached) {
    onProgress(cached.progress);
    if (cached.progress.progress < 1) cached.listeners.add(onProgress);
    return cached.task;
  }
  const entry: ArenaLoad = { task: undefined as unknown as Promise<GameAssets>, progress: { progress: 0, label: `Opening ${getArena(arenaId).name.toLowerCase()}` }, listeners: new Set([onProgress]) };
  arenaLoads.set(arenaId, entry);
  entry.task = loadArena(state => {
    entry.progress = state;
    entry.listeners.forEach(listener => listener(state));
  }, arenaId).catch(error => {
    if (arenaLoads.get(arenaId) === entry) arenaLoads.delete(arenaId);
    throw error;
  }).finally(() => entry.listeners.clear());
  return entry.task;
}

async function loadArena(onProgress: (state: LoadProgress) => void, arenaId: ArenaId): Promise<GameAssets> {
  const definition = getArena(arenaId);
  const controller = new AbortController();
  let active = true;
  let timeout = 0;
  const deadline = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => {
      controller.abort();
      reject(new Error('Loading timed out. Check the connection and retry.'));
    }, 20000);
  });
  const total = 3 + ASSET_NAMES.length;
  let completed = 0;
  const advance = (label: string) => { if (active) onProgress({ progress: ++completed / total, label }); };
  onProgress({ progress: 0, label: `Opening ${definition.name.toLowerCase()}` });
  try {
    const runtimeTask = import('./runtime').then(() => advance('Gameplay systems ready'));
    const fontTask = Promise.all([
      document.fonts.load('800 16px "Barlow Condensed"'),
      document.fonts.load('700 16px "Barlow Condensed"'),
      document.fonts.load('600 16px "Barlow Condensed"'),
      document.fonts.load('400 16px "Barlow"'),
      document.fonts.load('600 16px "Barlow"'),
      document.fonts.load('700 16px "Barlow"'),
      document.fonts.load('800 16px "Barlow"'),
      document.fonts.load('400 12px "IBM Plex Mono"'),
      document.fonts.load('500 12px "IBM Plex Mono"'),
      document.fonts.load('600 12px "IBM Plex Mono"'),
    ]).then(() => advance('Field manual typography ready'));
    const arenaTask = request(definition.dataPath, controller.signal).then(r => r.json()).then(validateArena).then(arena => { advance(`${definition.name} surveyed`); return arena; });
    const images: Record<string, HTMLImageElement> = {};
    const imageTasks = ASSET_NAMES.map(async name => {
      const source = await (await request(`/assets/${name}.svg`, controller.signal)).text();
      images[name] = await decodeSvg(source);
      advance(`Artwork decoded · ${name}`);
    });
    const [arena] = await Promise.race([Promise.all([arenaTask, runtimeTask, fontTask, ...imageTasks]), deadline]);
    return { arena, images };
  } catch (error) {
    controller.abort();
    throw new Error(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Loading timed out. Check the connection and retry.');
  } finally { active = false; window.clearTimeout(timeout); }
}
