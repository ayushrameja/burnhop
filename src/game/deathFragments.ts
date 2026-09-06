import type { DetailedAppearance } from './appearance';
import type { CharacterPose } from './character';
import { drawCharacterFragment, getCharacterFragmentAnchors, type CharacterFragmentKind } from './detailedCharacter';
import { moveAndCollide, type CollisionSolid } from './collision';
import type { CharacterParts } from './characterParts';
import { CHARACTER_SCALE } from './stance';
import type { Rect, Vec2, WeaponId } from './types';

export interface DeathFragmentPose extends Rect {
  aimAngle: number;
  crouchAmount: number;
  vx: number;
  vy: number;
  appearance: DetailedAppearance;
  weaponId?: WeaponId;
}
interface Fragment extends Rect {
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  age: number;
  grounded: boolean;
  bounces: number;
  kind: CharacterFragmentKind;
  pose: CharacterPose;
  appearance: DetailedAppearance;
  facing: number;
  reducedMotion: boolean;
}
const KINDS: readonly CharacterFragmentKind[] = ['head', 'torso', 'farArm', 'nearArm', 'farLeg', 'nearLeg'];
const GROUPS: readonly CharacterFragmentKind[] = ['legs', 'upperBody', 'head'];
const SIZE: Record<CharacterFragmentKind, Vec2> = {
  head: { x: 23, y: 26 },
  torso: { x: 32, y: 28 },
  farArm: { x: 10, y: 22 },
  nearArm: { x: 10, y: 22 },
  farLeg: { x: 12, y: 26 },
  nearLeg: { x: 12, y: 26 },
  upperBody: { x: 48, y: 36 },
  legs: { x: 32, y: 30 },
};

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Bounded client-only toy physics. These pieces never enter damage, input, snapshots or rewind. */
export class DeathFragments {
  private fragments: Fragment[] = [];
  private accumulator = 0;

  get count(): number { return this.fragments.length; }

  clear(): void {
    this.fragments.length = 0;
    this.accumulator = 0;
  }

  spawn(source: DeathFragmentPose, impact: Vec2, seed: number,
    quality: 'low' | 'medium' | 'high', reducedMotion: boolean,
    renderedPose?: Readonly<CharacterPose>): void {
    const pose: CharacterPose = Object.freeze({
      ...renderedPose,
      aimAngle: source.aimAngle,
      crouchAmount: source.crouchAmount,
      weaponId: source.weaponId ?? renderedPose?.weaponId,
      reducedMotion: renderedPose?.reducedMotion ?? true,
      hit: false,
    });
    const anchors = getCharacterFragmentAnchors(pose);
    const rng = random(seed);
    const facing = Math.cos(source.aimAngle) >= 0 ? 1 : -1;
    const appearance = Object.freeze({ ...source.appearance });
    const kinds = quality === 'low' || reducedMotion ? GROUPS : KINDS;
    // A common side-lying transform preserves the complete frozen pose in reduced motion.
    // Each group retains its own anchor, so there are no detached or omitted limbs.
    const collapsedTop = Math.min(...GROUPS.map(kind => anchors[kind].y - SIZE[kind].y / 2));
    const collapsedBottom = Math.max(...GROUPS.map(kind => anchors[kind].y + SIZE[kind].y / 2));
    const collapsedGround = Math.max(...GROUPS.map(kind => anchors[kind].x + SIZE[kind].x / 2));
    const collapsedOrigin = {
      x: source.x + source.width / 2 + facing * (collapsedTop + collapsedBottom) / 2 * CHARACTER_SCALE,
      y: source.y + source.height - collapsedGround * CHARACTER_SCALE,
    };
    const capacity = quality === 'low' ? 24 : 48;
    this.fragments.splice(0, Math.max(0, this.fragments.length + kinds.length - capacity));
    for (const kind of kinds) {
      const size = SIZE[kind];
      const width = (reducedMotion ? size.y : size.x) * CHARACTER_SCALE;
      const height = (reducedMotion ? size.x : size.y) * CHARACTER_SCALE;
      const center = reducedMotion ? {
        x: collapsedOrigin.x - facing * anchors[kind].y * CHARACTER_SCALE,
        y: collapsedOrigin.y + anchors[kind].x * CHARACTER_SCALE,
      } : {
        x: source.x + source.width / 2 + anchors[kind].x * CHARACTER_SCALE * facing,
        y: source.y + source.height + anchors[kind].y * CHARACTER_SCALE,
      };
      this.fragments.push({
        kind, pose, appearance, facing, width, height, reducedMotion,
        x: center.x - width / 2,
        y: center.y - height / 2,
        vx: reducedMotion ? 0 : source.vx * .22 + impact.x * 80 + (rng() - .5) * 125,
        vy: reducedMotion ? 0 : Math.min(120, source.vy * .16) - 90 - rng() * 95 + impact.y * 30,
        rotation: reducedMotion ? facing * Math.PI / 2 : 0,
        spin: reducedMotion ? 0 : (rng() - .5) * 7,
        age: 0,
        grounded: reducedMotion,
        bounces: 0,
      });
    }
  }

  update(elapsed: number, solids: readonly CollisionSolid[], worldHeight: number): void {
    const realElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    let live = 0;
    for (const piece of this.fragments) {
      piece.age += realElapsed;
      if (piece.age < (piece.reducedMotion ? .7 : 2.5) && piece.y <= worldHeight + 80) {
        this.fragments[live++] = piece;
      }
    }
    this.fragments.length = live;
    this.accumulator += Math.min(.1, realElapsed);
    while (this.accumulator >= 1 / 60) {
      this.accumulator -= 1 / 60;
      let write = 0;
      for (const piece of this.fragments) {
        if (piece.y > worldHeight + 80) continue;
        if (!piece.grounded && piece.age < 2) {
          piece.vy = Math.min(550, piece.vy + 650 / 60);
          const collision = moveAndCollide(piece, { x: piece.vx / 60, y: piece.vy / 60 }, solids);
          if (collision.hitX) piece.vx *= -.18;
          if (collision.grounded) {
            if (piece.bounces === 0 && piece.vy > 90) {
              piece.vy *= -.2;
              piece.vx *= .5;
              piece.spin *= .4;
              piece.bounces++;
            } else {
              piece.grounded = true;
              piece.vx = 0;
              piece.vy = 0;
              piece.spin = 0;
            }
          } else if (collision.hitY) piece.vy = 0;
          piece.rotation += piece.spin / 60;
        }
        this.fragments[write++] = piece;
      }
      this.fragments.length = write;
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Vec2, viewport: Vec2, parts?: CharacterParts): void {
    for (const piece of this.fragments) {
      if (piece.x + piece.width < camera.x - 40 || piece.x > camera.x + viewport.x + 40 ||
        piece.y + piece.height < camera.y - 40 || piece.y > camera.y + viewport.y + 40) continue;
      ctx.save();
      ctx.globalAlpha *= piece.reducedMotion ? Math.max(0, 1 - piece.age / .7) : Math.max(0, Math.min(1, (2.5 - piece.age) / .5));
      ctx.translate(piece.x + piece.width / 2, piece.y + piece.height / 2);
      ctx.rotate(piece.rotation);
      ctx.scale(CHARACTER_SCALE * piece.facing, CHARACTER_SCALE);
      drawCharacterFragment(ctx, piece.kind, piece.pose, piece.appearance, parts);
      ctx.restore();
    }
  }
}
