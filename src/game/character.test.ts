import { describe, expect, it } from 'vitest';
import { calculateCharacterAim, calculateCharacterPose, type CharacterGeometry, type CharacterPose } from './character';
import { CHARACTER_SCALE, getStanceBodyOffset, getStanceWeaponOffset } from './stance';

const walking: CharacterPose = { aimAngle: 0, moving: true, moveSpeed: 320, walkAmount: 1 };
const legs = (geometry: CharacterGeometry) => [geometry.farLeg, geometry.nearLeg];

describe('articulated pilot pose', () => {
  it('swings both knees from the hips without stretching either leg segment', () => {
    const front = calculateCharacterPose({ ...walking, walkPhase: Math.PI / 2 });
    const back = calculateCharacterPose({ ...walking, walkPhase: -Math.PI / 2 });
    for (let index = 0; index < 2; index++) {
      expect(Math.abs(legs(front)[index].knee.x - legs(back)[index].knee.x)).toBeGreaterThan(5);
    }
    for (let frame = 0; frame < 64; frame++) {
      const geometry = calculateCharacterPose({ ...walking, walkPhase: frame / 64 * Math.PI * 2 });
      legs(geometry).forEach(({ hip, knee, ankle }, index) => {
        const length = index === 0 ? 13 : 12.5;
        expect(Math.hypot(knee.x - hip.x, knee.y - hip.y)).toBeCloseTo(length, 8);
        expect(Math.hypot(ankle.x - knee.x, ankle.y - knee.y)).toBeCloseTo(length, 8);
      });
    }
  });

  it('alternates a lifted recovery foot with a planted stance foot', () => {
    const first = calculateCharacterPose({ ...walking, walkPhase: 0 });
    const second = calculateCharacterPose({ ...walking, walkPhase: Math.PI });
    expect(first.nozzles[0].y).toBe(0);
    expect(first.nozzles[1].y).toBe(-5);
    expect(second.nozzles[0].y).toBe(-5);
    expect(second.nozzles[1].y).toBe(0);
    const idle = calculateCharacterPose({ aimAngle: 0 });
    expect(idle.nozzles.every(nozzle => nozzle.y === 0)).toBe(true);
  });

  it('mirrors forward travel and reverses the foot sweep while aiming backward', () => {
    const right = calculateCharacterPose({ ...walking, walkPhase: Math.PI / 2 });
    const left = calculateCharacterPose({ ...walking, aimAngle: Math.PI, moveSpeed: -320, walkPhase: Math.PI / 2 });
    expect(left).toEqual(right);
    const backwards = calculateCharacterPose({ ...walking, moveSpeed: -320, walkPhase: Math.PI / 2 });
    expect(right.nearLeg.ankle.x).toBeGreaterThan(6);
    expect(backwards.nearLeg.ankle.x).toBeLessThan(6);
    expect(backwards.nearLeg.ankle.x - 6).toBeCloseTo(-(right.nearLeg.ankle.x - 6));
    expect(backwards.farLeg.ankle.x + 6).toBeCloseTo(-(right.farLeg.ankle.x + 6));
  });

  it('keeps sole contact at or above the ground through ground, air and thrust blends', () => {
    for (const aimAngle of [0, Math.PI]) {
      for (let frame = 0; frame < 24; frame++) {
        for (const airborneAmount of [0, .25, .5, .75, 1]) {
          for (const thrustAmount of [0, .5, 1]) {
            const geometry = calculateCharacterPose({
              ...walking, aimAngle, walkPhase: frame / 24 * Math.PI * 2,
              airborneAmount, thrustAmount, verticalSpeed: -520,
            });
            for (const nozzle of geometry.nozzles) {
              expect(Number.isFinite(nozzle.x)).toBe(true);
              expect(nozzle.y).toBeLessThanOrEqual(0);
            }
          }
        }
      }
    }
  });

  it('places both exhaust origins at the rendered boot soles in every pose', () => {
    for (const pose of [
      { aimAngle: 0 },
      { ...walking, walkPhase: .9 },
      { aimAngle: Math.PI, airborne: true, verticalSpeed: -420 },
      { aimAngle: 0, airborne: true, thrusting: true },
    ]) {
      const geometry = calculateCharacterPose(pose);
      expect(geometry.nozzles).toHaveLength(2);
      legs(geometry).forEach(({ boot }, index) => {
        expect(geometry.nozzles[index]).toEqual({ x: boot.x + boot.width / 2, y: boot.y + boot.height });
      });
    }
  });

  it('blends flight poses continuously and removes decorative bob in reduced motion', () => {
    const start = calculateCharacterPose({ ...walking, walkPhase: 1, airborneAmount: .4 });
    const next = calculateCharacterPose({ ...walking, walkPhase: 1, airborneAmount: .41 });
    for (let index = 0; index < 2; index++) {
      expect(Math.hypot(next.nozzles[index].x - start.nozzles[index].x, next.nozzles[index].y - start.nozzles[index].y)).toBeLessThan(.3);
    }
    const reduced = calculateCharacterPose({ ...walking, walkPhase: 1, reducedMotion: true });
    expect(reduced.bodyBob).toBe(0);
    expect(reduced.nearLeg.ankle.y).toBeLessThan(-3);
  });
});

describe('stationary crouch design preview', () => {
  const preview = (crouchAmount: number, aimAngle = 0) => calculateCharacterPose({ aimAngle, crouchAmount });

  it('keeps separated boots and both soles planted throughout the transition', () => {
    const standing = preview(0);
    expect(standing.farLeg.boot.x + standing.farLeg.boot.width).toBeLessThan(standing.nearLeg.boot.x);
    for (let frame = 0; frame <= 40; frame++) {
      const geometry = preview(frame / 40);
      legs(geometry).forEach(({ ankle, boot }, index) => {
        expect(ankle).toEqual(legs(standing)[index].ankle);
        expect(boot).toEqual(legs(standing)[index].boot);
        expect(boot.y + boot.height).toBe(0);
      });
      expect(geometry.nozzles).toEqual(standing.nozzles);
    }
  });

  it('bends the knees forward without stretching the thighs or calves', () => {
    const standing = preview(0), crouching = preview(1);
    for (let frame = 0; frame <= 40; frame++) {
      legs(preview(frame / 40)).forEach(({ hip, knee, ankle }, index) => {
        const length = index === 0 ? 15 : 14.5;
        expect(Math.hypot(knee.x - hip.x, knee.y - hip.y)).toBeCloseTo(length, 8);
        expect(Math.hypot(ankle.x - knee.x, ankle.y - knee.y)).toBeCloseTo(length, 8);
        expect(knee.y).toBeGreaterThan(hip.y);
        expect(knee.y).toBeLessThan(ankle.y);
      });
    }
    legs(standing).forEach(({ hip, knee, ankle }, index) => {
      // A nearly extended standing leg, with its knee close to the hip-to-ankle line.
      expect(Math.hypot(ankle.x - hip.x, ankle.y - hip.y) / (index === 0 ? 30 : 29)).toBeGreaterThan(.99);
      const standingBend = Math.hypot(knee.x - (hip.x + ankle.x) / 2, knee.y - (hip.y + ankle.y) / 2);
      expect(standingBend).toBeLessThan(.8);
      expect(legs(crouching)[index].knee.x - legs(crouching)[index].hip.x).toBeGreaterThan(10);
    });
  });

  it('lowers the entire upper body and aim pivot together while preserving hip attachment', () => {
    const standing = preview(0), crouching = preview(1);
    const drop = crouching.bodyOffset.y - standing.bodyOffset.y;
    // The current helmet artwork starts at -77; a full crouch reduces visible height by about a fifth.
    const standingHeight = 77 - standing.bodyOffset.y;
    expect(drop / standingHeight).toBeGreaterThanOrEqual(.2);
    expect(drop / standingHeight).toBeLessThanOrEqual(.25);
    expect(crouching.bodyOffset.x).toBeLessThan(standing.bodyOffset.x);
    for (let frame = 0; frame <= 40; frame++) {
      const geometry = preview(frame / 40);
      expect(geometry.weaponOffset).toEqual(geometry.bodyOffset);
      expect(geometry.bodyBob).toBe(0);
      legs(geometry).forEach(({ hip }, index) => {
        const standingHip = legs(standing)[index].hip;
        expect(hip.x - geometry.bodyOffset.x).toBeCloseTo(standingHip.x - standing.bodyOffset.x, 8);
        expect(hip.y - geometry.bodyOffset.y).toBeCloseTo(standingHip.y - standing.bodyOffset.y, 8);
      });
    }
  });

  it('uses the same local pose in either facing direction and ignores locomotion in preview', () => {
    for (const amount of [0, .25, .5, .75, 1]) {
      const right = preview(amount);
      expect(preview(amount, Math.PI)).toEqual(right);
      expect(calculateCharacterPose({
        ...walking, aimAngle: Math.PI, crouchAmount: amount, walkPhase: 1.3,
        airborneAmount: 1, thrustAmount: 1, verticalSpeed: -520,
      })).toEqual(right);
    }
  });

  it('clamps out-of-range amounts and falls back to standing for NaN', () => {
    expect(preview(-5)).toEqual(preview(0));
    expect(preview(-Infinity)).toEqual(preview(0));
    expect(preview(NaN)).toEqual(preview(0));
    expect(preview(5)).toEqual(preview(1));
    expect(preview(Infinity)).toEqual(preview(1));
    for (const amount of [-Infinity, -5, 0, .5, 1, 5, Infinity, NaN]) {
      const geometry = preview(amount);
      const points = [geometry.bodyOffset, geometry.weaponOffset, ...geometry.nozzles,
        ...legs(geometry).flatMap(({ hip, knee, ankle, boot }) => [hip, knee, ankle, boot])];
      expect(points.every(point => Object.values(point).every(Number.isFinite))).toBe(true);
    }
  });

  it('leaves ordinary gameplay offsets and its original resting leg dimensions unchanged', () => {
    const live = calculateCharacterPose({ aimAngle: 0 });
    expect(live.bodyOffset).toEqual({ x: 0, y: 0 });
    expect(live.weaponOffset).toEqual({ x: 0, y: 0 });
    expect(live.nearLeg.hip).toEqual({ x: 5, y: -23 });
    expect(live.farLeg.hip).toEqual({ x: -5, y: -25 });
    expect(live.nearLeg.ankle).toEqual({ x: 6, y: -3 });
    expect(live.farLeg.ankle).toEqual({ x: -6, y: -3 });
    expect(live.nearLeg).not.toEqual(preview(0).nearLeg);
  });
});

describe('upper-body aim articulation', () => {
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it('retains the approved horizontal head, torso and arm positions in both stances and facings', () => {
    for (const crouchAmount of [undefined, 0, .5, 1]) {
      for (const aimAngle of [0, Math.PI, -Math.PI, 2 * Math.PI]) {
        const pose = { aimAngle, crouchAmount };
        const geometry = calculateCharacterPose(pose), aim = calculateCharacterAim(pose, geometry);
        expect(aim.pitch).toBe(0);
        expect(aim.headAngle).toBe(0);
        expect(aim.torsoAngle).toBe(0);
        expect(aim.headPivot).toEqual(aim.neckPivot);
        const { x, y } = geometry.bodyOffset;
        expect(aim.nearArm.shoulder).toEqual({ x: x - 6, y: y - 45 });
        expect(aim.nearArm.elbow.x).toBeCloseTo(x - 1, 10);
        expect(aim.nearArm.elbow.y).toBeCloseTo(y - 35, 10);
        expect(aim.nearArm.hand).toEqual({ x: x + 10, y: y - 37 });
      }
    }
  });

  it('keeps the torso subtle while the head turns progressively to sixty degrees at vertical aim', () => {
    for (let frame = 0; frame <= 360; frame++) {
      const aim = calculateCharacterAim({ aimAngle: (frame - 180) * Math.PI / 90, crouchAmount: 1 });
      expect(Math.abs(aim.pitch)).toBeLessThanOrEqual(Math.PI / 2);
      expect(Math.abs(aim.torsoAngle)).toBeLessThanOrEqual(Math.PI / 30);
      expect(Math.abs(aim.headAngle)).toBeLessThanOrEqual(Math.PI / 3);
      if (aim.pitch !== 0) {
        expect(Math.sign(aim.headAngle)).toBe(Math.sign(aim.pitch));
        expect(Math.sign(aim.torsoAngle)).toBe(Math.sign(aim.pitch));
        expect(Math.abs(aim.headAngle)).toBeGreaterThan(Math.abs(aim.torsoAngle));
      }
    }
    for (const sign of [-1, 1]) {
      const vertical = calculateCharacterAim({ aimAngle: sign * Math.PI / 2 });
      expect(vertical.headAngle).toBeCloseTo(sign * Math.PI / 3, 12);
      expect(vertical.torsoAngle).toBeCloseTo(sign * Math.PI * 6 / 180, 12);
    }
    const nearLevel = calculateCharacterAim({ aimAngle: Math.PI / 12 });
    const halfway = calculateCharacterAim({ aimAngle: Math.PI / 4 });
    const steep = calculateCharacterAim({ aimAngle: Math.PI * 5 / 12 });
    expect(nearLevel.headAngle).toBeLessThan(Math.PI * 5 / 180);
    expect(halfway.headAngle).toBeGreaterThan(nearLevel.headAngle);
    expect(steep.headAngle).toBeGreaterThan(halfway.headAngle * 2);
  });

  it('moves the neck attachment with the torso without stretching the neck-to-waist spacing', () => {
    for (const crouchAmount of [undefined, 0, .5, 1]) {
      const neutral = calculateCharacterAim({ aimAngle: 0, crouchAmount });
      for (const aimAngle of [-Math.PI / 2, -.5, .5, Math.PI / 2]) {
        const aim = calculateCharacterAim({ aimAngle, crouchAmount });
        expect(aim.torsoPivot).toEqual(neutral.torsoPivot);
        expect(aim.neckPivot).toEqual(neutral.neckPivot);
        expect(distance(aim.headPivot, aim.torsoPivot)).toBeCloseTo(distance(neutral.neckPivot, neutral.torsoPivot), 10);
        const neckDirection = Math.atan2(aim.headPivot.y - aim.torsoPivot.y, aim.headPivot.x - aim.torsoPivot.x);
        const neutralDirection = Math.atan2(neutral.neckPivot.y - neutral.torsoPivot.y, neutral.neckPivot.x - neutral.torsoPivot.x);
        expect(neckDirection - neutralDirection).toBeCloseTo(aim.torsoAngle, 12);
      }
    }
  });

  it('keeps the shoulder attached and both arm segments fixed while reaching the gun grip', () => {
    for (const crouchAmount of [undefined, 0, 1]) {
      for (const recoil of [0, .5, 1]) {
        for (let frame = 0; frame <= 48; frame++) {
          const aim = calculateCharacterAim({
            ...walking, walkPhase: 1.2, aimAngle: (frame / 48 - .5) * Math.PI, crouchAmount, recoil,
          });
          const { shoulder, elbow, hand } = aim.nearArm;
          expect(distance(shoulder, aim.torsoPivot)).toBeCloseTo(Math.hypot(6, 20), 10);
          expect(distance(shoulder, elbow)).toBeCloseTo(Math.sqrt(125), 10);
          expect(distance(elbow, hand)).toBeCloseTo(Math.sqrt(125), 10);
          // Undo gun rotation: the hand stays on its existing (10, 1) grip, with recoil.
          const x = hand.x - aim.weaponPivot.x, y = hand.y - aim.weaponPivot.y;
          expect(x * Math.cos(aim.pitch) + y * Math.sin(aim.pitch)).toBeCloseTo(10 - recoil * 2.2, 10);
          expect(-x * Math.sin(aim.pitch) + y * Math.cos(aim.pitch)).toBeCloseTo(1, 10);
        }
      }
    }
  });

  it('normalizes left-facing and wrapped aim to the same local head and torso pose', () => {
    for (const pitch of [-Math.PI / 2, -.8, -.2, 0, .2, .8, Math.PI / 2]) {
      const right = calculateCharacterAim({ aimAngle: pitch, crouchAmount: 1 });
      for (const aimAngle of [Math.PI - pitch, Math.PI - pitch - 2 * Math.PI, pitch + 2 * Math.PI]) {
        const left = calculateCharacterAim({ aimAngle, crouchAmount: 1 });
        expect(left.pitch).toBeCloseTo(right.pitch, 12);
        expect(left.headAngle).toBeCloseTo(right.headAngle, 12);
        expect(left.torsoAngle).toBeCloseTo(right.torsoAngle, 12);
        expect(left.headPivot.x).toBeCloseTo(right.headPivot.x, 12);
        expect(left.headPivot.y).toBeCloseTo(right.headPivot.y, 12);
        expect(left.nearArm.elbow.x).toBeCloseTo(right.nearArm.elbow.x, 12);
        expect(left.nearArm.elbow.y).toBeCloseTo(right.nearArm.elbow.y, 12);
      }
    }
  });

  it('never alters the approved legs, boot exhaust or authoritative weapon pivot', () => {
    for (const crouchAmount of [undefined, 0, .5, 1]) {
      const neutral = calculateCharacterPose({ aimAngle: 0, crouchAmount });
      for (const aimAngle of [-Math.PI, -Math.PI / 2, -.4, .4, Math.PI / 2, Math.PI]) {
        const pose = { aimAngle, crouchAmount }, geometry = calculateCharacterPose(pose);
        const before = structuredClone(geometry);
        const aim = calculateCharacterAim(pose, geometry);
        expect(geometry).toEqual(before);
        expect(geometry).toEqual(neutral);
        expect(aim.weaponPivot).toEqual({ x: geometry.weaponOffset.x, y: -38 + geometry.weaponOffset.y });
        if (crouchAmount === undefined) expect(aim.weaponPivot).toEqual({ x: 0, y: -38 });
      }
    }
  });

  it('uses a finite neutral aim for invalid inputs and is independent of animation history', () => {
    for (const aimAngle of [NaN, Infinity, -Infinity]) {
      expect(calculateCharacterAim({ aimAngle, crouchAmount: 1 })).toEqual(calculateCharacterAim({ aimAngle: 0, crouchAmount: 1 }));
    }
    const pose = { aimAngle: -.8, crouchAmount: 1 };
    expect(calculateCharacterAim({ ...pose, reducedMotion: true, time: 100 })).toEqual(calculateCharacterAim(pose));
  });
});

describe('approved stance locomotion', () => {
  const moving: CharacterPose = { ...walking, locomotion: true, crouchAmount: 0 };

  it('uses the identical approved pose at rest and leaves design previews stationary', () => {
    for (const crouchAmount of [0, .25, .5, .75, 1]) {
      const stationary = calculateCharacterPose({ aimAngle: 0, crouchAmount });
      expect(calculateCharacterPose({ aimAngle: 0, crouchAmount, locomotion: true })).toEqual(stationary);
      expect(calculateCharacterPose({
        ...moving, locomotion: false, crouchAmount, walkPhase: NaN, verticalSpeed: NaN,
        airborneAmount: 1, thrustAmount: 1,
      })).toEqual(stationary);
    }
    expect(calculateCharacterPose({ aimAngle: 0, locomotion: true })).toEqual(calculateCharacterPose({ aimAngle: 0, crouchAmount: 0 }));
  });

  it('alternates lifted recovery feet with a planted stance foot, including a short crouch shuffle', () => {
    for (const crouchAmount of [0, 1]) {
      const walkAmount = crouchAmount === 1 ? .5 : 1;
      const first = calculateCharacterPose({ ...moving, crouchAmount, walkAmount, walkPhase: 0 });
      const second = calculateCharacterPose({ ...moving, crouchAmount, walkAmount, walkPhase: Math.PI });
      expect(first.nozzles[0].y).toBe(0);
      expect(first.nozzles[1].y).toBeLessThan(0);
      expect(second.nozzles[1].y).toBe(0);
      expect(second.nozzles[0].y).toBeLessThan(0);
      const ahead = calculateCharacterPose({ ...moving, crouchAmount, walkAmount, walkPhase: Math.PI / 2 });
      const behind = calculateCharacterPose({ ...moving, crouchAmount, walkAmount, walkPhase: -Math.PI / 2 });
      expect(ahead.nearLeg.ankle.x - behind.nearLeg.ankle.x).toBeGreaterThanOrEqual(4);
      expect(behind.farLeg.ankle.x - ahead.farLeg.ankle.x).toBeGreaterThanOrEqual(4);
      if (crouchAmount === 1) {
        expect(first.nozzles[1].y).toBeGreaterThanOrEqual(-2);
        expect(ahead.nearLeg.ankle.x - behind.nearLeg.ankle.x).toBeLessThan(8);
      }
    }
  });

  it('keeps every leg segment fixed and every sole above ground through gait, crouch and flight blends', () => {
    for (const crouchAmount of [0, .25, .5, .75, 1]) {
      for (const airborneAmount of [0, .25, .5, 1]) {
        for (const thrustAmount of [0, .5, 1]) {
          for (const verticalSpeed of [-520, 0, 520]) {
            for (let frame = 0; frame < 16; frame++) {
              const geometry = calculateCharacterPose({
                ...moving, crouchAmount, airborneAmount, thrustAmount, verticalSpeed,
                walkPhase: frame / 16 * Math.PI * 2,
              });
              legs(geometry).forEach(({ hip, knee, ankle, boot }, index) => {
                const length = index === 0 ? 15 : 14.5;
                expect(Math.hypot(knee.x - hip.x, knee.y - hip.y)).toBeCloseTo(length, 8);
                expect(Math.hypot(ankle.x - knee.x, ankle.y - knee.y)).toBeCloseTo(length, 8);
                expect(boot.y + boot.height).toBeLessThanOrEqual(0);
                expect(geometry.nozzles[index]).toEqual({ x: boot.x + boot.width / 2, y: boot.y + boot.height });
                expect([hip, knee, ankle].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
              });
            }
          }
        }
      }
    }
  });

  it('mirrors leftward travel and reverses the ankle sweep for backward walking', () => {
    for (const crouchAmount of [0, .5, 1]) {
      const right = calculateCharacterPose({ ...moving, crouchAmount, walkPhase: Math.PI / 2 });
      const left = calculateCharacterPose({ ...moving, crouchAmount, walkPhase: Math.PI / 2, aimAngle: Math.PI, moveSpeed: -320 });
      const backward = calculateCharacterPose({ ...moving, crouchAmount, walkPhase: Math.PI / 2, moveSpeed: -320 });
      expect(left).toEqual(right);
      expect(right.nearLeg.ankle.x - 8.5).toBeCloseTo(-(backward.nearLeg.ankle.x - 8.5), 10);
      expect(right.farLeg.ankle.x + 9.5).toBeCloseTo(-(backward.farLeg.ankle.x + 9.5), 10);
    }
  });

  it('blends walking and flight continuously while keeping the body and weapon tied only to stance', () => {
    for (const crouchAmount of [0, .5, 1]) {
      for (const airborneAmount of [0, .2, .5, .9]) {
        const pose = { ...moving, crouchAmount, walkPhase: .6, airborneAmount, thrustAmount: .5, verticalSpeed: -400 };
        const first = calculateCharacterPose(pose);
        const next = calculateCharacterPose({ ...pose, airborneAmount: airborneAmount + .001 });
        legs(first).forEach(({ ankle, hip }, index) => {
          expect(Math.hypot(legs(next)[index].ankle.x - ankle.x, legs(next)[index].ankle.y - ankle.y)).toBeLessThan(.03);
          // The little gait settle remains within the existing rounded thigh cap under the belt.
          expect(hip.y - first.bodyOffset.y).toBeLessThanOrEqual(index === 0 ? -21 : -20);
        });
        expect(first.bodyOffset).toEqual(getStanceBodyOffset(crouchAmount));
        expect(first.weaponOffset).toEqual(first.bodyOffset);
        expect(first.bodyBob).toBe(0);
        for (const facing of [-1, 1] as const) {
          const aim = calculateCharacterAim({ ...pose, aimAngle: facing === 1 ? 0 : Math.PI }, first);
          expect({ x: aim.weaponPivot.x * CHARACTER_SCALE * facing, y: aim.weaponPivot.y * CHARACTER_SCALE })
            .toEqual(getStanceWeaponOffset(crouchAmount, facing));
        }
      }
    }
  });

  it('uses distinct jump and thrust foot poses and retains gait in reduced motion', () => {
    const jump = calculateCharacterPose({ ...moving, airborneAmount: 1, thrustAmount: 0, verticalSpeed: -520 });
    const thrust = calculateCharacterPose({ ...moving, airborneAmount: 1, thrustAmount: 1, verticalSpeed: -520 });
    expect(jump.nearLeg.ankle.y).toBeLessThan(thrust.nearLeg.ankle.y);
    expect(jump.farLeg.ankle.y).toBeLessThan(thrust.farLeg.ankle.y);
    const pose = { ...moving, walkPhase: .8, crouchAmount: 1 };
    expect(calculateCharacterPose({ ...pose, reducedMotion: true })).toEqual(calculateCharacterPose(pose));
  });
});
