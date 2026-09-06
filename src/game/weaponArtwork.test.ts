import { describe,expect,it } from 'vitest';
import { WEAPON_ARTWORK,WEAPON_SILHOUETTES } from './weaponArtwork';
import { WEAPONS } from './weapons';
import { CHARACTER_SCALE } from './stance';
import { calculateDetailedCharacterRig } from './detailedCharacter';
import type { WeaponId } from './types';

describe('equipped weapon artwork',()=>{
  it('gives each weapon a distinct silhouette and keeps visible muzzles aligned with combat distances',()=>{
    const ids=Object.keys(WEAPONS) as WeaponId[];
    expect(new Set(ids.map(id=>WEAPON_SILHOUETTES[id])).size).toBe(7);
    for(const id of ids)expect(WEAPON_ARTWORK[id].muzzle.x*CHARACTER_SCALE).toBe(WEAPONS[id].muzzleLength);
  });
  it('attaches each hand to its equipped gun through aim, crouch, independent recoil and reload',()=>{
    for(const main of ['pistol','uzi','ump'] as const)for(const offhand of ['pistol','uzi','ump'] as const)
      for(const aimAngle of [-Math.PI/2,0,Math.PI/2,Math.PI])for(const crouchAmount of [0,1]){
        const pose={aimAngle,crouchAmount,weaponId:main,offhandWeaponId:offhand,recoil:0,offhandRecoil:1,offhandReloadProgress:-1};
        const rig=calculateDetailedCharacterRig(pose);
        expect(rig.triggerArm.hand).toEqual(rig.rifle.triggerGrip);
        expect(rig.supportArm.hand).toEqual(rig.offhand!.triggerGrip);
        expect(rig.offhand!.pivot.y-rig.rifle.pivot.y).toBe(7);
        expect(rig.rifle.recoil).toBe(0);expect(rig.offhand!.recoil).toBe(1);
        const reload=calculateDetailedCharacterRig({...pose,offhandReloadProgress:.3});
        expect(reload.rifle.angle).toBeCloseTo(1.2,10);
        expect(reload.rifle.pivot.y).toBe(rig.geometry.bodyOffset.y-23);
        expect(reload.offhand!.magazine.seated).toBe(false);
        expect(reload.supportArm.hand).toEqual(reload.offhand!.triggerGrip);
      }
  });
  it('keeps both arms at their authored lengths for every ready weapon and facing',()=>{
    for(const weaponId of Object.keys(WEAPONS) as WeaponId[])for(let step=0;step<24;step++){
      const rig=calculateDetailedCharacterRig({weaponId,aimAngle:step/24*Math.PI*2,crouchAmount:.5});
      for(const arm of [rig.triggerArm,rig.supportArm]){
        expect(Math.hypot(arm.shoulder.x-arm.elbow.x,arm.shoulder.y-arm.elbow.y)).toBeCloseTo(arm.upperLength,8);
        expect(Math.hypot(arm.hand.x-arm.elbow.x,arm.hand.y-arm.elbow.y)).toBeCloseTo(arm.forearmLength,8);
      }
    }
  });
});
