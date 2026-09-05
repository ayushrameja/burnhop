import { describe, expect, it } from 'vitest';
import { CHARACTER_LOOKS } from './appearance';
import { calculateCharacterAim, calculateCharacterPose, type CharacterPose } from './character';
import { calculateDetailedCharacterRig, DETAILED_RIFLE_ANCHORS } from './detailedCharacter';
import { CHARACTER_SCALE, getStanceWeaponOffset } from './stance';
import { RELOAD_CUES } from './reload';

const distance = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);

describe('detailed character attachment rig', () => {
  it('retains both fixed arm segment lengths while reaching both rifle grips across aim, recoil, crouch, and travel', () => {
    for(let frame=0;frame<=72;frame++) {
      for(const crouchAmount of [0,.5,1]) {
        for(const recoil of [0,.5,1]) {
          const pose: CharacterPose={aimAngle:frame/72*Math.PI*2,crouchAmount,recoil,locomotion:true,walkAmount:1,walkPhase:frame*.2,moveSpeed:320};
          const rig=calculateDetailedCharacterRig(pose);
          for(const arm of [rig.triggerArm,rig.supportArm]) {
            expect(distance(arm.shoulder,arm.elbow)).toBeCloseTo(arm.upperLength,9);
            expect(distance(arm.elbow,arm.hand)).toBeCloseTo(arm.forearmLength,9);
            expect(Number.isFinite(arm.elbow.x)&&Number.isFinite(arm.elbow.y)).toBe(true);
          }
          expect(rig.triggerArm.hand).toEqual(rig.rifle.triggerGrip);
          expect(rig.supportArm.hand).toEqual(rig.rifle.supportGrip);
        }
      }
    }
  });

  it('moves both hands with the same recoil translation without displacing the authoritative weapon pivot', () => {
    for(const aimAngle of [-Math.PI/2,-.4,0,.7,Math.PI/2,Math.PI,Math.PI*1.4]) {
      for(const crouchAmount of [0,.4,1]) {
        const resting=calculateDetailedCharacterRig({aimAngle,crouchAmount,recoil:0});
        const firing=calculateDetailedCharacterRig({aimAngle,crouchAmount,recoil:1});
        expect(firing.rifle.pivot).toEqual(resting.rifle.pivot);
        for(const grip of ['triggerGrip','supportGrip','muzzle'] as const) {
          expect(firing.rifle[grip].x-resting.rifle[grip].x).toBeCloseTo(-2.2*Math.cos(resting.rifle.angle),9);
          expect(firing.rifle[grip].y-resting.rifle[grip].y).toBeCloseTo(-2.2*Math.sin(resting.rifle.angle),9);
        }
      }
    }
  });

  it('uses the rifle-local anchors after facing-right aim rotation with exact geometric hand contact', () => {
    for(const aimAngle of [-Math.PI/2,-.3,0,.3,Math.PI/2,Math.PI,Math.PI*1.5]) {
      const rig=calculateDetailedCharacterRig({aimAngle,crouchAmount:.7,recoil:.8});
      for(const [key,point] of Object.entries(DETAILED_RIFLE_ANCHORS)) {
        const actual=rig.rifle[key as keyof typeof DETAILED_RIFLE_ANCHORS];
        const x=point.x-.8*2.2,y=point.y;
        expect(actual.x).toBeCloseTo(rig.rifle.pivot.x+x*Math.cos(rig.rifle.angle)-y*Math.sin(rig.rifle.angle),10);
        expect(actual.y).toBeCloseTo(rig.rifle.pivot.y+x*Math.sin(rig.rifle.angle)+y*Math.cos(rig.rifle.angle),10);
      }
    }
  });

  it('preserves approved hips, knees, boots, head movement, and scaled gameplay firing origin', () => {
    for(const aimAngle of [-Math.PI/2,0,Math.PI/2,Math.PI]) {
      for(const crouchAmount of [0,.25,.5,.75,1]) {
        const pose={aimAngle,crouchAmount,locomotion:true,walkAmount:.5,walkPhase:.9,airborneAmount:.2,thrustAmount:.4};
        const rig=calculateDetailedCharacterRig(pose), geometry=calculateCharacterPose(pose);
        expect(rig.geometry).toEqual(geometry);
        expect(rig.aim).toEqual(calculateCharacterAim(pose,geometry));
        const facing=Math.cos(aimAngle)>=0?1:-1;
        const worldOffset=getStanceWeaponOffset(crouchAmount,facing);
        expect(rig.rifle.pivot.x*CHARACTER_SCALE*facing).toBeCloseTo(worldOffset.x,10);
        expect(rig.rifle.pivot.y*CHARACTER_SCALE).toBeCloseTo(worldOffset.y,10);
        [geometry.farLeg,geometry.nearLeg].forEach(({boot},i)=>{
          expect(rig.geometry.nozzles[i]).toEqual({x:boot.x+boot.width/2,y:boot.y+boot.height});
          expect(boot.y+boot.height).toBeLessThanOrEqual(0);
        });
      }
    }
  });

  it('keeps the same local rig when horizontal facing is flipped', () => {
    for(const crouchAmount of [0,.3,1]) {
      const right=calculateDetailedCharacterRig({aimAngle:0,crouchAmount,recoil:.5});
      const left=calculateDetailedCharacterRig({aimAngle:Math.PI,crouchAmount,recoil:.5});
      expect(left).toEqual(right);
    }
  });

  it('defaults the shared renderer to the approved upright stance and safely bounds recoil', () => {
    expect(calculateDetailedCharacterRig({aimAngle:0}).geometry).toEqual(calculateCharacterPose({aimAngle:0,crouchAmount:0}));
    const neutral=calculateDetailedCharacterRig({aimAngle:0,recoil:0});
    for(const recoil of [Number.NaN,Number.POSITIVE_INFINITY,-1])expect(calculateDetailedCharacterRig({aimAngle:0,recoil}).rifle).toEqual(neutral.rifle);
    expect(calculateDetailedCharacterRig({aimAngle:0,recoil:2}).rifle).toEqual(calculateDetailedCharacterRig({aimAngle:0,recoil:1}).rifle);
  });
});

describe('hand-driven rifle reload', () => {
  it('removes the held magazine, visits the belt, seats the replacement and racks the rifle', () => {
    const rig = (reloadProgress: number) => calculateDetailedCharacterRig({ aimAngle: 0, reloadProgress });
    const ready = rig(0), removed = rig(RELOAD_CUES.remove), belt = rig(.35), inserted = rig(RELOAD_CUES.insert), racked = rig(RELOAD_CUES.rack);
    expect(ready.supportArm.hand).toEqual(ready.rifle.supportGrip);
    expect(distance(removed.supportArm.hand, removed.rifle.supportGrip)).toBeGreaterThan(8);
    expect(removed.magazine.seated).toBe(false);
    expect(removed.magazine.opacity).toBe(1);
    expect(removed.magazine.fresh).toBe(false);
    expect(distance(removed.magazine.center, removed.supportArm.hand)).toBeCloseTo(3.35, 10);
    expect(belt.supportArm.hand).toEqual({ x: belt.geometry.bodyOffset.x + 8, y: belt.geometry.bodyOffset.y - 24 });
    expect(belt.magazine.opacity).toBe(0);
    expect(rig(.45).magazine.fresh).toBe(true);
    expect(inserted.magazine.seated).toBe(true);
    expect(distance(inserted.magazine.center, inserted.supportArm.hand)).toBeCloseTo(3.35, 10);
    expect(racked.rifle.boltOffset).toBe(-5);
    expect(rig(.9).rifle.boltOffset).toBe(0);
    const finished = rig(1);
    expect(finished.supportArm.hand).toEqual(finished.rifle.supportGrip);
    expect(finished.triggerArm).toEqual(ready.triggerArm);
    expect(finished.rifle).toEqual(ready.rifle);
    expect(finished.magazine).toEqual(ready.magazine);
  });

  it('keeps fixed arm lengths, exact trigger contact, and the authoritative stance and aim at every stage', () => {
    for (const reducedMotion of [false, true]) {
      for (const crouchAmount of [0, .5, 1]) {
        for (let angle = 0; angle <= 16; angle++) {
          const aimAngle = angle / 16 * Math.PI * 2;
          const neutral = calculateDetailedCharacterRig({ aimAngle, crouchAmount, reducedMotion });
          for (let frame = 0; frame <= 50; frame++) {
            const rig = calculateDetailedCharacterRig({ aimAngle, crouchAmount, reducedMotion, reloadProgress: frame / 50 });
            expect(rig.geometry).toEqual(neutral.geometry);
            expect(rig.aim).toEqual(neutral.aim);
            expect(rig.rifle.pivot).toEqual(neutral.rifle.pivot);
            expect(rig.triggerArm.hand).toEqual(rig.rifle.triggerGrip);
            for (const arm of [rig.triggerArm, rig.supportArm]) {
              expect(distance(arm.shoulder, arm.elbow)).toBeCloseTo(arm.upperLength, 8);
              expect(distance(arm.elbow, arm.hand)).toBeCloseTo(arm.forearmLength, 8);
            }
          }
        }
      }
    }
  });

  it('keeps hand and magazine paths continuous through each phase boundary and freezes with the simulation clock', () => {
    for (const aimAngle of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
      for (const progress of [.12, .2, .28, .32, .35, .38, .42, .49, .55, .63, .72, .82, .865, .88]) {
        const before = calculateDetailedCharacterRig({ aimAngle, reloadProgress: progress - .000001 });
        const after = calculateDetailedCharacterRig({ aimAngle, reloadProgress: progress + .000001 });
        expect(distance(before.supportArm.hand, after.supportArm.hand)).toBeLessThan(.002);
        expect(distance(before.magazine.center, after.magazine.center)).toBeLessThan(.002);
      }
    }
    const pose = { aimAngle: .4, crouchAmount: .6, reloadProgress: .42 };
    expect(calculateDetailedCharacterRig({ ...pose, time: 1000 })).toEqual(calculateDetailedCharacterRig({ ...pose, time: 0 }));
    for (const reloadProgress of [-1, -.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(calculateDetailedCharacterRig({ aimAngle: 0, reloadProgress })).toEqual(calculateDetailedCharacterRig({ aimAngle: 0 }));
    }
  });

  it('mirrors the same reload in either facing and retains readable hand stages with reduced motion', () => {
    for (const reloadProgress of [0, .12, .2, .35, .45, .55, .72, .82, 1]) {
      for (const reducedMotion of [false, true]) {
        const right = calculateDetailedCharacterRig({ aimAngle: 0, crouchAmount: 1, reloadProgress, reducedMotion });
        const left = calculateDetailedCharacterRig({ aimAngle: Math.PI, crouchAmount: 1, reloadProgress, reducedMotion });
        expect(left).toEqual(right);
      }
    }
    const normal = calculateDetailedCharacterRig({ aimAngle: 0, reloadProgress: .2 });
    const restrained = calculateDetailedCharacterRig({ aimAngle: 0, reloadProgress: .2, reducedMotion: true });
    expect(Math.abs(restrained.rifle.angle)).toBeLessThan(Math.abs(normal.rifle.angle));
    expect(distance(restrained.supportArm.hand, restrained.rifle.supportGrip)).toBeGreaterThan(8);
    expect(restrained.magazine.seated).toBe(false);
  });
});

describe('character review recipes', () => {
  it('provides an unobscured base and the three requested builds without changing pose data', () => {
    expect(CHARACTER_LOOKS.map(look=>look.id)).toEqual(['base','field','scout','heavy']);
    const [base,field,scout,heavy]=CHARACTER_LOOKS;
    expect(base.appearance.headgear).toBe('none');
    expect(base.appearance.eyewear).toBe('none');
    expect(base.appearance.beard).toBe('none');
    expect([field.appearance.build,scout.appearance.build,heavy.appearance.build]).toEqual(['standard','slim','broad']);
    expect([field.appearance.headgear,scout.appearance.headgear,heavy.appearance.headgear]).toEqual(['helmet','cap','beret']);
    expect([field.appearance.beard,scout.appearance.beard,heavy.appearance.beard]).toEqual(['short','stubble','full']);
    const temporary={...field.appearance,headgear:'none' as const,eyewear:'none' as const};
    expect(temporary.headgear).toBe('none');
    expect(field.appearance.headgear).toBe('helmet');
  });
});
