import type { Vec2, WeaponId } from './types';
import { clampCrouchAmount, getStanceBodyOffset } from './stance';

export interface CharacterPose {
  aimAngle: number;
  walkPhase?: number;
  moving?: boolean;
  airborne?: boolean;
  thrusting?: boolean;
  moveSpeed?: number;
  walkAmount?: number;
  airborneAmount?: number;
  thrustAmount?: number;
  verticalSpeed?: number;
  reducedMotion?: boolean;
  recoil?: number;
  /** Simulation-driven weapon reload, 0..1; undefined or -1 is the ready pose. */
  reloadProgress?: number;
  weaponId?: WeaponId;
  offhandWeaponId?: WeaponId;
  offhandReloadProgress?: number;
  offhandRecoil?: number;
  /** Cycles of an unarmed dance; used only by the entry illustration. */
  danceBeat?: number;
  meleeProgress?: number;
  hit?: boolean;
  target?: boolean;
  time?: number;
  /** Approved stance: 0 stands upright, 1 crouches. Stationary unless locomotion is enabled. */
  crouchAmount?: number;
  /** Apply walking and flight to the approved stance without moving its weapon origin. */
  locomotion?: boolean;
}

export interface CharacterLegGeometry {
  hip: Vec2;
  knee: Vec2;
  ankle: Vec2;
  boot: { x: number; y: number; width: number; height: number };
}

/** Facing-right coordinates, relative to the character's ground contact point. */
export interface CharacterGeometry {
  farLeg: CharacterLegGeometry;
  nearLeg: CharacterLegGeometry;
  nozzles: Vec2[];
  bodyBob: number;
  /** Rigid upper-body translation in facing-right coordinates; does not scale the artwork. */
  bodyOffset: Vec2;
  /** Translation of the existing weapon/near-arm pivot, separate from leg articulation. */
  weaponOffset: Vec2;
}

/** Presentation-only aim articulation, in facing-right character-local coordinates. */
export interface CharacterAimGeometry {
  pitch: number;
  torsoAngle: number;
  /** Total head rotation, including the torso's contribution. */
  headAngle: number;
  torsoPivot: Vec2;
  /** Neutral neck attachment before the torso leans. */
  neckPivot: Vec2;
  /** The same attachment carried by the torso; the head rotates around this point. */
  headPivot: Vec2;
  weaponPivot: Vec2;
  nearArm: { shoulder: Vec2; elbow: Vec2; hand: Vec2 };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

function articulateLeg(hip: Vec2, ankle: Vec2, length: number, bootWidth: number): CharacterLegGeometry {
  const dx = ankle.x - hip.x, dy = ankle.y - hip.y;
  const distance = Math.hypot(dx, dy);
  // Both segments retain their length; the knee bends toward the pilot's front.
  const bend = Math.sqrt(Math.max(0, length * length - distance * distance / 4));
  const knee = {
    x: (hip.x + ankle.x) / 2 + dy / distance * bend,
    y: (hip.y + ankle.y) / 2 - dx / distance * bend,
  };
  return { hip, knee, ankle, boot: { x: ankle.x - bootWidth / 2 + 2, y: ankle.y - 3, width: bootWidth, height: 6 } };
}

/** Shared joint and nozzle positions for character drawing and world-space exhaust. */
export function calculateCharacterPose(pose: CharacterPose): CharacterGeometry {
  if (pose.crouchAmount !== undefined || pose.locomotion) {
    const crouch = clampCrouchAmount(pose.crouchAmount ?? 0);
    const bodyOffset = getStanceBodyOffset(crouch);
    // The design preview remains planted; gameplay opts into this gait explicitly.
    const airborne = pose.locomotion ? clamp01(pose.airborneAmount ?? Number(!!pose.airborne)) : 0;
    const thrust = pose.locomotion ? clamp01(pose.thrustAmount ?? Number(!!pose.thrusting)) : 0;
    const walk = pose.locomotion ? clamp01(pose.walkAmount ?? Number(!!pose.moving)) * (1 - airborne) : 0;
    const facing = Math.cos(pose.aimAngle) >= 0 ? 1 : -1;
    const direction = Math.sign((pose.moveSpeed ?? facing) * facing) || 1;
    const tuck = pose.locomotion ? clamp01(-(pose.verticalSpeed ?? 0) / 520) : 0;
    const leg = (near: boolean) => {
      const length = near ? 14.5 : 15;
      const restingX = near ? 8.5 : -9.5;
      const phase = (pose.locomotion ? pose.walkPhase ?? 0 : 0) + (near ? 0 : Math.PI);
      // A small hip settle leaves room for an upright stride. The upper-leg caps
      // stay under the belt; the torso and gameplay weapon origin do not bob.
      const hip = {
        x: (near ? 7 : -8) + bodyOffset.x,
        y: (near ? -23 : -24) + bodyOffset.y + 3 * walk * (1 - crouch),
      };
      const groundX = restingX + Math.sin(phase) * mix(7, 4, crouch) * walk * direction;
      const groundY = -3 - Math.max(0, Math.cos(phase)) * mix(4.5, 2, crouch) * walk;
      const airborneX = mix(restingX + (near ? 1.5 : -1.5) * tuck, restingX, thrust);
      const airborneY = mix(near ? -3 - 5 * tuck : -8 - 4 * tuck, near ? -4 : -5, thrust);
      let ankle = { x: mix(groundX, airborneX, airborne), y: mix(groundY, airborneY, airborne) };
      // Project only an unreachable target back into the fixed-length chain.
      // Both endpoints are above the sole plane, so this cannot push a boot below it.
      const distance = Math.hypot(ankle.x - hip.x, ankle.y - hip.y);
      const reach = length * 2 - .01;
      if (distance > reach) ankle = {
        x: mix(hip.x, ankle.x, reach / distance),
        y: mix(hip.y, ankle.y, reach / distance),
      };
      return articulateLeg(hip, ankle, length, near ? 14 : 12);
    };
    const farLeg = leg(false), nearLeg = leg(true);
    const nozzles = [farLeg, nearLeg].map(({ boot }) => ({ x: boot.x + boot.width / 2, y: boot.y + boot.height }));
    return { farLeg, nearLeg, nozzles, bodyBob: 0, bodyOffset, weaponOffset: { ...bodyOffset } };
  }
  const phase = pose.walkPhase ?? 0;
  const airborne = clamp01(pose.airborneAmount ?? Number(!!pose.airborne));
  const thrust = clamp01(pose.thrustAmount ?? Number(!!pose.thrusting));
  const walk = clamp01(pose.walkAmount ?? Number(!!pose.moving)) * (1 - airborne);
  const facing = Math.cos(pose.aimAngle) >= 0 ? 1 : -1;
  const direction = Math.sign((pose.moveSpeed ?? facing) * facing) || 1;
  const bodyBob = pose.reducedMotion ? 0 : (1 - Math.cos(phase * 2)) * .55 * walk;
  const tuck = clamp01(-(pose.verticalSpeed ?? 0) / 520);

  const leg = (near: boolean) => {
    const legPhase = phase + (near ? 0 : Math.PI);
    const restingX = near ? 6 : -6;
    const groundX = restingX + Math.sin(legPhase) * 9.5 * walk * direction;
    // The recovery foot lifts as it swings in the travel direction; the stance foot stays planted.
    const groundY = -3 - Math.max(0, Math.cos(legPhase)) * 5 * walk;
    const airborneX = mix(near ? 6 + 2 * tuck : -8 - 2 * tuck, near ? 7 : -6, thrust);
    const airborneY = mix(near ? -3 - 3 * tuck : -8 - 4 * tuck, near ? -3 : -4, thrust);
    return articulateLeg(
      { x: near ? 5 : -5, y: (near ? -23 : -25) - bodyBob },
      { x: mix(groundX, airborneX, airborne), y: mix(groundY, airborneY, airborne) },
      near ? 12.5 : 13,
      near ? 14 : 12,
    );
  };
  const farLeg = leg(false), nearLeg = leg(true);
  const nozzles = [farLeg, nearLeg].map(({ boot }) => ({ x: boot.x + boot.width / 2, y: boot.y + boot.height }));
  return { farLeg, nearLeg, nozzles, bodyBob, bodyOffset: { x: 0, y: 0 }, weaponOffset: { x: 0, y: 0 } };
}

function rotatePoint(point: Vec2, pivot: Vec2, angle: number): Vec2 {
  const x = point.x - pivot.x, y = point.y - pivot.y;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return { x: pivot.x + x * cosine - y * sine, y: pivot.y + x * sine + y * cosine };
}

/** Aim affects only the upper-body drawing; hips, soles and the weapon origin stay authoritative. */
export function calculateCharacterAim(
  pose: CharacterPose, geometry: CharacterGeometry = calculateCharacterPose(pose),
): CharacterAimGeometry {
  const rawPitch = Number.isFinite(pose.aimAngle)
    ? Math.atan2(Math.sin(pose.aimAngle), Math.abs(Math.cos(pose.aimAngle))) : 0;
  // Snap the tiny sine residual at horizontal left/right to the exact approved neutral pose.
  const pitch = Math.abs(rawPitch) < 1e-10 ? 0 : rawPitch;
  const torsoAngle = pitch / 15; // At vertical aim: 6 degrees of waist lean.
  // Retain a gentle nod near level aim, then turn much farther toward the extremes.
  const verticalAmount = Math.abs(pitch) / (Math.PI / 2);
  const headAngle = pitch * (24 + 36 * verticalAmount * verticalAmount) / 90; // 60 degrees total at vertical aim.
  const { bodyOffset, bodyBob, weaponOffset } = geometry;
  const torsoPivot = { x: bodyOffset.x, y: bodyOffset.y - 25 - bodyBob };
  const neckPivot = { x: bodyOffset.x + 1, y: bodyOffset.y - 49 - bodyBob };
  const headPivot = rotatePoint(neckPivot, torsoPivot, torsoAngle);
  const weaponPivot = { x: weaponOffset.x, y: weaponOffset.y - 38 };
  const shoulder = rotatePoint({ x: bodyOffset.x - 6, y: bodyOffset.y - 45 - bodyBob }, torsoPivot, torsoAngle);
  const recoil = Number.isFinite(pose.recoil) ? pose.recoil! : 0;
  const hand = rotatePoint({ x: weaponPivot.x + 10 - recoil * 2.2, y: weaponPivot.y + 1 }, weaponPivot, pitch);
  const dx = hand.x - shoulder.x, dy = hand.y - shoulder.y;
  const distance = Math.hypot(dx, dy);
  // The original arm uses two sqrt(125)-pixel segments. Solve its elbow from the
  // attached shoulder to the gun grip, instead of rotating the shoulder with the gun.
  const bend = Math.sqrt(Math.max(0, 125 - distance * distance / 4));
  const elbow = {
    x: (shoulder.x + hand.x) / 2 - dy / (distance || 1) * bend,
    y: (shoulder.y + hand.y) / 2 + dx / (distance || 1) * bend,
  };
  return { pitch, torsoAngle, headAngle, torsoPivot, neckPivot, headPivot, weaponPivot, nearArm: { shoulder, elbow, hand } };
}
