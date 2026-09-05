import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Deterministic original-vector artwork review. Requires the Vite development server.
// Each catalog choice is rendered in isolation, at detail and actual gameplay scale.
const baseURL = process.env.BURNHOP_DEV_URL ?? 'http://127.0.0.1:5173';
const directory = 'docs/screenshots';
const browser = await chromium.launch();
try {
  await mkdir(directory, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // A same-origin empty review page avoids starting the game or modifying saved settings.
  await page.route('**/catalog-art-review', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto(`${baseURL}/catalog-art-review`);
  const result = await page.evaluate(async () => {
    const { drawDetailedCharacter, calculateDetailedCharacterRig } = await import('/src/game/detailedCharacter.ts');
    const { APPEARANCE_PARTS, BASE_APPEARANCE, CHARACTER_LOOKS } = await import('/src/game/appearance.ts');
    const { CHARACTER_SCALE } = await import('/src/game/stance.ts');
    const style = document.createElement('style');
    style.textContent = 'body{margin:0;padding:24px;background:#101f1b;color:#e6e1c8;font:16px system-ui}section{margin:0 0 28px}h1{font-size:24px}h2{font-size:19px;margin:26px 0 12px;color:#c1bc92}.row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.tile{border:1px solid #4c5a41;border-radius:8px;padding:8px;background:#203228;text-align:center;overflow:hidden}.tile p{margin:8px 0;color:#e1dcbe}.tile canvas{display:block;margin:auto;max-width:100%}.native{border-top:1px solid #4c5a41;margin-top:5px!important}';
    document.head.append(style);
    const neutral = { aimAngle: 0, crouchAmount: 0, reducedMotion: true, time: 0, locomotion: true };
    const signatures = {};
    const tile = (row, label, appearance, focus = 'body', pose = neutral) => {
      const article = document.createElement('article'); article.className = 'tile';
      const title = document.createElement('p'); title.textContent = label; article.append(title);
      const canvas = document.createElement('canvas');canvas.width=200;canvas.height=208;article.append(canvas);
      const context = canvas.getContext('2d');
      if (focus === 'head') {
        const rig=calculateDetailedCharacterRig(pose),scale=4.2;
        drawDetailedCharacter(context,100-rig.aim.headPivot.x*scale,156-rig.aim.headPivot.y*scale,scale,pose,appearance);
      } else if (focus === 'boots') drawDetailedCharacter(context,100,180,6,pose,appearance);
      else drawDetailedCharacter(context,100,195,1.94,pose,appearance);
      const native=document.createElement('canvas');native.className='native';native.width=100;native.height=94;article.append(native);
      drawDetailedCharacter(native.getContext('2d'),50,78,CHARACTER_SCALE,pose,appearance);
      row.append(article);
      return canvas.toDataURL();
    };
    const section = (id, label) => {
      const element=document.createElement('section');element.id=id;
      const heading=document.createElement('h1');heading.textContent=label;element.append(heading);document.body.append(element);return element;
    };
    for (const group of ['Face','Hair','Clothing','Equipment']) {
      const groupElement=section(group.toLowerCase(),`${group} · enlarged detail / gameplay scale`);
      for (const part of APPEARANCE_PARTS.filter(part=>part.group===group)) {
        const heading=document.createElement('h2');heading.textContent=part.label;groupElement.append(heading);
        const row=document.createElement('div');row.className='row';groupElement.append(row);
        signatures[part.id]=part.options.map(option=>tile(row,option.label,{...BASE_APPEARANCE,sideburns:'none',[part.id]:option.id},part.previewFocus));
      }
    }
    const combos=section('overlaps','Headgear / hair / facial hair / eyewear overlaps');
    const row=document.createElement('div');row.className='row';combos.append(row);
    for(const look of CHARACTER_LOOKS.slice(1)) {
      for(const hair of ['buzz','spiky','tied-back']) tile(row,`${look.name} · ${hair}`,{...look.appearance,hair,moustache:'handlebar'},'head');
      for(const eyewear of ['glasses','sunglasses','goggles']) tile(row,`${look.name} · ${eyewear}`,{...look.appearance,hair:'tied-back',eyewear},'head');
    }
    const poses=section('poses','Three builds · crouch / full vertical aim / both facings / jet / recoil');
    const poseRow=document.createElement('div');poseRow.className='row';poses.append(poseRow);
    for(const look of CHARACTER_LOOKS.slice(1)) {
      for(const [label,pose] of [
        ['Crouch left',{aimAngle:Math.PI,crouchAmount:1}], ['Crouch up',{aimAngle:-Math.PI/2,crouchAmount:1}],
        ['Crouch down left',{aimAngle:Math.PI/2+.0001,crouchAmount:1}], ['Jet left',{aimAngle:Math.PI,thrusting:true,thrustAmount:1,airborneAmount:1}],
        ['Walk recoil',{aimAngle:.5,recoil:1,walkAmount:1,walkPhase:1.2,moveSpeed:320}], ['Hit feedback',{aimAngle:0,hit:true}],
      ]) tile(poseRow,`${look.name} · ${label}`,{...look.appearance,hair:'tied-back',eyewear:'glasses'},'body',{...neutral,...pose});
    }
    // Detect missing style branches: isolated choices must produce different actual pixels.
    return Object.entries(signatures).map(([id,images])=>({id,choices:images.length,distinct:new Set(images).size}));
  });
  for(const part of result) expect(part.distinct, `Distinct rendered options for ${part.id}`).toBe(part.choices);
  for(const id of ['face','hair','clothing','equipment','overlaps','poses']) {
    await page.locator(`#${id}`).screenshot({ path: `${directory}/46-catalog-${id}.png` });
  }
  expect(errors).toEqual([]);
  console.log(`Catalog artwork review passed: ${result.reduce((total,part)=>total+part.choices,0)} individually rendered choices across ${result.length} parts, every style has distinct pixels, 18 headgear overlaps, 18 build/pose combinations, enlarged + gameplay scale. Zero browser errors.`);
} finally { await browser.close(); }
