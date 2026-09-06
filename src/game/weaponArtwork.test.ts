import { describe,expect,it } from 'vitest';
import { WEAPON_ARTWORK,WEAPON_SILHOUETTES } from './weaponArtwork';
import { WEAPONS } from './weapons';
import { CHARACTER_SCALE } from './stance';
import { calculateDetailedCharacterRig } from './detailedCharacter';
import type { WeaponId } from './types';
import range from '../../public/assets/arena.json';
import { createWorld, getWeaponOrigin } from './simulation';
import { createWeapon } from './weapons';

describe('equipped weapon artwork',()=>{
  it('gives each weapon a distinct silhouette and keeps visible muzzles aligned with combat distances',()=>{
    const ids=Object.keys(WEAPONS) as WeaponId[];
    expect(new Set(ids.map(id=>WEAPON_SILHOUETTES[id])).size).toBe(7);
    for(const id of ids)expect(WEAPON_ARTWORK[id].muzzle.x*CHARACTER_SCALE).toBe(WEAPONS[id].muzzleLength);
  });
  it('attaches each hand to its equipped gun through aim, crouch, independent recoil and reload',()=>{
    for(const main of ['pistol','revolver','uzi','ump'] as const)for(const offhand of ['pistol','revolver','uzi','ump'] as const)
      for(const aimAngle of [-Math.PI/2,0,Math.PI/2,Math.PI])for(const crouchAmount of [0,1]){
        const pose={aimAngle,crouchAmount,weaponId:main,offhandWeaponId:offhand,recoil:0,offhandRecoil:1,offhandReloadProgress:-1};
        const rig=calculateDetailedCharacterRig(pose);
        expect(rig.triggerArm.hand).toEqual(rig.rifle.triggerGrip);
        expect(rig.supportArm.hand).toEqual(rig.offhand!.triggerGrip);
        expect(rig.offhand!.pivot.x).toBeLessThan(rig.rifle.pivot.x-15);
        expect(rig.offhand!.pivot.y).toBeLessThan(rig.rifle.pivot.y);
        expect(rig.rifle.recoil).toBe(0);expect(rig.offhand!.recoil).toBe(1);
        for(const arm of [rig.triggerArm,rig.supportArm]){
          expect(Math.hypot(arm.shoulder.x-arm.elbow.x,arm.shoulder.y-arm.elbow.y)).toBeCloseTo(arm.upperLength,8);
          expect(Math.hypot(arm.hand.x-arm.elbow.x,arm.hand.y-arm.elbow.y)).toBeCloseTo(arm.forearmLength,8);
        }
        const reload=calculateDetailedCharacterRig({...pose,offhandReloadProgress:.3});
        expect(reload.rifle.angle).toBeCloseTo(1.2,10);
        expect(reload.rifle.pivot.y).toBe(rig.geometry.bodyOffset.y-23);
        expect(reload.offhand!.magazine.seated).toBe(false);
        expect(reload.supportArm.hand).toEqual(reload.offhand!.triggerGrip);
      }
  });
  it('uses the visible hand pivots as shot origins for either facing and stance',()=>{
    const player=createWorld(range).player;
    player.offhand=createWeapon('revolver','other');
    for(const aimAngle of [0,Math.PI,-.8,2.3])for(const crouchAmount of [0,.5,1]){
      Object.assign(player,{aimAngle,crouchAmount});
      const rig=calculateDetailedCharacterRig({weaponId:'pistol',offhandWeaponId:'revolver',aimAngle,crouchAmount});
      const facing=Math.cos(aimAngle)>=0?1:-1;
      for(const hand of ['main','offhand'] as const){
        const pivot=hand==='main'?rig.rifle.pivot:rig.offhand!.pivot;
        const origin=getWeaponOrigin(player,hand);
        expect(origin.x).toBeCloseTo(player.x+player.width/2+pivot.x*CHARACTER_SCALE*facing,8);
        expect(origin.y).toBeCloseTo(player.y+player.height+pivot.y*CHARACTER_SCALE,8);
      }
    }
  });
  it('keeps handgun palms on the handle and the support hand below the firing hand',()=>{
    for(const id of ['pistol','revolver'] as const){
      const art=WEAPON_ARTWORK[id];
      expect(art.trigger.x).toBeLessThan(4);
      expect(art.trigger.y).toBeGreaterThan(5);
      expect(art.support.y).toBeGreaterThan(art.trigger.y);
      expect(Math.hypot(art.support.x-art.trigger.x,art.support.y-art.trigger.y)).toBeLessThan(4);
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
