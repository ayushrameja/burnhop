import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import range from '../../public/assets/arena.json';
import { arenaIdFromSearch } from './arenas';
import { validateArena } from './loading';
import type { Arena } from './types';

vi.mock('./runtime', () => ({ GameRuntime: class {} }));

const outpost = (): Arena => ({
  ...structuredClone(range), id: 'outpost', name: 'Outpost', theme: 'outpost', openFloor: true,
  terrain: [{ id: 'island', material: 'rock', grass: true, points: [{ x: 100, y: 200 }, { x: 400, y: 200 }, { x: 350, y: 350 }, { x: 150, y: 330 }] }],
  spawnPoints: [{ id: 'west', ...range.playerSpawn }, { id: 'east', ...range.targetSpawn }],
});

describe('arena validation and selection', () => {
  it('preserves the existing range and accepts concave Outpost terrain', () => {
    expect(validateArena(range)).toBe(range);
    const arena = outpost();
    arena.terrain![0].points.splice(2, 0, { x: 250, y: 250 });
    expect(validateArena(arena)).toBe(arena);
  });

  it.each([
    ['too few points', [{ x: 100, y: 200 }, { x: 400, y: 200 }]],
    ['collinear points', [{ x: 100, y: 200 }, { x: 200, y: 200 }, { x: 400, y: 200 }]],
    ['crossing edges', [{ x: 10, y: 10 }, { x: 80, y: 80 }, { x: 10, y: 80 }, { x: 65, y: 10 }]],
    ['nonfinite points', [{ x: 100, y: 200 }, { x: Infinity, y: 200 }, { x: 350, y: 350 }]],
    ['out of bounds points', [{ x: -1, y: 200 }, { x: 400, y: 200 }, { x: 350, y: 350 }]],
  ])('rejects %s before runtime creation', (_, points) => {
    const arena = outpost();
    arena.terrain![0].points = points;
    expect(() => validateArena(arena)).toThrow('arena geometry is invalid');
  });

  it('rejects malformed metadata, duplicate IDs and out of bounds spawns', () => {
    for (const patch of [
      { theme: 'unknown' }, { openFloor: 'yes' }, { playerSpawn: { x: -1, y: 0 } },
      { spawnPoints: [{ id: 'same', x: 10, y: 10 }, { id: 'same', x: 20, y: 20 }] },
      { terrain: [{ ...outpost().terrain![0], material: 'unknown' }] },
      { terrain: [outpost().terrain![0], outpost().terrain![0]] },
      { platforms: [{ x: range.width - 10, y: 10, width: 100, height: 10 }] },
    ]) expect(() => validateArena({ ...outpost(), ...patch })).toThrow('arena geometry is invalid');
  });

  it('only accepts a known direct-selection parameter and keeps range as the default', () => {
    expect(arenaIdFromSearch('')).toBe('range');
    expect(arenaIdFromSearch('?map=unknown')).toBe('range');
    expect(arenaIdFromSearch('?map=outpost&preview=character')).toBe('outpost');
  });
});

describe('arena asset loading', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('document', { fonts: { load: vi.fn().mockResolvedValue([]) } });
    vi.stubGlobal('Image', class { src = ''; decode() { return Promise.resolve(); } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({
      ok: true,
      json: async () => path === '/assets/outpost.json' ? outpost() : structuredClone(range),
      text: async () => '<svg xmlns="http://www.w3.org/2000/svg" />',
    })));
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('deduplicates concurrent requests per map and never reuses another arena', async () => {
    const { loadGame } = await import('./loading');
    const rangeProgress = vi.fn(), outpostProgress = vi.fn();
    const rangeTask = loadGame(rangeProgress);
    const outpostTask = loadGame(outpostProgress, 'outpost');
    expect(loadGame(vi.fn(), 'outpost')).toBe(outpostTask);
    const [rangeAssets, outpostAssets] = await Promise.all([rangeTask, outpostTask]);
    expect(rangeAssets.arena.width).toBe(range.width);
    expect(rangeAssets.arena.id).toBeUndefined();
    expect(outpostAssets.arena.id).toBe('outpost');
    expect(rangeAssets).not.toBe(outpostAssets);
    expect(fetch).toHaveBeenCalledWith('/assets/arena.json', expect.anything());
    expect(fetch).toHaveBeenCalledWith('/assets/outpost.json', expect.anything());
    const requests = vi.mocked(fetch).mock.calls.length;
    expect(await loadGame(vi.fn(), 'outpost')).toBe(outpostAssets);
    expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
    expect(rangeProgress.mock.lastCall?.[0].progress).toBe(1);
    expect(outpostProgress.mock.lastCall?.[0].progress).toBe(1);
  });

  it('evicts failed loads so retry can fetch corrected map data', async () => {
    const { loadGame } = await import('./loading');
    vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true, json: async () => ({ bad: 'map' }) }) as Response);
    await expect(loadGame(vi.fn(), 'outpost')).rejects.toThrow('arena data is incomplete');
    const result = await loadGame(vi.fn(), 'outpost');
    expect(result.arena.id).toBe('outpost');
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => path === '/assets/outpost.json')).toHaveLength(2);
  });
});
