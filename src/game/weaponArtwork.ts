import type { WeaponId, Vec2 } from './types';

type Shape = { points: readonly number[]; color: string };
interface WeaponArtwork { shapes: readonly Shape[]; trigger: Vec2; support: Vec2; muzzle: Vec2; magazine: Vec2; }
const steel = '#5e706c', dark = '#2b3734', light = '#aab9a7', wood = '#a77549', sand = '#a49b79';
const shape = (color: string, ...points: number[]): Shape => ({ color, points });

/** All seven drawings share material values and outline weight; lengths match combat muzzles. */
export const WEAPON_ARTWORK: Readonly<Record<WeaponId, WeaponArtwork>> = {
  pistol: { trigger: {x:5,y:4}, support:{x:8,y:5}, muzzle:{x:17,y:0}, magazine:{x:4,y:8}, shapes:[
    shape(dark,0,-4,14,-4,17,-2,17,2,8,2,5,12,-1,11,2,2,-2,2,-2,-2),
    shape(steel,-1,-4,14,-4,16,-2,16,0,-1,0), shape(light,1,-5,3,-5,3,-4,1,-4),
    shape(dark,12,-6,14,-6,14,-4,12,-4), shape('#778079',0,4,5,4,3,9,-1,9),
  ]},
  revolver: { trigger:{x:5,y:5}, support:{x:8,y:5}, muzzle:{x:21,y:0}, magazine:{x:5,y:0}, shapes:[
    shape(steel,0,-4,9,-4,11,-2,21,-2,21,1,11,1,9,4,5,5,3,12,-3,11,0,4,-3,2,-3,-2),
    shape(wood,0,4,5,5,3,12,-3,11,-2,8), shape(light,10,-4,20,-4,20,-2,10,-2),
    shape(dark,-2,-6,0,-6,2,-3,-2,-3), shape(dark,2,-3,8,-3,8,3,2,3),
  ]},
  ak47: { trigger:{x:5,y:4}, support:{x:17,y:2}, muzzle:{x:35,y:0}, magazine:{x:11,y:5}, shapes:[
    shape(wood,-15,-2,-4,-2,1,0,-2,4,-15,8,-17,6),
    shape(steel,-4,-4,16,-4,20,-2,28,-2,28,2,13,3,9,7,2,6,0,2,-4,2),
    shape(wood,17,-3,25,-3,26,1,18,2), shape(dark,26,-1,35,-1,35,1,26,1),
    shape(dark,3,3,7,4,5,12,1,10), shape(dark,28,-7,30,-7,31,0,28,0),
    shape(light,-3,-5,11,-5,12,-3,-3,-3), shape(dark,16,-5,26,-5,27,-3,16,-3),
  ]},
  m416: { trigger:{x:5,y:4}, support:{x:17,y:2}, muzzle:{x:34,y:0}, magazine:{x:11,y:5}, shapes:[
    shape(dark,-16,-4,-8,-4,-8,-1,-1,-1,-1,3,-9,3,-14,7,-17,6),
    shape(steel,-2,-4,14,-4,15,-2,27,-2,27,2,14,2,12,5,2,5,-1,2),
    shape(sand,15,-4,27,-4,27,2,16,3), shape(dark,27,-1,34,-1,34,1,27,1),
    shape(dark,3,4,7,4,6,12,2,11), shape(light,-2,-6,26,-6,26,-4,-2,-4),
    shape(dark,4,-9,10,-9,11,-6,3,-6), shape(dark,29,-5,31,-5,31,0,29,0),
  ]},
  uzi: { trigger:{x:5,y:4}, support:{x:15,y:2}, muzzle:{x:22,y:0}, magazine:{x:5,y:7}, shapes:[
    shape(dark,-10,-2,-2,-2,-2,1,-9,1,-9,5,-12,5,-12,0),
    shape(steel,-2,-5,15,-5,17,-2,18,2,9,3,7,8,2,8,2,2,-2,2),
    shape(dark,17,-2,22,-2,22,1,17,1), shape(light,2,-6,12,-6,12,-4,2,-4),
    shape(dark,5,-8,8,-8,8,-5,5,-5), shape(dark,13,-7,15,-7,15,-4,13,-4),
    shape('#7a8980',10,-1,15,-1,15,2,9,2),
  ]},
  ump: { trigger:{x:5,y:4}, support:{x:17,y:2}, muzzle:{x:29,y:0}, magazine:{x:12,y:5}, shapes:[
    shape(dark,-15,-3,-3,-3,-1,0,-4,3,-13,6,-15,5,-15,2,-8,1,-7,-1,-15,-1),
    shape('#667971',-3,-4,24,-4,25,-2,25,2,13,3,10,6,1,5,-2,2),
    shape(dark,25,-1,29,-1,29,1,25,1), shape(dark,2,4,7,5,5,12,1,10),
    shape(light,0,-6,22,-6,22,-4,0,-4), shape(dark,4,-8,10,-8,10,-6,4,-6),
    shape(dark,15,-2,22,-2,22,0,15,0),
  ]},
  sniper: { trigger:{x:5,y:4}, support:{x:17,y:2}, muzzle:{x:43,y:0}, magazine:{x:10,y:5}, shapes:[
    shape('#7d8967',-18,-3,-5,-3,0,-1,27,-1,27,3,13,4,9,7,3,6,-1,2,-7,3,-16,8,-19,7),
    shape(steel,-2,-4,21,-4,23,-2,35,-2,35,0,11,1,-2,1),
    shape(dark,30,-1,43,-1,43,1,30,1), shape(dark,1,-11,17,-11,19,-9,17,-7,1,-7,-1,-9),
    shape(light,0,-12,3,-12,3,-6,0,-6), shape(dark,15,-12,20,-12,20,-6,15,-6),
    shape(dark,4,-7,6,-7,6,-3,4,-3), shape(dark,13,-7,15,-7,15,-3,13,-3),
  ]},
};

export const WEAPON_SILHOUETTES = Object.fromEntries(Object.entries(WEAPON_ARTWORK).map(([id, art]) =>
  [id, art.shapes.map(s => `M${s.points[0]} ${s.points[1]}${s.points.slice(2).reduce((p,n,i) => p + (i % 2 === 0 ? `L${n}` : ` ${n}`), '')}Z`).join(' ')])) as Record<WeaponId,string>;

function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.beginPath(); ctx.moveTo(s.points[0],s.points[1]);
  for(let i=2;i<s.points.length;i+=2)ctx.lineTo(s.points[i],s.points[i+1]);
  ctx.closePath(); ctx.fillStyle=s.color; ctx.fill(); ctx.strokeStyle='#26342e'; ctx.lineWidth=1.05; ctx.stroke();
}

export function drawWeaponMagazine(ctx: CanvasRenderingContext2D, id: WeaponId, opacity = 1): void {
  if(opacity<=0)return;
  ctx.save();ctx.globalAlpha*=opacity;
  if(id==='revolver') {
    ctx.fillStyle='#6e8178';ctx.strokeStyle='#26342e';ctx.lineWidth=.8;
    ctx.beginPath();ctx.ellipse(0,0,4,3.6,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    for(const y of [-1.5,1.5]){ctx.fillStyle='#2b3734';ctx.fillRect(-2.4,y-.35,4.8,.7);}
  } else {
    const curved=id==='ak47', short=id==='sniper'||id==='pistol', pistol=id==='pistol';
    drawShape(ctx,shape(id==='ak47'?'#977044':'#455650',-2,-1,3,-1,curved?4:3,short?3:9,curved?2:0,short?5:11,-3,short?3:9));
    ctx.strokeStyle='#92a096';ctx.lineWidth=.65;
    if(!pistol)for(const y of [2,5,8]){ctx.beginPath();ctx.moveTo(-1.5,y);ctx.lineTo(2,y);ctx.stroke();}
  }
  ctx.restore();
}

/** Paint at the authoritative weapon pivot in facing-right artwork coordinates. */
export function drawWeaponArtwork(ctx:CanvasRenderingContext2D,id:WeaponId,options:{magazine?:boolean;recoil?:number;flash?:boolean}={}):void{
  const art=WEAPON_ARTWORK[id];ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
  for(const s of art.shapes)drawShape(ctx,s);
  if(options.magazine!==false){ctx.save();ctx.translate(art.magazine.x,art.magazine.y);drawWeaponMagazine(ctx,id);ctx.restore();}
  // A small slide/bolt travel identifies firing without changing the gameplay ray.
  const recoil=Math.max(0,Math.min(1,options.recoil??0));
  if(id==='pistol'){ctx.fillStyle='#b9c1ae';ctx.fillRect(5-recoil*2,-3,4,1);}
  else if(id==='sniper'){ctx.strokeStyle='#b9c1ae';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(8-recoil*2,-2);ctx.lineTo(9-recoil*2,3);ctx.stroke();}
  else {ctx.fillStyle='#aab9a7';ctx.fillRect(8-recoil*2,-2,3,1);}
  if(options.flash && recoil>.55){
    drawShape(ctx,shape('#ffe9a4',art.muzzle.x,0,art.muzzle.x+5,-3,art.muzzle.x+3,-.8,art.muzzle.x+9,0,art.muzzle.x+3,1,art.muzzle.x+5,3));
  }
  ctx.restore();
}
