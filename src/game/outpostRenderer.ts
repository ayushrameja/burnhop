import type { Arena, TerrainPolygon, Vec2 } from './types';

const noise = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function path(ctx: CanvasRenderingContext2D, points: readonly Vec2[]) {
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}
function shape(ctx: CanvasRenderingContext2D, points: number[][], color: string) {
  path(ctx, points.map(([x, y]) => ({ x, y }))); ctx.fillStyle = color; ctx.fill();
}
function stroke(ctx: CanvasRenderingContext2D, x: number, y: number, xx: number, yy: number, color: string, width = 2) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xx, yy); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

type Surface = { terrain: TerrainPolygon; index: number; x: number; y: number; width: number; height: number; canvas: HTMLCanvasElement | null; resolution: number; used: number };
const TEXTURE_BUDGET = 128 * 1024 * 1024;

/** Original Canvas artwork. The exact same contour data drives art and physics.
 * Bake static rock detail once; the frame loop only composites visible islands.
 */
export class OutpostScenery {
  private surfaces: Surface[];
  private frame = 0;
  constructor(private arena: Arena) {
    this.surfaces = (arena.terrain ?? []).map((terrain, index) => {
      const xs = terrain.points.map(p => p.x), ys = terrain.points.map(p => p.y);
      const x = Math.floor(Math.min(...xs)) - 12, y = Math.floor(Math.min(...ys)) - 18;
      return { terrain, index, x, y, width: Math.ceil(Math.max(...xs)) - x + 12, height: Math.ceil(Math.max(...ys)) - y + 12, canvas: null, resolution: 0, used: 0 };
    });
  }

  destroy() { for (const surface of this.surfaces) this.release(surface); }

  private release(surface: Surface) {
    if (surface.canvas) { surface.canvas.width = 0; surface.canvas.height = 0; }
    surface.canvas = null; surface.resolution = 0;
  }

  /** Only visible islands need high-resolution bitmaps. Zoom and display density
   * affect raster quality, never world coordinates or collision geometry. */
  private visibleSurfaces(ctx: CanvasRenderingContext2D, camera: Vec2, viewport: Vec2) {
    const visible = this.surfaces.filter(s => s.x + s.width >= camera.x && s.x <= camera.x + viewport.x && s.y + s.height >= camera.y && s.y <= camera.y + viewport.y);
    const transform = ctx.getTransform();
    let resolution = Math.min(3, Math.max(1, Math.ceil(Math.hypot(transform.a, transform.b))));
    const area = visible.reduce((sum, s) => sum + s.width * s.height, 0);
    while (resolution > 1 && area * resolution * resolution * 4 > TEXTURE_BUDGET) resolution--;
    this.frame++;
    for (const s of visible) {
      if (s.canvas && s.resolution !== resolution) this.release(s);
      s.used = this.frame;
    }
    let bytes = this.surfaces.reduce((sum, s) => sum + (s.canvas?.width ?? 0) * (s.canvas?.height ?? 0) * 4, 0);
    const needed = visible.filter(s => !s.canvas).reduce((sum, s) => sum + s.width * s.height * resolution * resolution * 4, 0);
    for (const s of this.surfaces.filter(s => s.canvas && s.used !== this.frame).sort((a, b) => a.used - b.used)) {
      if (bytes + needed <= TEXTURE_BUDGET) break;
      bytes -= s.canvas!.width * s.canvas!.height * 4; this.release(s);
    }
    for (const s of visible) if (!s.canvas) { s.canvas = this.bake(s, resolution); s.resolution = resolution; }
    return visible;
  }

  /** Populate the same bounded cache before gameplay without painting the playfield. */
  warm(ctx: CanvasRenderingContext2D, camera: Vec2, viewport: Vec2): void {
    this.visibleSurfaces(ctx, camera, viewport);
  }

  background(ctx: CanvasRenderingContext2D, camera: Vec2) {
    const sky = ctx.createLinearGradient(0, 0, 0, 720);
    sky.addColorStop(0, '#a6c1b7'); sky.addColorStop(.6, '#c0cdb5'); sky.addColorStop(1, '#d8d7b6');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#eef0cf70'; ctx.beginPath(); ctx.arc(990 - camera.x * .025, 116 - camera.y * .02, 38, 0, Math.PI * 2); ctx.fill();
    for (let layer = 0; layer < 3; layer++) {
      const offset = camera.x * (.035 + layer * .04), base = 420 + layer * 105 - camera.y * .025;
      const points = [[-500, 800], [-500, base]];
      for (let i = -3; i <= 12; i++) points.push([i * 210 - offset, base - noise(i + layer * 21) * (110 - layer * 18)]);
      points.push([2600, 800]); shape(ctx, points, ['#93ab9828', '#829b8330', '#7e967f26'][layer]);
    }
    ctx.fillStyle = '#f0edce45';
    for (let i = 0; i < 6; i++) {
      const x = i * 300 - camera.x * .045 - 100, y = 100 + noise(i) * 190;
      ctx.beginPath(); ctx.ellipse(x, y, 90 + noise(i + 5) * 80, 4, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Vec2, viewport: Vec2) {
    // Dark, low-contrast rock columns belong to the backdrop; openings stay clear.
    ctx.save(); ctx.translate(0, 180); ctx.scale(1.4, 1.4);
    const backs = [
      [[278,504],[332,498],[302,620],[304,718],[336,792],[192,800],[250,750],[278,620]],
      [[692,564],[770,562],[764,656],[722,774],[660,788],[696,660]],
      [[956,394],[984,426],[978,470],[1064,582],[1104,596],[1088,646],[1008,660],[962,594],[930,498],[916,450]],
      [[1240,398],[1298,420],[1314,500],[1280,546],[1206,538],[1238,472]],
      [[978,660],[1058,632],[1120,702],[1100,774],[1054,800],[1014,870],[916,914],[736,930],[632,960],[516,1004],[448,960],[480,896],[642,844],[898,844]],
      [[1098,644],[1226,650],[1340,738],[1470,800],[1566,832],[1576,888],[1696,810],[1744,864],[1712,1116],[1564,1084],[1474,1010],[1312,958],[1192,958],[1088,968],[1010,932]],
      [[1628,636],[1780,612],[1886,692],[1802,802],[1694,810],[1592,824],[1482,798],[1552,730]],
      [[2264,320],[2340,330],[2394,374],[2470,406],[2574,456],[2684,470],[2730,422],[2770,334],[2812,354],[2778,484],[2654,510],[2580,494],[2452,506],[2324,542],[2282,464]],
      [[2336,638],[2410,632],[2440,740],[2460,794],[2364,802],[2300,782]],
      [[2450,628],[2486,566],[2528,560],[2528,670],[2496,700]],
      [[2762,318],[2828,322],[2876,368],[2906,408],[2998,430],[3022,464],[2968,484],[2878,430],[2824,408]],
    ];
    for (const [i, points] of backs.entries()) {
      shape(ctx, points, '#69735d');
      ctx.strokeStyle = '#58644f'; ctx.lineWidth = 2; ctx.stroke();
      // Faint fractures keep background columns distinct from the bright landing rims.
      const [x, y] = points[0]; stroke(ctx, x + 15, y + 20, x + 27 + noise(i) * 15, y + 54, '#8d947246', 2);
    }
    this.bunker(ctx, false); this.bunker(ctx, true);
    this.palm(ctx, 1660, 476, 118, .05);
    this.palm(ctx, 292, 799, 90, -.18);
    this.palm(ctx, 2640, 799, 79, .15);
    this.shrub(ctx, 1146, 544, 31); this.shrub(ctx, 2580, 800, 27);
    ctx.restore();
    for (const surface of this.visibleSurfaces(ctx, camera, viewport)) {
      ctx.drawImage(surface.canvas!, surface.x, surface.y, surface.width, surface.height);
    }
    // Bunker fascia and windows are decoration behind their collidable roof/floor.
    ctx.save(); ctx.translate(0, 180); ctx.scale(1.4, 1.4);
    this.bunkerTrim(ctx, false); this.bunkerTrim(ctx, true);
    ctx.restore();
  }

  private bake(surface: Surface, resolution: number) {
    const { terrain, index, x, y, width, height } = surface;
    const canvas = document.createElement('canvas'); canvas.width = width * resolution; canvas.height = height * resolution;
    const ctx = canvas.getContext('2d')!; ctx.scale(resolution, resolution); ctx.translate(-x, -y); ctx.lineJoin = 'round';
    const rock = terrain.material === 'rock';
    const fill = ctx.createLinearGradient(0, y, 0, y + height);
    fill.addColorStop(0, rock ? '#98947c' : terrain.material === 'wood' ? '#ac996b' : '#a3a79c');
    fill.addColorStop(1, rock ? '#737768' : terrain.material === 'wood' ? '#706047' : '#7c847d');
    path(ctx, terrain.points); ctx.fillStyle = fill; ctx.fill();
    ctx.save(); ctx.clip();
    if (rock) {
      this.rockTexture(ctx, x, y, width, height, index);
    } else {
      if (terrain.material === 'wood') this.woodTexture(ctx, x, y, width, height, index);
      else this.concreteTexture(ctx, x, y, width, height, index);
    }
    // Shallow edge weathering gives thickness without adding false footholds.
    path(ctx, terrain.points); ctx.strokeStyle = rock ? '#3b503328' : '#38423735'; ctx.lineWidth = 13; ctx.stroke();
    path(ctx, terrain.points); ctx.strokeStyle = '#ddd3ad35'; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
    path(ctx, terrain.points); ctx.strokeStyle = '#3e483a'; ctx.lineWidth = 3; ctx.stroke();
    const winding = Math.sign(terrain.points.reduce((sum, a, i) => { const b = terrain.points[(i + 1) % terrain.points.length]; return sum + a.x * b.y - b.x * a.y; }, 0));
    for (let i = 0; i < terrain.points.length; i++) {
      const a = terrain.points[i], b = terrain.points[(i + 1) % terrain.points.length];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const nx = dy / length * winding, ny = -dx / length * winding;
      const grass = rock && terrain.grass && ny < -.52;
      if (grass) {
        stroke(ctx, a.x, a.y, b.x, b.y, '#465a35', 10);
        stroke(ctx, a.x, a.y - 1.5, b.x, b.y - 1.5, '#a7b777', 5);
        for (let d = 10; d < length - 8; d += 19) {
          const t = d / length, xx = a.x + dx * t, yy = a.y + dy * t, n = noise(d + index * 7);
          shape(ctx, [[xx-5,yy+1],[xx-7,yy-5-n*4],[xx,yy-2],[xx+3,yy-9-n*3],[xx+5,yy],[xx+9,yy-4]], '#96a66b');
        }
      } else if (rock) {
        // Border stones sit inside the contour; none suggests invisible footholds.
        for (let d = 15; d < length - 8; d += 25) {
          const t = d / length, n = noise(d + i * 13), size = 6 + n * 5;
          const xx = a.x + dx * t - nx * 8, yy = a.y + dy * t - ny * 8;
          ctx.save(); path(ctx, terrain.points); ctx.clip();
          shape(ctx, [[xx-size,yy-3],[xx-3,yy-size],[xx+size-2,yy-size+2],[xx+size,yy+3],[xx+2,yy+size],[xx-size,yy+4]], n > .4 ? '#b4b39c' : '#a2a38c');
          ctx.strokeStyle = '#4a5544'; ctx.lineWidth = 1.3; ctx.stroke();
          shape(ctx, [[xx-size+1,yy-3],[xx-3,yy-size+1],[xx+size-3,yy-size+3],[xx,yy-1]], '#e0d7b74b');
          stroke(ctx, xx-1, yy+size-1, xx+size-1, yy+3, '#394c3c60', 1);
          ctx.restore();
        }
      }
    }
    // The bunker sills are part of the supporting island artwork. Baking their
    // material detail here keeps fine grain out of the animation/frame loop.
    if (terrain.id === 'west-island' || terrain.id === 'east-base') {
      ctx.save(); path(ctx, terrain.points); ctx.clip(); ctx.translate(0, 180); ctx.scale(1.4, 1.4);
      if (terrain.id === 'east-base') {
        shape(ctx, [[2818,686],[2878,666],[2950,706],[3004,706],[3078,666],[3136,686],[3136,736],[2818,736]], '#94845b');
        ctx.clip(); this.woodTexture(ctx, 2818, 664, 318, 74, 21);
      } else {
        ctx.beginPath(); ctx.rect(322, 386, 314, 36); ctx.fillStyle = '#90978a'; ctx.fill(); ctx.clip();
        this.concreteTexture(ctx, 322, 386, 314, 36, 22);
      }
      ctx.restore();
    }
    return canvas;
  }

  private grain(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, seed: number, spacing = 95) {
    for (let i = 0; i < width * height / spacing; i++) {
      const xx = x + noise(i + seed * 227) * width, yy = y + noise(i + seed * 173 + 67) * height;
      const size = .35 + noise(i + 99) * 1.15;
      ctx.fillStyle = i % 3 ? '#263d3022' : '#ece0b936'; ctx.fillRect(xx, yy, size, size * .65);
    }
  }

  private rockTexture(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, seed: number) {
    for (let i = 0; i < width * height / 11000; i++) {
      const xx = x + noise(i + seed * 47) * width, yy = y + noise(i + seed * 31 + 33) * height;
      const size = 35 + noise(i + 18) * 80;
      shape(ctx, [[xx,yy],[xx+size*.5,yy-size*.18],[xx+size,yy+size*.08],[xx+size*.8,yy+size*.6],[xx+size*.15,yy+size*.7]], i % 2 ? '#ddc99a13' : '#425b4818');
      // Interrupted mineral seams remain subtler than the terrain boundary.
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + size*.4, yy - 4); ctx.lineTo(xx + size*.64, yy + 2);
      ctx.strokeStyle = '#40523c29'; ctx.lineWidth = .8; ctx.stroke();
    }
    this.grain(ctx, x, y, width, height, seed);
    for (let i = 0; i < width * height / 2700; i++) {
      const xx = x + noise(i + seed * 213) * width, yy = y + noise(i + seed * 213 + 31) * height;
      const size = 3 + noise(i + 66) * 12;
      shape(ctx, [[xx,yy],[xx+size*.7,yy-size*.2],[xx+size,yy+size*.6],[xx+size*.4,yy+size],[xx-size*.2,yy+size*.4]], i % 4 ? '#b4b09a8c' : '#5e6b5466');
      ctx.strokeStyle = '#495a4438'; ctx.lineWidth = .8; ctx.stroke();
      shape(ctx, [[xx,yy],[xx+size*.7,yy-size*.2],[xx+size*.55,yy+size*.35],[xx-size*.2,yy+size*.4]], '#e3d4ab45');
      stroke(ctx, xx + size * .4, yy + size, xx + size, yy + size * .6, '#384e3940', .9);
    }
    for (let i = 0; i < width * height / 23000; i++) {
      const xx = x + noise(i + seed * 19) * width, yy = y + noise(i + seed * 33 + 2) * height;
      ctx.beginPath(); ctx.moveTo(xx,yy); ctx.lineTo(xx+11,yy+7); ctx.lineTo(xx+6,yy+18); ctx.lineTo(xx+17,yy+29);
      ctx.moveTo(xx+6,yy+18); ctx.lineTo(xx-4,yy+21);
      ctx.strokeStyle = '#354d3c4a'; ctx.lineWidth = 1.2; ctx.stroke();
      stroke(ctx, xx+7, yy+18, xx+18, yy+28, '#dfd0a745', .8);
    }
  }

  private woodTexture(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, seed: number) {
    for (let row = 0, yy = y; yy < y + height; row++, yy += 22) {
      ctx.fillStyle = row % 3 ? '#ddc18b13' : '#443f321a'; ctx.fillRect(x, yy + 2, width, 20);
      stroke(ctx, x, yy, x + width, yy, '#463e30b3', 2);
      stroke(ctx, x, yy + 2, x + width, yy + 2, '#e4c89269', 1);
      for (let j = 0; j < width / 39; j++) {
        const xx = x + j * 39 + noise(j + row) * 16;
        ctx.beginPath(); ctx.moveTo(xx, yy + 7); ctx.bezierCurveTo(xx + 8, yy + 3, xx + 19, yy + 12, xx + 34, yy + 7);
        ctx.strokeStyle = '#55493160'; ctx.lineWidth = .65; ctx.stroke();
        stroke(ctx, xx + 6, yy + 15, xx + 23 + noise(j + row + seed) * 10, yy + 14, '#e1bc793a', .65);
      }
      const seam = x + 50 + noise(row + seed * 3) * Math.max(1, width - 80);
      stroke(ctx, seam, yy + 2, seam, yy + 21, '#423f3370', 1.2);
      for (const xx of [seam - 5, seam + 5]) {
        ctx.fillStyle = '#454639'; ctx.beginPath(); ctx.arc(xx, yy + 6, 1.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d7c294'; ctx.fillRect(xx-.6, yy+5, 1, .6);
      }
      const knotX = x + 24 + noise(row + seed * 17) * Math.max(1, width - 48);
      ctx.strokeStyle = '#584b3280'; ctx.lineWidth = .7;
      for (let ring = 0; ring < 3; ring++) { ctx.beginPath(); ctx.ellipse(knotX, yy + 12, 2 + ring * 2.6, 1 + ring * 1.1, -.12, 0, Math.PI * 2); ctx.stroke(); }
    }
    this.grain(ctx, x, y, width, height, seed, 65);
  }

  private concreteTexture(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, seed: number) {
    this.grain(ctx, x, y, width, height, seed, 40);
    for (let yy = y + 22, row = 0; yy < y + height; yy += 64, row++) {
      stroke(ctx, x, yy, x + width, yy, '#5d6c605c', 1.6);
      stroke(ctx, x, yy + 2, x + width, yy + 2, '#dbe0cb4f', 1);
      for (let xx = x + 16; xx < x + width - 10; xx += 98) {
        ctx.fillStyle = '#58695a7a'; ctx.beginPath(); ctx.arc(xx, yy + 11, 1.8, 0, Math.PI * 2); ctx.fill();
        stroke(ctx, xx, yy + 11, xx, yy + 23 + noise(xx + row) * 20, '#4e625118', 3);
      }
    }
    for (let i = 0; i < width * height / 1800; i++) {
      const xx = x + noise(i + seed * 31) * width, yy = y + noise(i + seed * 53 + 77) * height;
      ctx.fillStyle = i % 2 ? '#53665035' : '#d9d9bb39'; ctx.fillRect(xx, yy, 1 + noise(i + 12) * 4, 1 + noise(i + 23) * 2);
    }
    for (let i = 0; i < width / 120; i++) {
      const xx = x + 50 + noise(i + seed * 9) * (width - 70), yy = y + 36 + noise(i + seed + 7) * (height - 55);
      ctx.beginPath(); ctx.moveTo(xx,yy); ctx.lineTo(xx-5,yy+9); ctx.lineTo(xx+2,yy+15); ctx.lineTo(xx-3,yy+30); ctx.moveTo(xx+2,yy+15); ctx.lineTo(xx+11,yy+20);
      ctx.strokeStyle = '#445a4850'; ctx.lineWidth = .7; ctx.stroke();
    }
  }

  private bunker(ctx: CanvasRenderingContext2D, east: boolean) {
    const x = east ? 2818 : 322, y = east ? 548 : 216;
    shape(ctx, [[x,y],[x+316,y],[x+316,y+188],[x+250,y+216],[x+64,y+216],[x,y+188]], east ? '#535745' : '#4e5952');
    ctx.fillStyle = east ? '#737359' : '#768077'; ctx.fillRect(x + 58, y + 32, 200, 92);
    ctx.fillStyle = '#303f35'; ctx.fillRect(x + 63, y + 38, 190, 61);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#b5cec0'; ctx.fillRect(x + 72 + i * 61, y + 49, 42, 38);
      ctx.strokeStyle = '#899785'; ctx.lineWidth = 4; ctx.strokeRect(x + 72 + i * 61, y + 49, 42, 38);
    }
  }
  private bunkerTrim(ctx: CanvasRenderingContext2D, east: boolean) {
    if (east) {
      // The bottom sill sits on the existing terrain; its front follows that terrain.
      path(ctx, [[2818,686],[2878,666],[2950,706],[3004,706],[3078,666],[3136,686],[3136,736],[2818,736]].map(([x, y]) => ({ x, y })));
      ctx.strokeStyle = '#464833'; ctx.lineWidth = 3; ctx.stroke();
      for (const yy of [711, 729]) stroke(ctx, 2824, yy, 3130, yy, '#4e503aaa', 2);
      for (const xx of [2826, 3128]) {
        stroke(ctx, xx, 680, xx, 735, '#b0a271', 10);
        stroke(ctx, xx + 3, 684, xx + 3, 732, '#625940', 2);
      }
      ctx.fillStyle = '#ddd0a0'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.fillText('EAST  /  02', 2976, 730);
    } else {
      stroke(ctx, 324, 196, 634, 196, '#d3d2b778', 3);
      stroke(ctx, 324, 200, 324, 312, '#626f63', 3);
      stroke(ctx, 636, 200, 636, 282, '#626f63', 3);
      ctx.fillStyle = '#bbc0a5'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.fillText('WEST  /  01', 482, 224);
      // Base trim lies wholly inside the left island's solid floor.
      ctx.strokeStyle = '#4a584a'; ctx.lineWidth = 3; ctx.strokeRect(322, 386, 314, 36);
      stroke(ctx, 327, 391, 631, 391, '#c4c8ad', 2);
    }
  }
  private palm(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, lean: number) {
    const top = x + height * lean;
    stroke(ctx, x, y, top, y - height, '#5b6946', 9);
    stroke(ctx, x + 2, y, top + 2, y - height, '#acac73', 4);
    for (let i = 0; i < 8; i++) {
      const t = i / 8; stroke(ctx, x + height * lean * t - 3, y - height * t, x + height * lean * t + 4, y - height * t - 2, '#636e45', 2);
    }
    for (let i = 0; i < 7; i++) {
      const angle = (i / 6) * Math.PI + .2, dx = Math.cos(angle) * 55, dy = -Math.sin(angle) * 30;
      shape(ctx, [[top,y-height],[top+dx*.5,y-height+dy-10],[top+dx,y-height+dy+14],[top+dx*.56,y-height+dy+2]], i%2 ? '#718951' : '#8ca362');
    }
  }
  private shrub(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    for (let i = 0; i < 7; i++) {
      const angle = i / 6 * Math.PI;
      shape(ctx, [[x,y],[x+Math.cos(angle)*size,y-Math.sin(angle)*size-8],[x+(i-3)*4,y-6]], i%2 ? '#607c45' : '#8ea564');
    }
  }
}
