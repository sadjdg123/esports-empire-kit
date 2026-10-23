// Draws every hero frame into one PNG (blue and red team), for checking the pixel art without a browser.
// Run: npx tsx tools/hero-sheet.ts docs/reports/v2/heroes.png [scale]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { HERO_ART_IDS, HERO_FRAMES, HERO_H, HERO_W, heroPalette, heroRows } from '../src/render/pixel/heroArt';

const out = process.argv[2] ?? 'heroes.png';
const SC = Number(process.argv[3] ?? 4);
const TEAMS = ['#3a7bd5', '#e84a4a'];
const CW = HERO_W + 2;
const CH = HERO_H + 2;
const W = HERO_FRAMES.length * TEAMS.length * CW * SC;
const H = HERO_ART_IDS.length * CH * SC;
const px = Buffer.alloc(W * H * 4);
const put = (x: number, y: number, rgb: number) => {
  const k = (y * W + x) * 4;
  px[k] = rgb >> 16; px[k + 1] = (rgb >> 8) & 255; px[k + 2] = rgb & 255; px[k + 3] = 255;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 0x4a7a3c); // grass

HERO_ART_IDS.forEach((id, row) => TEAMS.forEach((team, ti) => HERO_FRAMES.forEach((frame, fi) => {
  const pal = heroPalette(id, team);
  const ox = (ti * HERO_FRAMES.length + fi) * CW + 1;
  const oy = row * CH + 1;
  heroRows(id, frame).forEach((line, y) => [...line].forEach((ch, x) => {
    const col = pal[ch];
    if (!col) return;
    const rgb = Number.parseInt(col.slice(1), 16);
    for (let a = 0; a < SC; a++) for (let b = 0; b < SC; b++) put((ox + x) * SC + b, (oy + y) * SC + a, rgb);
  }));
})));

// Minimal PNG writer (RGBA, no filtering).
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${out} (${W}x${H})`);
