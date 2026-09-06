import { describe,expect,it,vi } from 'vitest';
import { DeathFragments,type DeathFragmentPose } from './deathFragments';
import { DEFAULT_APPEARANCE } from './appearance';
import { drawCharacterFragment, getCharacterFragmentAnchors } from './detailedCharacter';
import { CHARACTER_SCALE } from './stance';

vi.mock('./detailedCharacter',async original=>({...await original<typeof import('./detailedCharacter')>(),drawCharacterFragment:vi.fn()}));
const source=():DeathFragmentPose=>({x:100,y:32,width:36,height:68,aimAngle:0,crouchAmount:0,vx:80,vy:0,appearance:{...DEFAULT_APPEARANCE}});
const floor=[{x:-1000,y:100,width:3000,height:500}];
const context=()=>new Proxy<Record<string,unknown>>({globalAlpha:1},{get:(target,key:string)=>target[key]??(()=>{})}) as unknown as CanvasRenderingContext2D;
describe('cosmetic death pieces',()=>{
  it('bounds simultaneous deaths and removes every part after the fade',()=>{
    const pieces=new DeathFragments();
    for(let i=0;i<20;i++)pieces.spawn(source(),{x:1,y:0},i,'high',false);
    expect(pieces.count).toBe(48);
    for(let i=0;i<120;i++)pieces.update(1/60,floor,800);
    expect(pieces.count).toBe(48);
    for(let i=0;i<40;i++)pieces.update(1/60,floor,800);
    expect(pieces.count).toBe(0);
  });
  it('retains the dead life appearance and never mutates the actor while updating or drawing',()=>{
    const pieces=new DeathFragments(),actor=source(),before=JSON.stringify(actor);
    pieces.spawn(actor,{x:0,y:0},5,'medium',false);
    actor.appearance.topColor='rust';
    pieces.update(.05,floor,800);pieces.draw(context(),{x:0,y:0},{x:800,y:600});
    expect(vi.mocked(drawCharacterFragment).mock.calls.at(-1)![3].topColor).toBe(DEFAULT_APPEARANCE.topColor);
    actor.appearance.topColor=DEFAULT_APPEARANCE.topColor;
    expect(JSON.stringify(actor)).toBe(before);
    pieces.clear();expect(pieces.count).toBe(0);
  });
  it('keeps low effects to three complete groups within the lower pool cap',()=>{
    const low=new DeathFragments(),reduced=new DeathFragments();
    low.spawn(source(),{x:1,y:0},1,'low',false);reduced.spawn(source(),{x:1,y:0},1,'high',true);
    expect(low.count).toBe(3);expect(reduced.count).toBe(3);
    vi.mocked(drawCharacterFragment).mockClear();
    low.draw(context(),{x:0,y:0},{x:800,y:600});
    expect(vi.mocked(drawCharacterFragment).mock.calls.map(call=>call[1])).toEqual(['legs','upperBody','head']);
    for(let i=0;i<50;i++)reduced.update(1/60,floor,800);
    expect(reduced.count).toBe(0);expect(low.count).toBe(3);
    for(let i=0;i<20;i++)low.spawn(source(),{x:1,y:0},i,'low',false);
    expect(low.count).toBe(24);
  });
  it.each([0,Math.PI])('keeps the entire reduced-motion pose attached and still when facing %s',aimAngle=>{
    const pieces=new DeathFragments(),actor={...source(),aimAngle,crouchAmount:.8};
    const ctx=context(),translate=vi.fn(),rotate=vi.fn();ctx.translate=translate;ctx.rotate=rotate;
    pieces.spawn(actor,{x:1,y:-1},2,'high',true);
    vi.mocked(drawCharacterFragment).mockClear();pieces.draw(ctx,{x:0,y:0},{x:800,y:600});
    const calls=vi.mocked(drawCharacterFragment).mock.calls,centers=translate.mock.calls.map(([x,y])=>({x,y}));
    const anchors=getCharacterFragmentAnchors(calls[0][2]),facing=Math.cos(aimAngle)>=0?1:-1;
    // Undo each group's anchor after the shared quarter-turn: all must meet at one origin.
    const origins=calls.map((call,index)=>({x:centers[index].x+facing*anchors[call[1]].y*CHARACTER_SCALE,
      y:centers[index].y-anchors[call[1]].x*CHARACTER_SCALE}));
    for(const origin of origins){expect(origin.x).toBeCloseTo(origins[0].x);expect(origin.y).toBeCloseTo(origins[0].y);}
    expect(rotate.mock.calls).toEqual([[facing*Math.PI/2],[facing*Math.PI/2],[facing*Math.PI/2]]);
    translate.mockClear();pieces.update(.25,floor,800);pieces.draw(ctx,{x:0,y:0},{x:800,y:600});
    expect(translate.mock.calls.map(([x,y])=>({x,y}))).toEqual(centers);
  });
  it('draws both arms, the fuel unit and both booted legs inside the low-detail groups',async()=>{
    const actual=await vi.importActual<typeof import('./detailedCharacter')>('./detailedCharacter');
    const pose={aimAngle:0,crouchAmount:.6,weaponId:'pistol' as const};
    const rig=actual.calculateDetailedCharacterRig(pose),ctx=context(),moveTo=vi.fn(),lineTo=vi.fn(),roundRect=vi.fn();
    ctx.moveTo=moveTo;ctx.lineTo=lineTo;ctx.roundRect=roundRect;
    actual.drawCharacterFragment(ctx,'upperBody',pose,DEFAULT_APPEARANCE);
    for(const arm of [rig.supportArm,rig.triggerArm]){
      expect(moveTo).toHaveBeenCalledWith(arm.shoulder.x,arm.shoulder.y);
      expect(lineTo).toHaveBeenCalledWith(arm.elbow.x,arm.elbow.y);
    }
    expect(roundRect.mock.calls.some(call=>call[2]===8&&call[3]===20)).toBe(true);
    moveTo.mockClear();lineTo.mockClear();roundRect.mockClear();
    actual.drawCharacterFragment(ctx,'legs',pose,DEFAULT_APPEARANCE);
    for(const leg of [rig.geometry.farLeg,rig.geometry.nearLeg]){
      expect(moveTo).toHaveBeenCalledWith(leg.hip.x,leg.hip.y);
      expect(lineTo).toHaveBeenCalledWith(leg.knee.x,leg.knee.y);
      expect(roundRect.mock.calls.some(call=>call[0]===leg.boot.x+.1&&call[2]===leg.boot.width-.2)).toBe(true);
    }
  });
  it('expires pieces after a real-time hitch instead of stretching their lifetime with physics catch-up limits',()=>{
    const pieces=new DeathFragments();pieces.spawn(source(),{x:1,y:0},3,'high',false);
    pieces.update(3.1,floor,800);expect(pieces.count).toBe(0);
  });
});
