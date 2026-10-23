// Draws every hero frame into one PNG (blue and red team), for checking the pixel art without a browser.
// Run: npx tsx tools/hero-sheet.ts docs/reports/v2/heroes.png [scale]
import { HERO_ART_IDS, HERO_FRAMES, HERO_H, HERO_W, heroPalette, heroRows } from '../src/render/pixel/heroArt';
import { blit, writePng } from './png';

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
  blit(px, W, heroRows(id, frame), heroPalette(id, team), (ti * HERO_FRAMES.length + fi) * CW + 1, row * CH + 1, SC);
})));

writePng(out, W, H, px);
console.log(`wrote ${out} (${W}x${H})`);
