// Maintenance helper. Fonts are committed locally; this is never needed to play/build.
import { mkdir, writeFile } from 'node:fs/promises';
const folder = new URL('../public/assets/fonts/', import.meta.url);
await mkdir(folder, { recursive: true });
const stylesheet = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Barlow:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
const response = await fetch(stylesheet, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } });
if (!response.ok) throw new Error(`Font manifest: ${response.status}`);
const source = await response.text();
const blocks = [...source.matchAll(/@font-face\s*\{[^}]+\}/g)].map(match => match[0]);
const css = [];
for (const block of blocks) {
  if (block.includes('unicode-range') && !block.includes('U+0000-00FF')) continue;
  const remote = block.match(/url\(([^)]+)\)/)?.[1];
  const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
  const weight = block.match(/font-weight:\s*([^;]+)/)?.[1];
  if (!remote || !family || !weight || !remote.startsWith('https://fonts.gstatic.com/')) throw new Error('Unexpected font metadata');
  const extension = remote.split('.').pop();
  const filename = `${family.toLowerCase().replaceAll(' ', '-')}-${weight}.${extension}`;
  const asset = await fetch(remote);
  if (!asset.ok) throw new Error(`Font download: ${asset.status}`);
  await writeFile(new URL(filename, folder), Buffer.from(await asset.arrayBuffer()));
  css.push(block.replace(remote, `/assets/fonts/${filename}`));
}
for (const family of ['barlow', 'barlowcondensed', 'ibmplexmono']) {
  const license = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${family}/OFL.txt`);
  if (!license.ok) throw new Error(`Font license: ${family} ${license.status}`);
  await writeFile(new URL(`${family}-OFL.txt`, folder), await license.text());
}
await writeFile(new URL('../src/fonts.css', import.meta.url), `${css.join('\n')}\n`);
console.log(`Vendored ${css.length} Latin font faces and three OFL licenses.`);
