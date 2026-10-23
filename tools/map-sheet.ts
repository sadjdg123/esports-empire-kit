// Draws the match map as it looks in a match (ground, towers, bases, objectives, jungle monsters,
// creeps and a few heroes for scale) into a PNG, without a browser.
// Run: npx tsx tools/map-sheet.ts docs/reports/v3/map.png [scale]
import { loadGameData } from '../src/core/config';
import { heroPalette, heroRows } from '../src/render/pixel/heroArt';
import { MAP_PX, MAP_SPRITES, gx, groundPixels, mapPalette, type MapSprite } from '../src/render/pixel/mapArt';
import { blit, writePng } from './png';

const out = process.argv[2] ?? 'map.png';
const SC = Number(process.argv[3] ?? 2);
const data = loadGameData();
const map = data.match.map;
const W = MAP_PX * SC;
const ground = groundPixels(map);
const px = new Uint8ClampedArray(W * W * 4);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const s = ((y / SC | 0) * MAP_PX + (x / SC | 0)) * 4;
  const k = (y * W + x) * 4;
  px[k] = ground[s]!; px[k + 1] = ground[s + 1]!; px[k + 2] = ground[s + 2]!; px[k + 3] = 255;
}
const TEAM = { BLUE: '#3a7bd5', RED: '#e84a4a' };
/** Feet (bottom centre) of a sprite at world (x, y). */
const put = (rows: readonly string[], pal: Record<string, string>, x: number, y: number) =>
  blit(px, W, rows, pal, Math.round(gx(x) - rows[0]!.length / 2), Math.round(gx(y) - rows.length + 1), SC);
const sprite = (name: MapSprite, pal: Record<string, string>, x: number, y: number) => put(MAP_SPRITES[name], pal, x, y);

for (const n of map.nodes) {
  const side = n.side as 'BLUE' | 'RED' | undefined;
  if (n.type === 'TOWER') sprite(n.id === 'R_TOP_T1' || n.id === 'B_BOT_T1' ? 'towerRuin' : 'tower', mapPalette(TEAM[side!]), n.x, n.y + 8);
  if (n.type === 'BASE') sprite('base', mapPalette(TEAM[side!]), n.x, n.y + 12);
  if (n.type === 'JUNGLE') sprite(n.id.endsWith('CORE') ? 'bigBeast' : 'beast', mapPalette(null), n.x, n.y + 6);
}
const obj = (id: string) => map.nodes.find((n) => n.id === data.match.objectives.find((o) => o.id === id)!.nodeId)!;
sprite('warden', mapPalette(null, '#7fd3ff'), obj('WARDEN').x, obj('WARDEN').y + 10);
sprite('core', mapPalette(null, '#c99bff'), obj('CORE').x, obj('CORE').y + 10);
for (let i = 0; i < 3; i++) {
  sprite(i % 2 ? 'creepA' : 'creepB', mapPalette(TEAM.BLUE), 300 + i * 25, 910);
  sprite(i % 2 ? 'creepB' : 'creepA', mapPalette(TEAM.RED), 910, 450 + i * 25);
}
put(heroRows('panyue', 'stand'), heroPalette('panyue', TEAM.BLUE), 470, 530);
put(heroRows('yexiao', 'attack'), heroPalette('yexiao', TEAM.RED), 530, 470);
put(heroRows('zhufeng', 'walkA'), heroPalette('zhufeng', TEAM.BLUE), 330, 330);

writePng(out, W, W, px);
console.log(`wrote ${out} (${W}x${W})`);
