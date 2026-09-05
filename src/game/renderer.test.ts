import { afterEach, describe, expect, it, vi } from 'vitest';
import arena from '../../public/assets/arena.json';
import { Renderer } from './renderer';
import { CONFIG, cloneWorld, createWorld } from './simulation';
import { ZOOM_SCALES, type ZoomLevel } from './camera';
import { DEFAULT_APPEARANCE } from './appearance';
import { CHARACTER_SCALE, getStanceHeight } from './stance';
import { calculateCharacterPose } from './character';
import { calculateDetailedCharacterRig } from './detailedCharacter';
import { getReloadProgress } from './reload';

// Real rendering calculations with an inert drawing surface: no browser timing assumptions.
function setup(width = 1280, height = 720) {
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  const noop = () => {};
  const rotate = vi.fn();
  const context = new Proxy<Record<string, unknown>>({
    createLinearGradient: () => ({ addColorStop: noop }), rotate,
  }, { get: (target, key: string) => target[key] ?? noop });
  const canvas = {
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 80, top: 40, width, height }),
    width: 0, height: 0,
  } as unknown as HTMLCanvasElement;
  const renderer = new Renderer(canvas, { arena, images: {} });
  const world = createWorld(arena);
  renderer.render(world, world, 0, DEFAULT_APPEARANCE, [], 0);
  return { renderer, world, rotate };
}

afterEach(() => vi.unstubAllGlobals());

describe('live visual aim', () => {
  it('draws the reload from simulation ticks without advancing it or moving the firing direction', () => {
    const { renderer, world, rotate } = setup();
    world.player.aimAngle = .3;
    world.player.weapon.reloadTicks = 48;
    const frozenWorld = cloneWorld(world);
    const expected = calculateDetailedCharacterRig({
      aimAngle: .3, crouchAmount: world.player.crouchAmount,
      reloadProgress: getReloadProgress(world.player.weapon.reloadTicks, CONFIG.reloadTicks),
    });
    for (const dt of [0, .05, 0]) {
      rotate.mockClear();
      renderer.render(world, world, 1, DEFAULT_APPEARANCE, [], dt);
      expect(renderer.getRenderedAimAngle()).toBe(.3);
      expect(rotate).toHaveBeenCalledWith(expected.rifle.angle);
      expect(rotate).toHaveBeenLastCalledWith(expected.supportHandAngle);
      const dash = renderer.getAimDiagnostics()!;
      expect(Math.atan2(dash.end.y - dash.start.y, dash.end.x - dash.start.x)).toBeCloseTo(.3);
      expect(world).toEqual(frozenWorld);
    }
  });

  it('moves the gun and dash every rendered frame without waiting for a simulation tick', () => {
    const { renderer, world, rotate } = setup();
    const original = cloneWorld(world);
    const pivot = renderer.getAimDiagnostics()!.pivot;
    const screen = renderer.worldToScreen(pivot.x, pivot.y);
    for (const angle of [-Math.PI / 2, Math.PI / 2, 0]) {
      const pointer = { x: screen.x + Math.cos(angle) * 100, y: screen.y + Math.sin(angle) * 100 };
      renderer.render(world, world, 0, DEFAULT_APPEARANCE, [], 1 / 144, false, false, 'radial', { pointer, previousAngle: 0 });
      expect(renderer.getRenderedAimAngle()).toBeCloseTo(angle);
      expect(rotate).toHaveBeenLastCalledWith(angle);
      const dash = renderer.getAimDiagnostics()!;
      expect(Math.atan2(dash.end.y - dash.start.y, dash.end.x - dash.start.x)).toBeCloseTo(angle);
      expect(world).toEqual(original);
    }
  });

  it('resolves against the displayed pivot after this frame moves the camera', () => {
    const { renderer, world } = setup();
    const next = cloneWorld(world);
    // Move far enough for the interpolated camera anchor to leave the left-edge clamp.
    next.player.x += 1000;
    const oldProjection = renderer.worldToScreen(0, 0);
    const pointer = { x: 850, y: 400 };
    renderer.render(world, next, .5, DEFAULT_APPEARANCE, [], 1 / 60, false, false, 'radial', { pointer, previousAngle: 0 });
    const reticle = renderer.getAimDiagnostics()!;
    const screen = renderer.worldToScreen(reticle.pivot.x, reticle.pivot.y);
    expect(reticle.pivot.x).toBe(world.player.x + 500 + world.player.width / 2);
    expect(renderer.worldToScreen(0, 0).x).toBeLessThan(oldProjection.x);
    expect(renderer.getRenderedAimAngle()).toBeCloseTo(Math.atan2(pointer.y - screen.y, pointer.x - screen.x), 10);
  });

  it('keeps the virtual pointer bounds inside letterboxing and independent of device density', () => {
    const { renderer } = setup(1024, 768);
    expect(renderer.getPointerBounds()).toEqual({ left: 80, top: 136, right: 1104, bottom: 712 });
  });

  it('interpolates crouch from planted feet and keeps the visible gun on the aim origin across facing changes', () => {
    const { renderer, world } = setup();
    const next = cloneWorld(world);
    const feetY = world.player.y + world.player.height;
    next.player.crouchAmount = 1;
    next.player.height = getStanceHeight(1);
    next.player.y = feetY - next.player.height;
    for (const alpha of [0, .25, .5, .75, 1]) {
      for (const side of [-1, 1]) {
        const pointer = renderer.worldToScreen(world.player.x + side * 200, feetY - 90);
        renderer.render(world, next, alpha, DEFAULT_APPEARANCE, [], 0, false, false, 'radial', { pointer, previousAngle: 0 });
        const aimAngle = renderer.getRenderedAimAngle();
        const geometry = calculateCharacterPose({ aimAngle, crouchAmount: alpha, locomotion: true });
        const pivot = renderer.getAimDiagnostics()!.pivot;
        const facing = Math.cos(aimAngle) >= 0 ? 1 : -1;
        expect(facing).toBe(side);
        expect(pivot.x).toBeCloseTo(world.player.x + world.player.width / 2 + geometry.weaponOffset.x * facing * CHARACTER_SCALE, 10);
        expect(pivot.y).toBeCloseTo(feetY + (-38 + geometry.weaponOffset.y) * CHARACTER_SCALE, 10);
        const projected = renderer.worldToScreen(pivot.x, pivot.y);
        expect(aimAngle).toBeCloseTo(Math.atan2(pointer.y - projected.y, pointer.x - projected.x), 10);
      }
    }
    expect(next.player.y + next.player.height).toBe(feetY);
  });
});

describe('camera and zoom presentation', () => {
  it('starts with the largest pilot at 1× and makes the projected pilot smaller at 3× and 5×', () => {
    const { renderer, world } = setup();
    expect(renderer.getCameraDiagnostics().zoomLevel).toBe(1);
    const heights: number[] = [];
    for (const level of [1, 3, 5] as ZoomLevel[]) {
      renderer.setZoom(level);
      const top = renderer.worldToScreen(world.player.x, world.player.y);
      const feet = renderer.worldToScreen(world.player.x, world.player.y + world.player.height);
      heights.push(feet.y - top.y);
    }
    expect(heights[0]).toBeCloseTo(world.player.height * 1.5);
    expect(heights[1]).toBeCloseTo(world.player.height * 1.1);
    expect(heights[2]).toBeCloseTo(world.player.height * 0.75);
    expect(heights[0]).toBeGreaterThan(heights[1]);
    expect(heights[1]).toBeGreaterThan(heights[2]);
  });

  it('snaps zoom around the last interpolated anchor before another render', () => {
    const { renderer, world } = setup();
    world.player.x = 1000;
    world.player.y = 700;
    const next = cloneWorld(world);
    next.player.x = 1200;
    next.player.y = 600;
    renderer.render(world, next, .5, DEFAULT_APPEARANCE, [], 1 / 60);
    const anchor = { x: 1100 + CONFIG.bodyWidth / 2, y: 650 + CONFIG.bodyHeight / 2 };
    renderer.setZoom(5);
    const screen = renderer.worldToScreen(anchor.x, anchor.y);
    expect(screen.x).toBeCloseTo(720, 10);
    expect(screen.y).toBeCloseTo(400, 10);
    expect(renderer.getCameraDiagnostics()).toEqual({
      zoomLevel: 5,
      scale: 0.75,
      position: { x: anchor.x - 1280 / 0.75 / 2, y: anchor.y - 720 / 0.75 / 2 },
      viewport: { width: 1280 / 0.75, height: 720 / 0.75 },
    });
  });

  it('preserves screen/world projections, pointer bounds and visual aim at every zoom', () => {
    const { renderer, world } = setup(1024, 768);
    const pointer = { x: 800, y: 320 };
    renderer.setPointer(pointer.x, pointer.y);
    const before = cloneWorld(world);
    for (const level of [5, 1, 3] as ZoomLevel[]) {
      renderer.setZoom(level);
      expect(renderer.getCameraDiagnostics().scale).toBe(ZOOM_SCALES[level]);
      expect(renderer.getPointerBounds()).toEqual({ left: 80, top: 136, right: 1104, bottom: 712 });
      const point = renderer.screenToWorld(pointer.x, pointer.y);
      const projected = renderer.worldToScreen(point.x, point.y);
      expect(projected.x).toBeCloseTo(pointer.x, 10);
      expect(projected.y).toBeCloseTo(pointer.y, 10);
      for (const mode of ['radial', 'pointer'] as const) {
        renderer.render(world, world, 1, DEFAULT_APPEARANCE, [], 1 / 144, false, false, mode, { pointer, previousAngle: 0 });
        const reticle = renderer.getAimDiagnostics()!;
        const pivot = renderer.worldToScreen(reticle.pivot.x, reticle.pivot.y);
        expect(renderer.getRenderedAimAngle()).toBeCloseTo(Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x), 10);
        if (mode === 'pointer') {
          const crosshair = renderer.worldToScreen(reticle.start.x, reticle.start.y);
          expect(crosshair.x).toBeCloseTo(pointer.x, 10);
          expect(crosshair.y).toBeCloseTo(pointer.y, 10);
        }
      }
    }
    expect(world).toEqual(before);
  });

  it('does not move the camera when a stationary character crouches', () => {
    const { renderer, world } = setup();
    world.player.x = 1100;
    world.player.y = 650;
    renderer.render(world, world, 1, DEFAULT_APPEARANCE, [], 0);
    renderer.setZoom(5);
    const camera = renderer.getCameraDiagnostics().position;
    const crouched = cloneWorld(world);
    const feetY = world.player.y + world.player.height;
    crouched.player.height = getStanceHeight(1);
    crouched.player.y = feetY - crouched.player.height;
    crouched.player.crouchAmount = 1;
    for (const alpha of [0, .25, .5, .75, 1]) {
      renderer.render(world, crouched, alpha, DEFAULT_APPEARANCE, [], 1 / 60);
      expect(renderer.getCameraDiagnostics().position).toEqual(camera);
    }
  });
});
