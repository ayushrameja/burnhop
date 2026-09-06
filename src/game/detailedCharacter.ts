import {
  calculateCharacterAim, calculateCharacterPose,
  type CharacterAimGeometry, type CharacterGeometry, type CharacterLegGeometry, type CharacterPose,
} from './character';
import { clothingMaterial, HAIR_COLORS, SKIN_COLORS, type DetailedAppearance } from './appearance';
import type { Vec2, WeaponId } from './types';
import { drawCharacterHitFlash } from './characterHitFlash';
import { RELOAD_CUES } from './reload';
import type { CharacterParts } from './characterParts';
import { drawWeaponArtwork, drawWeaponMagazine, WEAPON_ARTWORK } from './weaponArtwork';
import { getDualWeaponOffset } from './stance';

export interface DetailedArmGeometry { shoulder: Vec2; elbow: Vec2; hand: Vec2; upperLength: number; forearmLength: number }
export interface DetailedMagazineGeometry { center: Vec2; angle: number; opacity: number; seated: boolean; fresh: boolean }
export interface HeldWeaponGeometry {
  weaponId: WeaponId; pivot: Vec2; angle: number; recoil: number; boltOffset: number;
  triggerGrip: Vec2; supportGrip: Vec2; muzzle: Vec2; magazine: DetailedMagazineGeometry;
}
export interface DetailedCharacterRig {
  geometry: CharacterGeometry;
  aim: CharacterAimGeometry;
  triggerArm: DetailedArmGeometry;
  supportArm: DetailedArmGeometry;
  supportHandAngle: number;
  triggerHandAngle: number;
  magazine: DetailedMagazineGeometry;
  reload: { progress: number; stage: 'reach' | 'remove' | 'stow' | 'insert' | 'seat' | 'rack' | 'settle' } | null;
  rifle: { pivot: Vec2; angle: number; recoil: number; boltOffset: number; triggerGrip: Vec2; supportGrip: Vec2; muzzle: Vec2 };
  weaponId?: WeaponId;
  offhand?: HeldWeaponGeometry;
}

/** Rifle-local anchors, shared by both the drawing and the arm solver. */
export const DETAILED_RIFLE_ANCHORS = {
  triggerGrip: { x: 5, y: 4 }, supportGrip: { x: 17, y: 2 }, muzzle: { x: 28, y: 0 },
} as const;
const OUTLINE = '#26342e';
const PALE = '#ede6c7';
const clamp01 = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const segment = (progress: number, start: number, end: number) => {
  const t = clamp01((progress - start) / (end - start));
  return t * t * (3 - 2 * t);
};
const lerpPoint = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const rotated = (p: Vec2, pivot: Vec2, angle: number): Vec2 => ({
  x: pivot.x + (p.x - pivot.x) * Math.cos(angle) - (p.y - pivot.y) * Math.sin(angle),
  y: pivot.y + (p.x - pivot.x) * Math.sin(angle) + (p.y - pivot.y) * Math.cos(angle),
});
function solveArm(shoulder: Vec2, hand: Vec2, length: number, bendDirection = 1): DetailedArmGeometry {
  const dx = hand.x - shoulder.x, dy = hand.y - shoulder.y;
  const distance = Math.hypot(dx, dy);
  const bend = Math.sqrt(Math.max(0, length * length - distance * distance / 4));
  return {
    shoulder, hand,
    elbow: { x: (shoulder.x + hand.x) / 2 - dy / (distance || 1) * bend * bendDirection, y: (shoulder.y + hand.y) / 2 + dx / (distance || 1) * bend * bendDirection },
    upperLength: length, forearmLength: length,
  };
}

/** All positions are facing-right local coordinates, anchored at the approved soles. */
export function calculateDetailedCharacterRig(pose: CharacterPose): DetailedCharacterRig {
  const detailedPose = { ...pose, crouchAmount: pose.crouchAmount ?? 0 };
  const geometry = calculateCharacterPose(detailedPose);
  const aim = calculateCharacterAim(detailedPose, geometry);
  if (pose.weaponId) return calculateWeaponCharacterRig(pose, geometry, aim);
  const progress = Number.isFinite(pose.reloadProgress) && pose.reloadProgress! >= 0 ? clamp01(pose.reloadProgress!) : -1;
  const reloading = progress >= 0;
  // Keep the authoritative aim pivot/head/torso intact. Only the held rifle tips
  // inward while the support hand works; restrained mode retains each hand task.
  const tilt = reloading ? segment(progress, 0, .12) * (1 - segment(progress, .88, 1)) : 0;
  const angle = aim.pitch - tilt * (pose.reducedMotion ? .05 + aim.pitch * .06 : .14 + aim.pitch * .12);
  const recoil = reloading ? 0 : clamp01(pose.recoil ?? 0);
  const grip = (point: Vec2) => rotated({ x: aim.weaponPivot.x + point.x - recoil * 2.2, y: aim.weaponPivot.y + point.y }, aim.weaponPivot, angle);
  const shoulder = (x: number) => rotated({ x: geometry.bodyOffset.x + x, y: geometry.bodyOffset.y - 45 - geometry.bodyBob }, aim.torsoPivot, aim.torsoAngle);
  const triggerGrip = grip(DETAILED_RIFLE_ANCHORS.triggerGrip), supportGrip = grip(DETAILED_RIFLE_ANCHORS.supportGrip);
  let supportHand = supportGrip, supportHandAngle = angle, boltOffset = 0;
  let magazine: DetailedMagazineGeometry = { center: grip({ x: 11.4, y: 4.65 }), angle, opacity: 1, seated: true, fresh: true };
  let reload: DetailedCharacterRig['reload'] = null;
  if (reloading) {
    const magazineGrip = grip({ x: 11.4, y: 8 });
    const extracted = grip({ x: 11.4, y: pose.reducedMotion ? 12.2 : 13.4 });
    const belt = { x: geometry.bodyOffset.x + 8, y: geometry.bodyOffset.y - geometry.bodyBob - 24 };
    // Forward charging handle: the support hand can rack it without lifting an
    // elbow across the face or letting go with the trigger hand.
    const boltFront = grip({ x: 19.5, y: -2.8 });
    const boltBack = grip({ x: 14.5, y: -2.8 });
    const stages: { end: number; point: Vec2; name: NonNullable<DetailedCharacterRig['reload']>['stage'] }[] = [
      { end: .12, point: magazineGrip, name: 'reach' },
      { end: RELOAD_CUES.remove, point: extracted, name: 'remove' },
      { end: .32, point: belt, name: 'stow' },
      { end: .38, point: belt, name: 'stow' },
      { end: .49, point: extracted, name: 'insert' },
      { end: RELOAD_CUES.insert, point: magazineGrip, name: 'insert' },
      { end: .63, point: magazineGrip, name: 'seat' },
      { end: .72, point: boltFront, name: 'rack' },
      { end: RELOAD_CUES.rack, point: boltBack, name: 'rack' },
      { end: .865, point: boltFront, name: 'rack' },
      { end: 1, point: supportGrip, name: 'settle' },
    ];
    let start = 0, from = supportGrip;
    for (const stage of stages) {
      if (progress <= stage.end) {
        supportHand = lerpPoint(from, stage.point, segment(progress, start, stage.end));
        reload = { progress, stage: stage.name };
        break;
      }
      start = stage.end;
      from = stage.point;
    }
    const atBelt = segment(progress, RELOAD_CUES.remove, .32) * (1 - segment(progress, .38, .49));
    supportHandAngle = mix(angle, .12, atBelt);
    boltOffset = -5 * segment(progress, .72, RELOAD_CUES.rack) * (1 - segment(progress, RELOAD_CUES.rack, .865)) || 0;
    if (progress > .12 && progress < RELOAD_CUES.insert) {
      // Keep the magazine in this hand's grip until it disappears into the belt.
      // The replacement emerges at that same position, then moves into the well.
      const center = rotated({ x: supportHand.x, y: supportHand.y - 3.35 }, supportHand, supportHandAngle);
      const fresh = progress >= .35;
      magazine = {
        center, angle: supportHandAngle, seated: false, fresh,
        opacity: fresh ? segment(progress, .38, .42) : 1 - segment(progress, .28, .32),
      };
    }
  }
  return {
    geometry, aim,
    triggerArm: solveArm(shoulder(-8), triggerGrip, 11.5),
    supportArm: solveArm(shoulder(7), supportHand, 14),
    supportHandAngle, triggerHandAngle: angle, magazine, reload,
    rifle: { pivot: aim.weaponPivot, angle, recoil, boltOffset, triggerGrip, supportGrip, muzzle: grip(DETAILED_RIFLE_ANCHORS.muzzle) },
  };
}

function calculateWeaponCharacterRig(pose: CharacterPose, geometry: CharacterGeometry, aim: CharacterAimGeometry): DetailedCharacterRig {
  const shoulder = (x:number) => rotated({x:geometry.bodyOffset.x+x,y:geometry.bodyOffset.y-45-geometry.bodyBob},aim.torsoPivot,aim.torsoAngle);
  const mainReloading=(pose.reloadProgress??-1)>=0,offhandReloading=!mainReloading&&(pose.offhandReloadProgress??-1)>=0;
  const held = (weaponId:WeaponId,offhand:boolean):HeldWeaponGeometry => {
    const art=WEAPON_ARTWORK[weaponId], value=offhand?pose.offhandReloadProgress:pose.reloadProgress;
    const progress=value!==undefined && value>=0?clamp01(value):-1;
    const tilt=progress>=0?segment(progress,0,.12)*(1-segment(progress,.88,1)):0;
    // While one gun reloads, the other is visibly stowed at the belt so a hand can work the magazine.
    const stowed=pose.offhandWeaponId&&(offhand?mainReloading:offhandReloading);
    const otherProgress=(offhand?pose.reloadProgress:pose.offhandReloadProgress)??-1;
    const stowAmount=stowed?segment(otherProgress,0,.12)*(1-segment(otherProgress,.88,1)):0;
    const lane=pose.offhandWeaponId?getDualWeaponOffset(offhand?'offhand':'main'):{x:0,y:0};
    const pivot=lerpPoint({x:aim.weaponPivot.x+lane.x,y:aim.weaponPivot.y+lane.y},
      {x:geometry.bodyOffset.x+(offhand?9:-11),y:geometry.bodyOffset.y-23},stowAmount);
    const angle=mix(aim.pitch*(1-tilt*.55)-tilt*(pose.reducedMotion ? .035 : .08),1.2,stowAmount);
    const recoil=progress>=0||stowed?0:clamp01((offhand?pose.offhandRecoil:pose.recoil)??0);
    const point=(p:Vec2)=>rotated({x:pivot.x+p.x-recoil*2.2,y:pivot.y+p.y},pivot,angle);
    const extracted=progress>=0?segment(progress,.12,.3)*(1-segment(progress,.45,.6)):0;
    const magazinePoint=point({x:art.magazine.x,y:art.magazine.y+extracted*(weaponId==='revolver'?3:6)});
    return {weaponId,pivot,angle,recoil,boltOffset:0,triggerGrip:point(art.trigger),supportGrip:point(art.support),muzzle:point(art.muzzle),
      magazine:{center:magazinePoint,angle:angle+(weaponId==='revolver'?extracted*.5:0),opacity:progress>.3&&progress<.43?.12:1,seated:extracted===0,fresh:progress>=.4}};
  };
  const main=held(pose.weaponId!,false),offhand=pose.offhandWeaponId?held(pose.offhandWeaponId,true):undefined;
  const progress=pose.reloadProgress??-1;
  let supportHand=offhand?offhand.triggerGrip:main.supportGrip;
  if(progress>=0){
    const reach=segment(progress,0,.12)*(1-segment(progress,.82,1));
    const magazineHand={x:main.magazine.center.x,y:main.magazine.center.y+3};
    supportHand=lerpPoint(offhand?offhand.triggerGrip:main.supportGrip,magazineHand,reach);
  }
  const punch=pose.meleeProgress!==undefined&&pose.meleeProgress>=0?Math.sin(clamp01(pose.meleeProgress)*Math.PI):0;
  let mainHand=pose.meleeProgress!==undefined && pose.meleeProgress>=0
    ? rotated({x:aim.weaponPivot.x+8+punch*19,y:aim.weaponPivot.y},aim.weaponPivot,aim.pitch)
    :main.triggerGrip;
  if(offhand && offhandReloading){
    const reach=segment(pose.offhandReloadProgress!,0,.12)*(1-segment(pose.offhandReloadProgress!,.82,1));
    mainHand=lerpPoint(main.triggerGrip,{x:offhand.magazine.center.x,y:offhand.magazine.center.y+3},reach);
  }
  const mainShoulder=shoulder(offhand?7:-8);
  if(punch>0){mainShoulder.x+=Math.cos(aim.pitch)*punch*14;mainShoulder.y+=Math.sin(aim.pitch)*punch*14;}
  return {geometry,aim,weaponId:pose.weaponId,offhand,triggerArm:solveArm(mainShoulder,mainHand,11.5),supportArm:solveArm(shoulder(offhand?-8:7),supportHand,14),
    supportHandAngle:mainReloading?main.angle:offhand?.angle??main.angle,
    triggerHandAngle:offhand && offhandReloading?offhand.angle:main.angle,magazine:main.magazine,
    reload:progress>=0?{progress,stage:progress<.15?'reach':progress<.35?'remove':progress<.5?'stow':progress<.65?'insert':progress<.85?'rack':'settle'}:null,
    rifle:main};
}

function path(ctx: CanvasRenderingContext2D, points: readonly number[], fill: string, stroke = OUTLINE, width = 1.35) {
  ctx.beginPath();ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();ctx.fillStyle = fill;ctx.fill();
  if (stroke) {ctx.strokeStyle = stroke;ctx.lineWidth = width;ctx.stroke();}
}
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string, stroke = OUTLINE, width = 1.2) {
  ctx.beginPath();ctx.roundRect(x, y, w, h, radius);ctx.fillStyle = fill;ctx.fill();
  if (stroke) {ctx.strokeStyle = stroke;ctx.lineWidth = width;ctx.stroke();}
}
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke = '', width = 1) {
  ctx.beginPath();ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);ctx.fillStyle = fill;ctx.fill();
  if (stroke) {ctx.strokeStyle = stroke;ctx.lineWidth = width;ctx.stroke();}
}
function line(ctx: CanvasRenderingContext2D, points: readonly number[], color: string, width = 1) {
  ctx.beginPath();ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.strokeStyle = color;ctx.lineWidth = width;ctx.stroke();
}
function tube(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, width: number, color: string, outline = true) {
  if (outline) line(ctx, [from.x, from.y, to.x, to.y], OUTLINE, width + 2.4);
  line(ctx, [from.x, from.y, to.x, to.y], color, width);
}
function rotateAround(ctx: CanvasRenderingContext2D, pivot: Vec2, angle: number) {
  ctx.translate(pivot.x, pivot.y);ctx.rotate(angle);ctx.translate(-pivot.x, -pivot.y);
}

function drawBoot(ctx: CanvasRenderingContext2D, leg: CharacterLegGeometry, appearance: DetailedAppearance, near: boolean) {
  const { boot, ankle } = leg;
  const palette = clothingMaterial(appearance.bootsColor, 'boots');
  const x = boot.x, y = boot.y, w = boot.width, h = boot.height;
  // Every boot style uses the same cap, ground-contact plane, and recessed nozzle.
  path(ctx, [x,y+1.3,x+2,y-.4,x+w-5,y-.4,x+w-3.5,y+1.4,x+w,y+2,x+w,y+h-.7,x+.2,y+h-.7], near ? palette.base : palette.dark);
  box(ctx, x+.1, y+h-1.8, w-.2, 1.7, .65, OUTLINE, '', 0);
  line(ctx, [x+1.8,y+.8,x+w-4,y+.8], palette.light, .95);
  line(ctx, [x+w-4,y+1.4,x+w-4,y+3.4], palette.dark, .8);
  if (appearance.boots === 'light') {
    line(ctx, [x+2,y+2.6,x+w-4.5,y+2.6], palette.seam, .8);
  } else {
    const cuffX = ankle.x-3;
    box(ctx, cuffX, y-2.8, 6.5, 3, .7, palette.dark, OUTLINE, .85);
    line(ctx, [cuffX+1,y-1.4,cuffX+5,y-1.4], palette.light, .8);
    for (let i=0;i<2;i++) line(ctx,[x+3+i*1.9,y+1.2,x+4+i*1.9,y+2.8],palette.seam,.65);
    if (appearance.boots === 'armoured') {
      path(ctx,[x+w-5,y+.7,x+w-1,y+1.7,x+w-.6,y+3.4,x+w-5,y+3.4],palette.light,OUTLINE,.7);
    }
  }
  box(ctx, x+w/2-2, y+h-1.35, 4, 1.35, .3, '#152924', '', 0);
  line(ctx,[x+w/2-1.2,y+h-1.05,x+w/2+1.2,y+h-1.05], '#d4b66d',.45);
}
function drawLeg(ctx: CanvasRenderingContext2D, leg: CharacterLegGeometry, appearance: DetailedAppearance, near: boolean, waistY: number) {
  // Round thigh caps belong under the waist, including on the broad build.
  // Clip artwork only: the approved hip, knee, and sole positions stay intact.
  ctx.save();ctx.beginPath();ctx.rect(-100,waistY,200,200);ctx.clip();
  const p = clothingMaterial(appearance.trousersColor, 'trousers');
  const width = (appearance.build === 'slim' ? 7.5 : appearance.build === 'broad' ? 10 : 8.5) - (near ? 0 : .8);
  const calfEnd = { x: leg.ankle.x, y: leg.boot.y-1 };
  tube(ctx, leg.hip, leg.knee, width, near ? p.base : p.dark);
  tube(ctx, leg.knee, calfEnd, width-.9, near ? p.base : p.dark);
  line(ctx,[leg.hip.x-1.5,leg.hip.y+2,leg.knee.x-1.5,leg.knee.y,calfEnd.x-1.2,calfEnd.y-1],near ? p.light : p.base,.9);
  if (appearance.trousers !== 'fatigues') {
    const pocket = lerpPoint(leg.hip, leg.knee, .42);
    box(ctx,pocket.x-2.4,pocket.y-1.4,5.4,5.1,.7,near?p.dark:p.base,OUTLINE,.8);
    line(ctx,[pocket.x-1.7,pocket.y-.1,pocket.x+2.3,pocket.y-.1],p.light,.7);
  }
  if (appearance.trousers === 'reinforced') {
    box(ctx,leg.knee.x-3.1,leg.knee.y-2.6,6.2,5.1,1.3,p.dark,OUTLINE,.9);
    line(ctx,[leg.knee.x-1.9,leg.knee.y-1.1,leg.knee.x+1.9,leg.knee.y-1.1],p.light,.75);
  } else line(ctx,[leg.knee.x-1.2,leg.knee.y-1,leg.knee.x+2,leg.knee.y],p.dark,.8);
  ctx.save();
  ctx.translate(leg.ankle.x, leg.ankle.y);
  ctx.rotate(leg.bootAngle ?? 0);
  ctx.translate(-leg.ankle.x, -leg.ankle.y);
  drawBoot(ctx, leg, appearance, near);
  ctx.restore();
  ctx.restore();
}

function drawArm(ctx: CanvasRenderingContext2D, arm: DetailedArmGeometry, appearance: DetailedAppearance, far: boolean) {
  const p = clothingMaterial(appearance.topColor, 'top'), skin = SKIN_COLORS[appearance.skin];
  const width = (appearance.build === 'slim' ? 5.2 : appearance.build === 'broad' ? 6.8 : 6) - (far ? .35 : 0);
  const elbow = arm.elbow;
  const cuff = lerpPoint(elbow,arm.hand,appearance.top==='t-shirt' ? .02 : .64);
  tube(ctx,arm.shoulder,elbow,width,far?p.dark:p.base);
  tube(ctx,elbow,arm.hand,width-1,far?skin.dark:skin.base);
  if (appearance.top !== 't-shirt') tube(ctx,elbow,cuff,width-.2,far?p.dark:p.base);
  const cuffLength = Math.hypot(arm.hand.x-elbow.x,arm.hand.y-elbow.y) || 1;
  const normal={x:-(arm.hand.y-elbow.y)/cuffLength,y:(arm.hand.x-elbow.x)/cuffLength};
  line(ctx,[cuff.x-normal.x*(width/2-.3),cuff.y-normal.y*(width/2-.3),cuff.x+normal.x*(width/2-.3),cuff.y+normal.y*(width/2-.3)],p.dark,1.2);
  const highlight = lerpPoint(arm.shoulder,elbow,.25), end = lerpPoint(arm.shoulder,elbow,.76);
  line(ctx,[highlight.x-.8,highlight.y-.5,end.x-.8,end.y-.5],far?p.base:p.light,.9);
  if (appearance.top === 'tactical-shirt') {
    const patch = lerpPoint(arm.shoulder, elbow, .34);
    ellipse(ctx,patch.x,patch.y,width*.38,width*.5,p.dark,OUTLINE,.65);
    line(ctx,[patch.x-1,patch.y-.8,patch.x+1,patch.y-.8],p.seam,.7);
  } else if (!far) ellipse(ctx,arm.shoulder.x,arm.shoulder.y,2.7,2.4,p.light,'',0);
}
function drawTorso(ctx: CanvasRenderingContext2D, rig: DetailedCharacterRig, a: DetailedAppearance) {
  const p = clothingMaterial(a.topColor, 'top'), skin = SKIN_COLORS[a.skin];
  const w = a.build==='slim'?10:a.build==='broad'?14:12;
  ctx.save();rotateAround(ctx,rig.aim.torsoPivot,rig.aim.torsoAngle);ctx.translate(rig.geometry.bodyOffset.x,rig.geometry.bodyOffset.y-rig.geometry.bodyBob);
  // The shared boot-fuel unit stays behind the jacket and travels with torso debris.
  box(ctx,-w-6,-46,8,20,2.2,'#354444',OUTLINE,1.1);
  box(ctx,-w-5.5,-42.5,2.3,9,1,'#6aadb0','',0);
  line(ctx,[-w-4.6,-44.2,-w-1,-44.2],'#82978d',.8);
  line(ctx,[-w-4.5,-29,-w-1,-29],'#1f3030',1.4);
  // The neck, collar and jacket share the torso transform; the head has its own pivot.
  box(ctx,-3.4,-53,9,9,2,skin.base);
  path(ctx,[-w+3,-49,-4,-50,6,-49,w-1,-46,w,-28,w-1,-23,-w+1,-23,-w,-43],p.base);
  path(ctx,[-w+3,-47,-w,-43,-w+1,-25,-w+5,-25,-w+4,-44],p.dark,'');
  path(ctx,[4,-47,w-2,-44,w-1,-27,7,-27,6,-39],p.light,'');
  if(a.top === 'field-jacket') {
    path(ctx,[-4,-50,0,-46,-4,-42,-8,-47],p.light,OUTLINE,.8);
    path(ctx,[5,-49,0,-46,4,-42,8,-46],p.light,OUTLINE,.8);
    line(ctx,[0,-44,0,-27],p.dark,1.15);
    box(ctx,3,-41,6.2,6.4,.8,p.dark,'',0);
    path(ctx,[2.6,-41,9.7,-41,9.1,-38.9,3.2,-38.9],p.light,OUTLINE,.6);
    ellipse(ctx,6,-38.9,.55,.55,PALE);
    box(ctx,-7.8,-41,5.3,6,.6,p.base,OUTLINE,.65);
    line(ctx,[-7.2,-39.6,-3.2,-39.6],p.seam,.65);
    for(const y of [-39,-34,-29])ellipse(ctx,.5,y,.65,.65,p.seam);
  } else if(a.top === 'tactical-shirt') {
    // A fitted quarter-zip combat shirt: no field-jacket lapels or flap pockets.
    path(ctx,[-w+3,-48,-5,-49,-3,-43,-w+1,-41],p.dark,OUTLINE,.7);
    path(ctx,[5,-49,w-2,-46,w-1,-41,4,-43],p.dark,OUTLINE,.7);
    box(ctx,-3.5,-49,8,4,1,p.dark,OUTLINE,.7);
    line(ctx,[.4,-48,.4,-37],p.seam,.75);
    box(ctx,-.5,-42.3,1.8,2,.3,p.light,OUTLINE,.45);
    line(ctx,[-w+5,-38,-w+4,-29,0,-27,w-4,-29,w-4,-37],p.dark,.85);
    line(ctx,[4.2,-40,8.2,-39.2],p.light,1.1);
    line(ctx,[-w+3,-25,w-3,-25],p.dark,.8);
  } else {
    // A round neck and an uninterrupted front distinguish the simple T-shirt.
    ctx.beginPath();ctx.moveTo(-5,-49);ctx.quadraticCurveTo(0,-43,5.5,-48.7);
    ctx.strokeStyle=p.dark;ctx.lineWidth=1.6;ctx.stroke();
    line(ctx,[-w+3,-25,w-3,-25],p.dark,.8);
    path(ctx,[4,-39,8,-39,8,-35,6,-33,4,-35],p.dark,'');
    line(ctx,[5,-37.2,7,-37.2],p.seam,.8);
  }
  if(a.vest !== 'none') {
    const v = clothingMaterial(a.vestColor, 'vest');
    const left=-w+2,right=w-2;
    path(ctx,[left,-44,left+2,-48,-4,-47,-4,-42,4,-42,5,-47,right,-46,right,-27,left,-27],v.dark);
    if(a.vest==='armoured') {
      path(ctx,[-w+4,-41,w-4,-41,w-3,-34,w-5,-28,-w+4,-28,-w+3,-35],v.base,OUTLINE,.9);
      line(ctx,[-w+5,-39,w-5,-39],v.light,1.2);
      line(ctx,[-w+5,-35,w-4,-35],v.light,.7);
      line(ctx,[-w+4,-32,w-5,-32],v.dark,1.1);
      box(ctx,-3,-43,6,2,.4,v.light,'',0);
    } else {
      for(const x of [left+2,1.5]) {
        box(ctx,x,-39,6.3,9,1,v.base,OUTLINE,.7);
        box(ctx,x+.2,-39,5.9,2.4,.4,v.light,OUTLINE,.5);
        ellipse(ctx,x+3,-37.7,.5,.5,PALE);
      }
    }
  }
  ctx.restore();
}

function drawBelt(ctx: CanvasRenderingContext2D, rig: DetailedCharacterRig, a: DetailedAppearance) {
  const w = a.build==='slim'?10:a.build==='broad'?14:12;
  // Belt and pouches sit in front of both thighs and remain fixed to the pelvis.
  ctx.save();ctx.translate(rig.geometry.bodyOffset.x,rig.geometry.bodyOffset.y-rig.geometry.bodyBob);
  if(a.belt !== 'none') {
    const b = clothingMaterial(a.beltColor, 'belt');
    box(ctx,-w+1,-27.6,w*2-2,4.4,.9,b.dark,OUTLINE,.9);
    box(ctx,0,-27.4,4.5,3.8,.45,'#c9ac67',OUTLINE,.7);
    box(ctx,.8,-26.6,2.8,2.1,.25,b.dark,'',0);
    if(a.belt==='pouches') {
      box(ctx,-w+.7,-28,5.5,6.5,.75,b.base,OUTLINE,.75);
      line(ctx,[-w+1.4,-26.2,-w+5.4,-26.2],b.light,.8);
      box(ctx,w-5,-27.8,4.8,5.7,.7,b.base,OUTLINE,.75);
    }
  }
  ctx.restore();
}

function drawFaceShape(ctx: CanvasRenderingContext2D, a: DetailedAppearance) {
  const s = SKIN_COLORS[a.skin];
  ctx.beginPath();ctx.moveTo(-11,-22);
  ctx.bezierCurveTo(-8,-28,10,-27,14,-21);
  ctx.bezierCurveTo(16,-18,15,-12,15,-8);
  if(a.faceShape==='square') {ctx.lineTo(14,-1);ctx.quadraticCurveTo(13,1,7,1);ctx.lineTo(-5,.5);ctx.quadraticCurveTo(-10,-1,-11,-7);}
  else if(a.faceShape==='round') {ctx.bezierCurveTo(16,1,4,4,-5,0);ctx.quadraticCurveTo(-12,-4,-12,-10);}
  else {ctx.bezierCurveTo(15,-1,9,2,3,1);ctx.bezierCurveTo(-8,1,-12,-6,-12,-12);}
  ctx.closePath();ctx.fillStyle=s.base;ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=1.45;ctx.stroke();
  // A warm side plane and forehead light establish the three-quarter face.
  path(ctx,[-11,-20,-6,-23,-7,-13,-5,-6,-2,-1,-6,-1,-11,-6,-12,-13],s.dark,'');
  ctx.beginPath();ctx.ellipse(5,-20,7,3,-.12,0,Math.PI*2);ctx.fillStyle=s.light;ctx.fill();
  ellipse(ctx,-12.3,-10.6,3.6,5,s.base,OUTLINE,1.1);
  line(ctx,[-13,-12.9,-11.1,-12.3,-12.4,-9.1,-10.8,-8.8],s.seam,.8);
  ellipse(ctx,11.5,-7.1,2.5,1.4,s.light);
}
function drawHair(ctx: CanvasRenderingContext2D, a: DetailedAppearance) {
  const p=HAIR_COLORS[a.hairColor];
  if(a.hair==='buzz') {
    // A close-cropped scalp follows the skull instead of sharing the crop silhouette.
    ctx.beginPath();ctx.moveTo(-12,-16);ctx.lineTo(-13,-21);
    ctx.quadraticCurveTo(-9,-27,1,-26);ctx.quadraticCurveTo(10,-26,14,-21);
    ctx.lineTo(11,-20);ctx.quadraticCurveTo(1,-24,-7,-20);ctx.lineTo(-9,-15);ctx.closePath();
    ctx.fillStyle=p.base;ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=.85;ctx.stroke();
    for(const [x,y] of [[-9,-21],[-5,-23],[-1,-24],[3,-23.6],[7,-22.7],[10,-21.8]]) {
      line(ctx,[x,y,x+.4,y+.6],p.light,.65);
    }
  } else if(a.hair==='spiky') {
    path(ctx,[-12,-13,-15,-19,-13,-21,-15,-24,-10,-23.4,-10,-27,-5,-25,-2,-27.8,1,-25.1,6,-27.4,7,-24.7,12,-26,12,-23.2,16,-22.5,12,-18.7,8,-20.7,4,-19.2,0,-21,-5,-19.8,-8,-13],p.base,OUTLINE,1.15);
    line(ctx,[-10,-22,-7,-23.5,-5,-21.6],p.light,.8);
    line(ctx,[-2,-24.5,0,-22.5],p.light,.8);
    line(ctx,[6,-24.1,8,-22.2],p.light,.8);
  } else if(a.hair==='tied-back') {
    // The tie and short tail remain visible at the nape beneath hats.
    path(ctx,[-13,-17,-18,-16.5,-20,-12,-18.2,-9,-20.2,-5,-15.2,-6.1,-12.8,-10,-12,-14],p.base,OUTLINE,1.1);
    line(ctx,[-17,-14.6,-16,-11.4,-17,-8],p.light,.75);
    box(ctx,-16.2,-17,3.5,3.2,.7,'#b59a63',OUTLINE,.6);
    ctx.beginPath();ctx.moveTo(-12,-14);ctx.lineTo(-15,-20.5);
    ctx.quadraticCurveTo(-13,-27,-3,-27);ctx.quadraticCurveTo(10,-27,14,-21);
    ctx.lineTo(10,-20);ctx.quadraticCurveTo(0,-23,-7,-17);ctx.lineTo(-9,-13);ctx.closePath();
    ctx.fillStyle=p.base;ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=1.1;ctx.stroke();
    ctx.beginPath();ctx.moveTo(9,-23.2);ctx.quadraticCurveTo(-1,-27,-11,-19);
    ctx.strokeStyle=p.light;ctx.lineWidth=.9;ctx.stroke();
    ctx.beginPath();ctx.moveTo(4,-22.8);ctx.quadraticCurveTo(-3,-24,-12,-17);
    ctx.strokeStyle=p.light;ctx.lineWidth=.65;ctx.stroke();
  } else if(a.hair!=='none') {
    ctx.beginPath();ctx.moveTo(-12,-13);ctx.lineTo(-15,-20);ctx.quadraticCurveTo(-14,-26,-7,-26.5);ctx.quadraticCurveTo(6,-27.6,13,-23);
    if(a.hair==='swept') {ctx.lineTo(17,-23);ctx.lineTo(12,-18);ctx.quadraticCurveTo(5,-16,-1,-21);ctx.lineTo(-6,-17);}
    else {ctx.lineTo(14,-21);ctx.lineTo(9,-20.3);ctx.lineTo(6,-21.8);ctx.lineTo(2,-20.2);ctx.lineTo(-2,-22);ctx.lineTo(-6,-19.5);}
    ctx.lineTo(-8,-13);ctx.closePath();ctx.fillStyle=p.base;ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=1.2;ctx.stroke();
    line(ctx,[-11,-22,-7,-24,-1,-24.5],p.light,.9);
    line(ctx,[2,-25,7,-24.2,10,-22.8],p.light,.8);
  }
  if(a.sideburns!=='none') {
    path(ctx,[-10,-17,-7,-16,-7,a.sideburns==='long'?-4:-8,-10,a.sideburns==='long'?-5:-9],HAIR_COLORS[a.sideburnColor].base,'');
  }
}
function drawFacialHair(ctx: CanvasRenderingContext2D, a: DetailedAppearance) {
  if(a.beard==='none')return;
  const p=HAIR_COLORS[a.beardColor];
  if(a.beard==='stubble') {
    for(const [x,y] of [[-5,-6],[-5,-3],[-2,-1],[1,0],[5,.2],[9,-.6],[12,-3],[13,-5]])line(ctx,[x,y,x+.2,y+1],p.base,.55);
    return;
  }
  if(a.beard==='goatee') {
    // Leave the cheeks and jawline exposed; a small pointed chin beard frames the lip.
    path(ctx,[.5,-1.9,3.3,-2,5.5,-1.5,9.4,-2.8,9.1,1,5.1,4.1,1.1,2.4],p.base,OUTLINE,.8);
    line(ctx,[3.1,.2,4.3,2.1],p.light,.65);
    line(ctx,[6.8,-.1,5.8,2.2],p.light,.65);
    return;
  }
  const full=a.beard==='full';
  ctx.beginPath();ctx.moveTo(-8,-9);ctx.lineTo(-4,-6);ctx.quadraticCurveTo(0,-7,4,-5);ctx.quadraticCurveTo(8,-6.7,13,-7.3);
  ctx.lineTo(14,full?-1.5:-2.7);ctx.quadraticCurveTo(11,full?5:1.5,4,full?6:2.6);ctx.lineTo(full?-2:-1,full?4.5:2);
  ctx.lineTo(-7,full?1:-2);ctx.closePath();ctx.fillStyle=p.base;ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=.9;ctx.stroke();
  // Mouth window preserves expression instead of painting a solid beard over it.
  ellipse(ctx,5,-3.5,5.8,1.8,SKIN_COLORS[a.skin].base);
  for(const [x,y] of [[-4,-3],[-2,0],[2,1],[6,1],[10,-.4]])line(ctx,[x,y,x+.6,y+(full?2:1)],p.light,.6);
}
function drawEyesAndExpression(ctx: CanvasRenderingContext2D, a: DetailedAppearance) {
  const skin=SKIN_COLORS[a.skin];
  const eyeH=a.eyes==='round'?2.45:a.eyes==='relaxed'?1.95:1.75;
  for(const [x,y,width] of [[-2.4,-13.7,4.35],[9,-13.6,3.05]]) {
    ctx.beginPath();ctx.moveTo(x-width,y-.4);ctx.quadraticCurveTo(x,y-eyeH-1,x+width,y-.2);ctx.quadraticCurveTo(x+width-.3,y+eyeH,x,y+eyeH);ctx.quadraticCurveTo(x-width,y+eyeH-.1,x-width,y-.4);
    ctx.fillStyle='#f6f1d9';ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=.8;ctx.stroke();
    ellipse(ctx,x+.8,y+.15,1.45,eyeH-.2,'#4e5b3f');
    ellipse(ctx,x+1.1,y+.1,.83,eyeH-.5,OUTLINE);
    ellipse(ctx,x+1.45,y-.65,.38,.44,'#fff6da');
  }
  const brows=HAIR_COLORS[a.hairColor].base;
  const browY=a.eyebrows==='angled'?-18:-17.8;
  line(ctx,[-6.3,browY,-2.2,-18.2,1.4,a.eyebrows==='angled'?-16.3:-17.3],brows,a.eyebrows==='thick'?2.2:1.7);
  line(ctx,[6.2,a.eyebrows==='angled'?-16.5:-17.5,9,-18,12.1,-17.2],brows,a.eyebrows==='thick'?1.9:1.45);
  // The bridge and a small protruding tip make facing legible without hiding the far eye.
  ctx.beginPath();ctx.moveTo(5,-13.4);
  if(a.faceShape==='round') {
    ctx.lineTo(5.1,-10);ctx.bezierCurveTo(10,-9,10,-6.3,6.8,-6.5);ctx.quadraticCurveTo(5.6,-6,4.6,-7.1);
  } else if(a.faceShape==='square') {
    ctx.lineTo(5.8,-9.1);ctx.lineTo(9.7,-8);ctx.lineTo(9.3,-6.1);ctx.lineTo(4.4,-6.5);
  } else {
    ctx.lineTo(5.5,-9.3);ctx.quadraticCurveTo(9.7,-7.5,8.3,-6.4);ctx.lineTo(4.8,-6.6);
  }
  ctx.fillStyle=skin.light;ctx.fill();ctx.strokeStyle=skin.seam;ctx.lineWidth=.8;ctx.stroke();
  if(a.moustache!=='none') {
    const moustache=HAIR_COLORS[a.moustacheColor];
    path(ctx,[.1,-6,4.3,-6.9,7.3,-6.1,10.6,-6.1,9.2,-4.6,4.2,-5.1,.3,-4.7],moustache.base,'');
    if(a.moustache==='handlebar') {
      ctx.beginPath();ctx.moveTo(4.2,-5.7);ctx.bezierCurveTo(1,-3.9,-3.2,-3.7,-3.5,-7.2);
      ctx.moveTo(6,-5.7);ctx.bezierCurveTo(10,-3.5,14.9,-4.2,14,-7.4);
      ctx.strokeStyle=moustache.base;ctx.lineWidth=2;ctx.stroke();
      line(ctx,[-2.4,-5.5,-1,-4.9],moustache.light,.55);
      line(ctx,[11,-4.9,12.4,-5.2],moustache.light,.55);
    }
  }
  if(a.mouth==='teeth') {
    box(ctx,.8,-3.5,9,3,1.1,'#f3e9cc',OUTLINE,.7);
    line(ctx,[3.8,-3.2,3.8,-1.1],skin.seam,.5);line(ctx,[6.9,-3.2,6.9,-1.1],skin.seam,.5);
  } else if(a.mouth==='smile') {
    ctx.beginPath();ctx.moveTo(1,-3.1);ctx.quadraticCurveTo(5.7,0,10,-3.4);ctx.strokeStyle=OUTLINE;ctx.lineWidth=1;ctx.stroke();
  } else {
    line(ctx,[1,-2.7,6,-2.5,10,-3.2],OUTLINE,.95);
  }
  if(a.beard==='none'||a.beard==='stubble')line(ctx,[3,-.5,7,-.5],skin.dark,.75);
}
function drawHeadgear(ctx: CanvasRenderingContext2D, a: DetailedAppearance) {
  if(a.headgear==='none')return;
  const p=clothingMaterial(a.headgearColor, 'headgear');
  if(a.headgear==='helmet') {
    ctx.beginPath();ctx.moveTo(-16,-18.4);ctx.quadraticCurveTo(-18,-27,-6,-27.1);ctx.quadraticCurveTo(11,-27.8,16,-21);ctx.lineTo(17,-17.9);ctx.quadraticCurveTo(2,-21,-16,-18.4);ctx.closePath();ctx.fillStyle=p.base;ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=1.4;ctx.stroke();
    path(ctx,[-14,-22,-12,-25,-8,-26.3,-8,-20],p.dark,'');
    path(ctx,[1,-27,4,-27,2.5,-20.4,-.8,-20.2],p.light,'');
    path(ctx,[-16.5,-19.9,-7,-21.1,5,-21.2,17.4,-18.7,19,-17.2,15,-17.2,4,-19,-8,-18.8,-16.7,-17.6],p.dark,OUTLINE,.95);
    line(ctx,[-11,-19.8,3,-20.1,12,-18.8],p.light,.8);
    box(ctx,-14,-23.7,4.3,2.6,.35,'#d4b96f',OUTLINE,.55);
    line(ctx,[-13.3,-17.3,-13.4,-5.5,-8.6,-.7],p.dark,1.5);
    box(ctx,-13.4,-6.2,2.5,2.6,.5,p.light,OUTLINE,.5);
  } else if(a.headgear==='cap') {
    ctx.beginPath();ctx.moveTo(-14,-18.5);ctx.quadraticCurveTo(-15,-26.5,-4,-26.9);ctx.quadraticCurveTo(9,-27.4,13,-21);ctx.lineTo(14,-18.8);ctx.closePath();ctx.fillStyle=p.base;ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=1.2;ctx.stroke();
    path(ctx,[-3,-26.7,1,-27,6,-20,-1,-20],p.light,'');
    path(ctx,[-12,-20.2,12,-20,20,-17.5,21,-15.6,16,-15.4,8,-18,-12,-18.3],p.dark,OUTLINE,1);
    line(ctx,[-9,-19.6,10,-19.4,18,-17],p.light,.8);
    path(ctx,[2,-23.7,5,-23.3,4.8,-21,2.2,-21.2],p.dark,'');
  } else {
    ctx.beginPath();ctx.moveTo(-15,-19);ctx.quadraticCurveTo(-21,-24,-11,-27);ctx.quadraticCurveTo(1,-28.5,14,-25);ctx.quadraticCurveTo(20,-22,14,-18.8);ctx.lineTo(-15,-19);ctx.closePath();ctx.fillStyle=p.base;ctx.fill();ctx.strokeStyle=OUTLINE;ctx.lineWidth=1.3;ctx.stroke();
    ctx.beginPath();ctx.moveTo(-14,-24);ctx.quadraticCurveTo(-6,-27,6,-26);ctx.strokeStyle=p.light;ctx.lineWidth=1.1;ctx.stroke();
    path(ctx,[-15,-20.3,13,-20.4,14,-18.3,-14,-18],p.dark,OUTLINE,.8);
    path(ctx,[8,-24.7,11.6,-23.8,10.8,-20.8,8.2,-21.3], '#ccb775',OUTLINE,.6);
    line(ctx,[-13,-19.1,-15,-14.5],p.dark,1.1);
  }
}
function drawEyewear(ctx: CanvasRenderingContext2D, a: DetailedAppearance) {
  if(a.eyewear==='none')return;
  const p=clothingMaterial(a.eyewearColor, 'eyewear');
  const fill=a.eyewear==='sunglasses'?'#273e3b':a.eyewear==='goggles'?'rgba(116,162,151,.5)':'rgba(174,202,178,.15)';
  line(ctx,[-11,-14.4,-7,-14.4],p.dark,1.2);
  box(ctx,-7.1,-16.4,9.2,6,1.8,fill,p.dark,a.eyewear==='goggles'?1.8:1.1);
  box(ctx,5.6,-16.1,7.2,5.6,1.6,fill,p.dark,a.eyewear==='goggles'?1.8:1.1);
  line(ctx,[2.2,-14.6,3.7,-15.1,5.7,-14.4],p.dark,1.2);
  line(ctx,[-5.5,-15.3,-3.9,-14.9],p.light,.7);
  line(ctx,[7,-15,8.3,-14.6],p.light,.7);
}
function drawHead(ctx: CanvasRenderingContext2D, rig: DetailedCharacterRig, a: DetailedAppearance, parts?: CharacterParts) {
  ctx.save();ctx.translate(rig.aim.headPivot.x,rig.aim.headPivot.y);ctx.rotate(rig.aim.headAngle);
  if (parts) parts.drawHead(ctx, a, buffer => drawHeadArtwork(buffer, a));
  else drawHeadArtwork(ctx, a);
  ctx.restore();
}
function drawHeadArtwork(ctx: CanvasRenderingContext2D, a: DetailedAppearance) {
  drawFaceShape(ctx,a);
  // Headwear masks only the hair it covers; the selected hairstyle is never modified.
  if(a.headgear==='none')drawHair(ctx,a);
  else {
    ctx.save();ctx.beginPath();ctx.rect(-24,-18.3,50,30);ctx.clip();drawHair(ctx,a);ctx.restore();
  }
  drawFacialHair(ctx,a);drawEyesAndExpression(ctx,a);drawHeadgear(ctx,a);drawEyewear(ctx,a);
}

function drawHand(ctx: CanvasRenderingContext2D, a: DetailedAppearance, trigger: boolean) {
  const skin=SKIN_COLORS[a.skin], glove=clothingMaterial(a.glovesColor, 'gloves');
  const fill=a.gloves==='full'?glove.base:skin.base;
  box(ctx,-2.6,-1.4,5.5,4.5,1.5,fill,OUTLINE,.9);
  if(a.gloves==='fingerless')box(ctx,-2.4,.1,5.1,3,1,glove.base,'',0);
  if(trigger) {
    // Thumb encircles the grip; the index finger rests at the trigger guard.
    path(ctx,[-1.7,-1,0,-2.7,3.2,-2.2,4.1,-1.2,3.7,-.4,.5,-.9,-.1,1],fill,OUTLINE,.6);
    line(ctx,[-1.2,1.2,1.7,1.8],a.gloves==='full'?glove.dark:skin.dark,.6);
  } else {
    path(ctx,[-2.5,-.3,-2.8,-2.7,-1.7,-3.4,-.6,-2.5,-.4,-.3],fill,OUTLINE,.6);
    for(const x of [-.5,1,2.2])line(ctx,[x,-.8,x,1.2],a.gloves==='full'?glove.dark:skin.dark,.55);
  }
}

function drawMagazine(ctx: CanvasRenderingContext2D, magazine: DetailedMagazineGeometry) {
  if (magazine.opacity <= 0) return;
  ctx.save();ctx.translate(magazine.center.x,magazine.center.y);ctx.rotate(magazine.angle);
  ctx.globalAlpha *= magazine.opacity;
  path(ctx,[-1.4,-2.85,2.6,-2.85,1.6,2.85,-2.2,2.35], '#48594a',OUTLINE,.85);
  if (!magazine.seated) {
    line(ctx,[-.8,-.8,-1.2,1.2,1,1.6,1.4,-.6], '#8b9c79',.65);
    if (magazine.fresh) line(ctx,[-1,-3.2,2,-3.2], '#d8b268',1.2);
  }
  ctx.restore();
}

function drawRifle(ctx: CanvasRenderingContext2D, rig: DetailedCharacterRig, a: DetailedAppearance) {
  ctx.save();ctx.translate(rig.rifle.pivot.x,rig.rifle.pivot.y);ctx.rotate(rig.rifle.angle);ctx.translate(-rig.rifle.recoil*2.2,0);
  // An original compact rifle: a brass sight, two grip locations, and a visible stock.
  path(ctx,[-12,-4,-4,-3,-2,0,-5,2,-12,2], '#626f59',OUTLINE,1.1);
  path(ctx,[-12,-4,-9,-4,-9,2,-12,2], '#344139',OUTLINE,.75);
  box(ctx,-3,-4.5,20,6.5,1,'#647361',OUTLINE,1.2);
  box(ctx,13,-3.5,10,4.4,.65,'#3b4d42',OUTLINE,.9);
  box(ctx,22,-1.2,5,2.4,.35,'#829081',OUTLINE,.75);
  box(ctx,26,-1.8,2,3.6,.4,'#35463a',OUTLINE,.7);
  path(ctx,[4,1.5,8,1.5,7.2,8,3.2,8], '#35463d',OUTLINE,.9);
  // The magazine is drawn separately, so its empty well remains visible during reload.
  if (!rig.magazine.seated) line(ctx,[9.7,2,14.2,2], '#172c24',1.7);
  box(ctx,2,-6.1,5.5,1.6,.3,'#303e34',OUTLINE,.55);
  line(ctx,[0,-3.1,10,-3.1], '#afbaa0',.95);
  box(ctx,6,-2.3,4,1.7,.3,'#283c32','',0);
  line(ctx,[14,-3.5,21,-3.5],'#263b30',1);
  box(ctx,19.5+rig.rifle.boltOffset,-2.9,2.5,1.2,.3,'#b8c3a3',OUTLINE,.45);
  line(ctx,[14.5,-2.8,14.5,.2,17,-2.8,17,.2,19.5,-2.8,19.5,.2], '#8e9a7c',.55);
  box(ctx,25,-5,1.4,3.2,.2,'#c9ae61',OUTLINE,.6);
  ctx.save();ctx.translate(DETAILED_RIFLE_ANCHORS.triggerGrip.x,DETAILED_RIFLE_ANCHORS.triggerGrip.y);
  drawHand(ctx,a,true);ctx.restore();
  if(rig.rifle.recoil>.1) {
    path(ctx,[28,-1.5,33,-1.5,38,-5.5,35,0,39,2.5,33,1.8,29,3.5], '#f4ca74','');
    path(ctx,[28,-.5,33,-.5,35,.5,29,2], '#fff1bf','');
  }
  ctx.restore();
}
function drawExhaust(ctx: CanvasRenderingContext2D, rig: DetailedCharacterRig, pose: CharacterPose) {
  if(!pose.thrusting && !(pose.thrustAmount && pose.thrustAmount>.05))return;
  const power=.65+.35*clamp01(pose.thrustAmount??1);
  rig.geometry.nozzles.forEach((nozzle,i)=>{
    const flutter=pose.reducedMotion?0:Math.sin((pose.time??0)*62+i*1.7)*2.5;
    const length=(16+flutter)*power;
    path(ctx,[nozzle.x-2.8,nozzle.y-.2,nozzle.x-1.4,nozzle.y+length*.6,nozzle.x,nozzle.y+length,nozzle.x+2.8,nozzle.y-.2], '#d79045','');
    path(ctx,[nozzle.x-1.7,nozzle.y,nozzle.x,nozzle.y+length*.74,nozzle.x+1.7,nozzle.y], '#f5cd76','');
    path(ctx,[nozzle.x-.7,nozzle.y,nozzle.x,nozzle.y+length*.4,nozzle.x+.7,nozzle.y], '#fff1c0','');
  });
}

/** Shared vector renderer. No assets are decoded or requested while drawing. */
export function drawDetailedCharacter(
  ctx: CanvasRenderingContext2D, x: number, y: number, scale: number,
  pose: CharacterPose, appearance: DetailedAppearance, _images: Record<string, HTMLImageElement> = {},
  parts?: CharacterParts,
): void {
  if (pose.hit) {
    drawCharacterHitFlash(ctx,x,y,scale,buffer =>
      drawDetailedCharacter(buffer,0,0,1,{ ...pose, hit: false },appearance,_images,parts));
    return;
  }
  const rig=calculateDetailedCharacterRig(pose);
  const moonwalk=pose.danceBeat!==undefined && pose.danceStyle==='moonwalk';
  if(pose.danceBeat!==undefined){
    const beat=pose.reducedMotion?0:pose.danceBeat*Math.PI*2;
    const body=rig.geometry.bodyOffset;
    const shoulder=(x:number)=>({x:body.x+x,y:body.y-45});
    if(moonwalk){
      rig.triggerArm=solveArm(shoulder(-8),{x:body.x-15-Math.sin(beat)*3,y:body.y-26},11.5);
      // Bend the far elbow away from the torso so the relaxed arm remains connected in silhouette.
      rig.supportArm=solveArm(shoulder(7),{x:body.x+17+Math.sin(beat)*3,y:body.y-26},12.5,-1);
    }else{
      rig.triggerArm=solveArm(shoulder(-8),{x:body.x-19+Math.sin(beat)*4,y:body.y-62-Math.cos(beat)*6},11.5);
      rig.supportArm=solveArm(shoulder(7),{x:body.x+22-Math.sin(beat)*5,y:body.y-64+Math.cos(beat)*6},14);
    }
    if(!pose.reducedMotion) for(const [index,leg] of [rig.geometry.nearLeg,rig.geometry.farLeg].entries()){
      const phase=beat/2+index*Math.PI;
      const lift=Math.max(0,Math.cos(phase));
      const ankle={x:(index===0?7:-8)+Math.sin(phase)*(moonwalk?10:12),y:-3-lift*(moonwalk?3:12)};
      const dx=ankle.x-leg.hip.x,dy=ankle.y-leg.hip.y,distance=Math.hypot(dx,dy)||1;
      const bend=Math.sqrt(Math.max(0,15*15-distance*distance/4));
      leg.knee={x:(leg.hip.x+ankle.x)/2+dy/distance*bend,y:(leg.hip.y+ankle.y)/2-dx/distance*bend};
      leg.ankle=ankle;
      leg.boot={...leg.boot,x:ankle.x-leg.boot.width/2+2,y:ankle.y-3};
      // The raised heel trades support with the flat, sliding foot.
      leg.bootAngle=moonwalk?lift*.45:-lift*.2;
    }
  }
  const facing=Math.cos(pose.aimAngle)>=0?1:-1;
  const waistY=rig.geometry.bodyOffset.y-rig.geometry.bodyBob-25;
  ctx.save();ctx.translate(x,y);ctx.scale(scale*facing,scale);ctx.lineCap='round';ctx.lineJoin='round';
  drawExhaust(ctx,rig,pose);
  drawLeg(ctx,rig.geometry.farLeg,appearance,false,waistY);
  drawArm(ctx,rig.supportArm,appearance,true);
  if(moonwalk){
    ctx.save();ctx.translate(rig.supportArm.hand.x,rig.supportArm.hand.y);
    drawHand(ctx,appearance,false);ctx.restore();
  }
  drawTorso(ctx,rig,appearance);
  drawLeg(ctx,rig.geometry.nearLeg,appearance,true,waistY);
  drawBelt(ctx,rig,appearance);
  drawHead(ctx,rig,appearance,parts);
  // Weapon grips need a foreground forearm. The moonwalk keeps the entire far arm behind the jacket.
  if(!moonwalk){
    const sleeve=clothingMaterial(appearance.topColor, 'top'), skin=SKIN_COLORS[appearance.skin];
    const supportWidth=(appearance.build==='slim'?4.6:appearance.build==='broad'?6.2:5.4);
    tube(ctx,rig.supportArm.elbow,rig.supportArm.hand,supportWidth-1,skin.dark);
    if(appearance.top!=='t-shirt')tube(ctx,rig.supportArm.elbow,lerpPoint(rig.supportArm.elbow,rig.supportArm.hand,.64),supportWidth,sleeve.dark);
  }
  const holdingWeapons=pose.danceBeat===undefined && !(pose.meleeProgress!==undefined && pose.meleeProgress>=0);
  if(rig.offhand && holdingWeapons){
    // Paint the far gun over the jacket so the second grip does not disappear inside it.
    drawHeldWeapon(ctx,rig.offhand,pose.reducedMotion??false);
    if(!rig.reload){
      ctx.save();ctx.translate(rig.supportArm.hand.x,rig.supportArm.hand.y);ctx.rotate(rig.supportHandAngle);
      drawHand(ctx,appearance,true);ctx.restore();
    }
  }
  drawArm(ctx,rig.triggerArm,appearance,false);
  if(holdingWeapons){
    if(rig.weaponId)drawHeldWeapon(ctx,{...rig.rifle,weaponId:rig.weaponId,magazine:rig.magazine},pose.reducedMotion??false);
    else {drawRifle(ctx,rig,appearance);drawMagazine(ctx,rig.magazine);}
  }
  if(!moonwalk && (!rig.offhand || !!rig.reload || !holdingWeapons)){
    ctx.save();ctx.translate(rig.supportArm.hand.x,rig.supportArm.hand.y);ctx.rotate(rig.supportHandAngle);
    drawHand(ctx,appearance,false);ctx.restore();
  }
  if(rig.weaponId && holdingWeapons){
    // The artwork path used to omit this hand entirely; fingers must wrap over the grip.
    ctx.save();ctx.translate(rig.triggerArm.hand.x,rig.triggerArm.hand.y);ctx.rotate(rig.triggerHandAngle);
    drawHand(ctx,appearance,(pose.offhandReloadProgress??-1)<0);ctx.restore();
  }
  ctx.restore();
}

function drawHeldWeapon(ctx:CanvasRenderingContext2D,weapon:HeldWeaponGeometry,reducedMotion:boolean):void{
  ctx.save();ctx.translate(weapon.pivot.x,weapon.pivot.y);ctx.rotate(weapon.angle);ctx.translate(-weapon.recoil*2.2,0);
  drawWeaponArtwork(ctx,weapon.weaponId,{magazine:false,recoil:weapon.recoil,flash:!reducedMotion});ctx.restore();
  ctx.save();ctx.translate(weapon.magazine.center.x,weapon.magazine.center.y);ctx.rotate(weapon.magazine.angle);
  drawWeaponMagazine(ctx,weapon.weaponId,weapon.magazine.opacity);ctx.restore();
}

/** The same equipped pilot artwork dances unarmed; beat is expressed in musical cycles. */
export function drawDancingCharacter(ctx:CanvasRenderingContext2D,x:number,y:number,scale:number,appearance:DetailedAppearance,beat:number,reducedMotion:boolean,style:'moonwalk'|'bhangra'='bhangra'):void{
  const cycle=reducedMotion?0:beat*Math.PI*2;
  const moonwalk=style==='moonwalk';
  const glide=reducedMotion?0:Math.cos(cycle/8)*13;
  const hop=reducedMotion||moonwalk?0:-Math.max(0,Math.sin(cycle))*5;
  drawDetailedCharacter(ctx,x+(moonwalk?glide:Math.sin(cycle/2)*2)*scale,y+hop*scale,scale,
    {aimAngle:moonwalk&&Math.sin(cycle/8)<0?Math.PI:.05,danceBeat:beat,danceStyle:style,reducedMotion,
      crouchAmount:reducedMotion?.1:moonwalk?.08:.14+(1-Math.cos(cycle))*.15,
      locomotion:true,walkAmount:0,airborneAmount:0,thrustAmount:0},appearance);
}

export type CharacterFragmentKind='head'|'torso'|'farArm'|'nearArm'|'farLeg'|'nearLeg'|'upperBody'|'legs';
export function getCharacterFragmentAnchors(pose:CharacterPose):Record<CharacterFragmentKind,Vec2>{
  const rig=calculateDetailedCharacterRig(pose);
  const middle=(a:Vec2,b:Vec2)=>lerpPoint(a,b,.5);
  const torso={x:rig.aim.torsoPivot.x,y:rig.aim.torsoPivot.y-9};
  const farLeg=middle(rig.geometry.farLeg.hip,rig.geometry.farLeg.ankle),nearLeg=middle(rig.geometry.nearLeg.hip,rig.geometry.nearLeg.ankle);
  return {head:{x:rig.aim.headPivot.x,y:rig.aim.headPivot.y-13},torso,upperBody:torso,legs:middle(farLeg,nearLeg),
    farArm:middle(rig.supportArm.shoulder,rig.supportArm.hand),nearArm:middle(rig.triggerArm.shoulder,rig.triggerArm.hand),
    farLeg,nearLeg};
}

/** Grouped low-detail pieces retain every dressed limb instead of omitting small parts. */
export function drawCharacterFragment(ctx:CanvasRenderingContext2D,kind:CharacterFragmentKind,pose:CharacterPose,appearance:DetailedAppearance,parts?:CharacterParts):void{
  const rig=calculateDetailedCharacterRig(pose),anchor=getCharacterFragmentAnchors(pose);
  const center=anchor[kind],waistY=rig.geometry.bodyOffset.y-rig.geometry.bodyBob-25;
  ctx.save();ctx.translate(-center.x,-center.y);ctx.lineCap='round';ctx.lineJoin='round';
  if(kind==='head')drawHead(ctx,rig,appearance,parts);
  else if(kind==='torso'){drawTorso(ctx,rig,appearance);drawBelt(ctx,rig,appearance);}
  else if(kind==='upperBody'){
    drawArm(ctx,rig.supportArm,appearance,true);
    drawTorso(ctx,rig,appearance);drawBelt(ctx,rig,appearance);
    drawArm(ctx,rig.triggerArm,appearance,false);
    ctx.save();ctx.translate(rig.supportArm.hand.x,rig.supportArm.hand.y);ctx.rotate(rig.supportHandAngle);
    drawHand(ctx,appearance,false);ctx.restore();
  }
  else if(kind==='legs'){
    drawLeg(ctx,rig.geometry.farLeg,appearance,false,waistY);
    drawLeg(ctx,rig.geometry.nearLeg,appearance,true,waistY);
  }
  else if(kind==='farArm')drawArm(ctx,rig.supportArm,appearance,true);
  else if(kind==='nearArm')drawArm(ctx,rig.triggerArm,appearance,false);
  else drawLeg(ctx,kind==='farLeg'?rig.geometry.farLeg:rig.geometry.nearLeg,appearance,kind==='nearLeg',waistY);
  ctx.restore();
}
