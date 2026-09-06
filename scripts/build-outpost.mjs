import { writeFile } from 'node:fs/promises';

// Hand-authored, simplified contours from the classic Outpost visual reference.
// All artwork is drawn locally; no game textures, source code or TMX are shipped.
// Coordinates below use a 3328 × 1152 design grid; the pilot is 68 world pixels.
const scale = 1.4, sky = 180;
const shapes = [
  // Hanging lips leave at least 63 world pixels over the floor ridges: a
  // 54.2px crouched pilot passes while a 68px standing pilot must stay low.
  ['west-bunker-roof', 'bunker', false, [[320,192],[384,160],[448,160],[512,128],[576,160],[640,192],[640,285],[576,307],[576,256],[384,256],[384,320],[320,320]]],
  ['west-island', 'rock', true, [[220,416],[320,416],[320,384],[512,384],[576,352],[640,376],[640,446],[662,446],[696,480],[800,480],[800,512],[784,550],[752,580],[732,606],[606,606],[576,578],[512,640],[476,610],[384,514],[348,544],[284,542],[256,514],[232,480],[220,448]]],
  ['west-sky-stone', 'rock', true, [[928,316],[960,286],[994,316],[980,354],[960,386],[940,354]]],
  ['west-sky-island', 'rock', true, [[1184,316],[1280,224],[1376,316],[1364,354],[1338,392],[1308,414],[1246,414],[1220,392],[1198,354]]],
  ['west-middle-island', 'rock', true, [[1054,544],[1224,544],[1238,518],[1256,516],[1276,544],[1314,544],[1314,576],[1302,608],[1280,640],[1244,670],[1118,670],[1092,646],[1070,610],[1054,576]]],
  ['central-rise', 'rock', true, [[1564,478],[1602,478],[1614,454],[1648,450],[1668,478],[1730,478],[1856,350],[1920,350],[1952,380],[1952,448],[1938,486],[1918,514],[1818,610],[1758,670],[1632,670],[1600,640],[1578,608],[1564,576]]],
  ['east-sky-island', 'rock', true, [[2140,224],[2180,224],[2192,200],[2224,196],[2244,224],[2304,224],[2338,256],[2322,296],[2300,328],[2268,350],[2206,350],[2176,320],[2154,288],[2140,246]]],
  ['east-middle-island', 'rock', true, [[2268,544],[2378,544],[2412,510],[2452,510],[2464,480],[2498,480],[2530,512],[2512,550],[2492,582],[2432,640],[2396,670],[2334,670],[2304,640],[2282,608],[2268,564]]],
  ['east-sky-ramp', 'rock', true, [[2590,446],[2816,224],[2850,254],[2836,294],[2812,326],[2624,514],[2602,480]]],
  ['east-sky-stone', 'rock', true, [[2974,444],[3008,414],[3042,444],[3026,488],[3008,514],[2990,488]]],
  ['east-bunker-left', 'wood', false, [[2818,514],[2924,514],[2944,574],[2878,574],[2878,621],[2818,601]]],
  ['east-bunker-right', 'wood', false, [[3028,514],[3136,514],[3136,601],[3074,621],[3074,574],[3008,574]]],
  ['east-base', 'rock', true, [[1694,800],[1792,800],[1920,670],[1984,736],[1998,712],[2032,706],[2054,736],[2112,736],[2130,708],[2156,708],[2178,736],[2208,736],[2220,768],[2262,768],[2294,800],[2392,800],[2404,768],[2452,768],[2486,800],[2626,800],[2644,772],[2666,774],[2686,800],[2700,800],[2734,766],[2774,766],[2788,736],[2818,736],[2818,686],[2878,666],[2950,706],[3004,706],[3078,666],[3136,686],[3136,736],[3168,736],[3168,834],[3154,870],[3132,900],[3008,1024],[2944,962],[2908,990],[2718,990],[2688,962],[2652,990],[2590,990],[2560,964],[2522,992],[2336,990],[2304,964],[2268,992],[2012,990],[1984,962],[1850,1094],[1820,1118],[1758,1118],[1734,1096],[1710,1062],[1694,1022]]],
  ['central-lower-saddle', 'rock', true, [[1054,736],[1088,736],[1152,800],[1216,800],[1280,736],[1344,800],[1408,800],[1422,774],[1458,770],[1476,800],[1568,800],[1568,832],[1554,870],[1530,904],[1500,928],[1438,926],[1408,896],[1344,862],[1118,862],[1092,840],[1068,800],[1054,758]]],
  ['west-lower-bridge', 'rock', true, [[540,800],[574,800],[594,772],[620,772],[638,800],[650,800],[684,766],[800,766],[802,800],[896,800],[960,736],[992,736],[992,768],[982,802],[954,840],[924,862],[734,862],[704,834],[674,852],[640,864],[576,896],[554,864],[540,820]]],
  ['west-base-and-tunnel', 'rock', true, [[92,800],[388,800],[406,770],[424,770],[442,800],[480,800],[480,896],[464,934],[448,960],[492,980],[512,994],[534,980],[584,954],[630,930],[770,930],[800,940],[832,960],[864,940],[896,930],[1026,930],[1056,940],[1088,960],[1120,940],[1152,930],[1280,930],[1312,940],[1344,960],[1308,990],[1182,990],[1152,962],[1116,990],[1056,990],[1024,962],[896,1088],[768,962],[704,1024],[640,962],[570,1032],[540,1056],[350,1056],[256,962],[220,990],[158,990],[134,966],[106,928],[92,896]]],
];
const toWorld = ([x, y]) => ({ x: Math.round(x * scale * 10) / 10, y: Math.round((y * scale + sky) * 10) / 10 });
const spawn = (id, x, feet) => ({ id, ...toWorld([x, feet]), y: toWorld([x, feet]).y - 68 });
const spawnPoints = [
  spawn('west-courtyard', 190, 800), spawn('west-bunker', 420, 384),
  spawn('west-roof', 394, 160), spawn('west-bridge', 728, 766),
  spawn('central-saddle', 1168, 800), spawn('central-rise', 1684, 478),
  spawn('east-courtyard', 2330, 800), spawn('east-bunker', 2964, 706),
];
const arena = {
  id: 'outpost', name: 'Outpost', theme: 'outpost',
  width: 3328 * scale, height: 2100, floorY: 1830, openFloor: true,
  playerSpawn: { x: spawnPoints[0].x, y: spawnPoints[0].y },
  targetSpawn: { x: 350 * scale, y: 800 * scale + sky - 68 },
  platforms: [], spawnPoints,
  pickupPads: [
    { id: 'west-courtyard-weapon', x: 490, y: 1300, kind: 'ordinary' },
    { id: 'lower-tunnel-weapon', x: 1080, y: 1482, kind: 'ordinary' },
    { id: 'west-middle-weapon', x: 1560, y: 941.6, kind: 'ordinary' },
    { id: 'lower-saddle-weapon', x: 2100, y: 1300, kind: 'ordinary' },
    { id: 'east-middle-weapon', x: 3280, y: 941.6, kind: 'ordinary' },
    { id: 'east-courtyard-weapon', x: 3570, y: 1300, kind: 'ordinary' },
    { id: 'central-sniper-drop', x: 2640, y: 670, kind: 'sniper' },
  ],
  terrain: shapes.map(([id, material, grass, points]) => ({ id, material, grass, points: points.map(toWorld) })),
};
await writeFile(new URL('../public/assets/outpost.json', import.meta.url), JSON.stringify(arena, null, 2) + '\n');
const polygon = ([, material,, points]) => `<polygon points="${points.map(p => p.join(',')).join(' ')}" fill="${material === 'wood' ? '#766b48' : material === 'bunker' ? '#92958b' : '#8a8974'}" stroke="#3e4c40" stroke-width="6" stroke-linejoin="round"/>`;
const preview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3328 1280"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#a7c0b4"/><stop offset="1" stop-color="#d0d4b3"/></linearGradient></defs><rect width="3328" height="1280" fill="url(#sky)"/><path d="M0 980 430 600 760 890 1180 540 1740 980 2220 520 2780 930 3200 680 3328 720V1280H0" fill="#899d87" opacity=".2"/><g transform="translate(0 70)"><path d="M322 228H632V408H322ZM2818 548H3136V736H2818" fill="#46554a"/>${shapes.map(polygon).join('')}${shapes.filter(s => s[2]).map(s => `<polyline points="${s[3].slice(0, s[0] === 'west-base-and-tunnel' ? 7 : 5).map(p => p.join(',')).join(' ')}" fill="none" stroke="#b1c27f" stroke-width="10"/>`).join('')}<g fill="#b3cab9" stroke="#343e35" stroke-width="6">${[402,468,534].map(x => `<rect x="${x}" y="270" width="40" height="38"/>`).join('')}${[2882,2950,3018].map(x => `<rect x="${x}" y="590" width="42" height="38"/>`).join('')}</g></g></svg>`;
await writeFile(new URL('../public/assets/outpost-preview.svg', import.meta.url), preview + '\n');
console.log(`Built Outpost: ${arena.terrain.length} contours, ${spawnPoints.length} spawns, ${arena.width} × ${arena.height}.`);
