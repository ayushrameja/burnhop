import { afterEach, describe, expect, it, vi } from 'vitest';
import arena from '../../public/assets/arena.json';
import { DEFAULT_APPEARANCE } from '../game/appearance';
import { getCameraTarget } from '../game/camera';
import { drawDetailedCharacter } from '../game/detailedCharacter';
import { Renderer, type OnlineRenderActor } from '../game/renderer';
import { CONFIG, createWorld } from '../game/simulation';

vi.mock('../game/detailedCharacter', () => ({ drawDetailedCharacter: vi.fn() }));
function setup() {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const noop = () => {};
  const context = new Proxy<Record<string, unknown>>({ createLinearGradient: () => ({ addColorStop: noop }) },
    { get: (target, key: string) => target[key] ?? noop });
  const canvas = { getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) } as unknown as HTMLCanvasElement;
  const renderer = new Renderer(canvas, { arena, images: {} });
  const player = createWorld(arena).player;
  const actors: OnlineRenderActor[] = ['me', 'other'].map((id, index) => ({ player: { ...player, weapon: { ...player.weapon }, id, x: player.x + index * 200 },
    appearance: { ...DEFAULT_APPEARANCE }, nickname: id, connected: true, protected: false, lifeId: 1 }));
  renderer.renderOnline(actors, 'me', 1, [], 1 / 60);
  vi.mocked(drawDetailedCharacter).mockClear();
  return { renderer, actors };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('online actor presentation', () => {
  it('gives remote shots their own recoil and gives only the damaged pilot a hit flash', () => {
    const { renderer, actors } = setup();
    renderer.renderOnline(actors, 'me', 2, [
      { actorId: 'other', type: 'shot', x: 0, y: 0, toX: 100, toY: 100, hit: true },
      { actorId: 'other', targetId: 'me', type: 'hit', x: 100, y: 100, damage: 20 },
    ], 1 / 60);
    const poses = vi.mocked(drawDetailedCharacter).mock.calls;
    const local = poses.find(call => call[1] === actors[0].player.x + actors[0].player.width / 2)![4];
    const remote = poses.find(call => call[1] === actors[1].player.x + actors[1].player.width / 2)![4];
    expect(local.recoil).toBe(0); expect(local.hit).toBe(true);
    expect(remote.recoil).toBeGreaterThan(0); expect(remote.hit).toBe(false);
    renderer.destroy();
  });
  it('snaps the camera to a new life without drawing a dead actor or the practice target', () => {
    const { renderer, actors } = setup();
    actors[0].player.x += 1000; actors[1].player.health = 0;
    renderer.resetOnlinePresentation();
    renderer.renderOnline(actors, 'me', 3, [], 1 / 60);
    expect(drawDetailedCharacter).toHaveBeenCalledTimes(1);
    const me = actors[0].player;
    expect(renderer.camera).toEqual(getCameraTarget({ x: me.x + me.width / 2, y: me.y + me.height - CONFIG.bodyHeight / 2 }, arena, renderer.getCameraDiagnostics().scale));
    renderer.destroy();
  });
});
