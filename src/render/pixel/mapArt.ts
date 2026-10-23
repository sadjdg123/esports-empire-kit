// The match map in pixel art (V3). The ground (grass, river, stone lanes, bridges, jungle
// trails, trees, rocks) is computed into an RGBA buffer once per match; towers, bases,
// objectives, jungle monsters and creeps are small sprites drawn from text grids.
// Pure: no canvas here, so the art is checked in Node and previewed with tools/map-sheet.ts.

import type { MapConfig } from '../../core/types';

/** Ground image size. It is drawn at 2x, so one ground pixel is as big as one hero sprite pixel. */
export const MAP_PX = 360;
export const MAP_MARGIN = 10; // ground pixels of border around the 1000 x 1000 world
const K = (MAP_PX - 2 * MAP_MARGIN) / 1000; // world units -> ground pixels

/** World coordinates -> ground pixels. */
export const gx = (x: number) => MAP_MARGIN + x * K;

// Half-widths in world units.
const LANE = 30;
const LANE_EDGE = 34;
const RIVER = 44;
const BANK = 53;
const TRAIL = 9;
const TRAIL_EDGE = 12;
const PLAZA = 95;
const ARENA = 46;
const CLEARING = 34;

type Rgb = [number, number, number];
const hex = (h: string): Rgb => {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const GROUND = {
  grass: ['#5fae4c', '#58a446', '#66b653', '#5aa84a'].map(hex),
  grassDark: hex('#3f7f3a'),
  border: ['#2f5e2e', '#2b582b', '#336431'].map(hex),
  stone: ['#cdbf98', '#c4b58c', '#d6c9a4'].map(hex),
  mortar: hex('#a39470'),
  laneEdge: hex('#8f7f58'),
  plaza: ['#d9d1bd', '#d1c8b2'].map(hex),
  plazaMortar: hex('#b3a98f'),
  dirt: ['#b38f5f', '#a9865a'].map(hex),
  dirtEdge: hex('#8c6e48'),
  sand: hex('#e0cd8c'),
  sandDark: hex('#cdb878'),
  water: hex('#4a9ad8'),
  deep: hex('#3b84c4'),
  ripple: hex('#8ccaf2'),
  plank: ['#b07a44', '#a06c3a'].map(hex),
  plankGap: hex('#6b4424'),
  clearing: hex('#78bf60'),
  flower: ['#f4e36a', '#f29ac0', '#ffffff'].map(hex),
};

/** Stable pseudo-random number in [0, 1) for a pixel (the look must not change between frames). */
function hash(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Seg = [number, number, number, number];
function segDist(px: number, py: number, [ax, ay, bx, by]: Seg): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

interface Fields { lane: Float32Array; trail: Float32Array; river: Float32Array; plaza: Float32Array; arena: Float32Array; camp: Float32Array }

// Only pixels this close (world units) to a shape are measured; the rest count as far away.
// Enough for every rule below: the widest is a tree, which keeps PLAZA + 34 from a base.
const ROAD_REACH = 80;
const NODE_REACH = PLAZA + 40;
const FAR = 1e4;

/** Lowers `field` to the distance from each pixel near segment s (a point when both ends are equal). */
function measure(field: Float32Array, s: Seg, reach: number): void {
  const x0 = Math.max(0, Math.floor(gx(Math.min(s[0], s[2]) - reach)));
  const x1 = Math.min(MAP_PX - 1, Math.ceil(gx(Math.max(s[0], s[2]) + reach)));
  const y0 = Math.max(0, Math.floor(gx(Math.min(s[1], s[3]) - reach)));
  const y1 = Math.min(MAP_PX - 1, Math.ceil(gx(Math.max(s[1], s[3]) + reach)));
  for (let py = y0; py <= y1; py++) {
    const y = (py + 0.5 - MAP_MARGIN) / K;
    for (let px = x0; px <= x1; px++) {
      const d = segDist((px + 0.5 - MAP_MARGIN) / K, y, s);
      const i = py * MAP_PX + px;
      if (d < field[i]!) field[i] = d;
    }
  }
}

/** Distances (world units) from every ground pixel to the nearest lane, trail, river, base, objective and camp. */
function fields(map: MapConfig): Fields {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const n = MAP_PX * MAP_PX;
  const make = () => new Float32Array(n).fill(FAR);
  const f: Fields = { lane: make(), trail: make(), river: new Float32Array(n), plaza: make(), arena: make(), camp: make() };
  for (const ids of Object.values(map.lanes)) {
    for (let i = 1; i < ids.length; i++) {
      const a = byId.get(ids[i - 1]!)!;
      const b = byId.get(ids[i]!)!;
      measure(f.lane, [a.x, a.y, b.x, b.y], ROAD_REACH);
    }
  }
  for (const [a, b] of map.edges) {
    const na = byId.get(a)!;
    const nb = byId.get(b)!;
    measure(f.trail, [na.x, na.y, nb.x, nb.y], ROAD_REACH);
  }
  for (const node of map.nodes) {
    const field = node.type === 'BASE' ? f.plaza : node.type === 'OBJECTIVE' ? f.arena : node.type === 'JUNGLE' ? f.camp : null;
    if (field) measure(field, [node.x, node.y, node.x, node.y], NODE_REACH);
  }
  for (let py = 0; py < MAP_PX; py++) {
    const y = (py + 0.5 - MAP_MARGIN) / K;
    for (let px = 0; px < MAP_PX; px++) f.river[py * MAP_PX + px] = Math.abs((px + 0.5 - MAP_MARGIN) / K - y) / Math.SQRT2; // the river runs corner to corner along y = x
  }
  return f;
}

// --- decorations (stamped into the ground) ----------------------------------

export const DECOR_COLORS: Readonly<Record<string, string>> = {
  o: '#1f3a1c', l: '#4fa047', L: '#3a7d36', h: '#7cc466', D: '#2f6a2f', b: '#7a5230', B: '#5a3a22',
  r: '#4a4640', g: '#b7b2a8', G: '#8a857c', w: '#e8e4da', p: '#6fae5a', y: '#e8d27a',
};
const TREE = [
  '....oooo....',
  '..oolhllo...',
  '.olhhllllLo.',
  '.olhllllllo.',
  'olhllllllLLo',
  'ollllllllLLo',
  'olllllllLLLo',
  '.oLlllllLLo.',
  '.oDLLLLLLDo.',
  '..ooDDDDoo..',
  '....obBo....',
  '....obBo....',
  '...oobBoo...',
];
const TREE_SMALL = ['..oooo..', '.olhllo.', 'olhllLLo', 'ollllLLo', '.oDLLDo.', '..oooo..', '...bB...', '..obBo..'];
const BUSH = ['..oooo..', '.ollhlo.', 'olhllllo', 'ollllLLo', '.oLLLLo.', '..oooo..'];
const ROCK = ['..rrr..', '.rgwGr.', 'rggwgGr', 'rGgggGr', '.rrrrr.'];
const REEDS = ['p.p', 'ppp', 'p.p', '.p.'];
/** Lighter shadow left under a tree or rock. */
const SHADOW = 0.78;

function stamp(buf: Uint8ClampedArray, rows: string[], x: number, y: number, shadow = true): void {
  const put = (px: number, py: number, rgb: Rgb | null, dim = 1) => {
    if (px < 0 || py < 0 || px >= MAP_PX || py >= MAP_PX) return;
    const k = (py * MAP_PX + px) * 4;
    if (rgb) { buf[k] = rgb[0]; buf[k + 1] = rgb[1]; buf[k + 2] = rgb[2]; } else { buf[k] = buf[k]! * dim; buf[k + 1] = buf[k + 1]! * dim; buf[k + 2] = buf[k + 2]! * dim; }
  };
  const w = rows[0]!.length;
  if (shadow) {
    // A flat oval shadow under the base of the object.
    const cy = y + rows.length - 1;
    for (let dx = -1; dx <= w; dx++) for (let dy = 0; dy < 2; dy++) put(x + dx, cy + dy, null, SHADOW);
  }
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = DECOR_COLORS[row[dx]!];
      if (c) put(x + dx, y + dy, hex(c));
    }
  });
}

const cache = new WeakMap<MapConfig, Uint8ClampedArray>();

/** The whole ground as RGBA pixels, MAP_PX x MAP_PX. Made once per map; do not modify the result. */
export function groundPixels(map: MapConfig): Uint8ClampedArray {
  let buf = cache.get(map);
  if (!buf) { buf = paintGround(map); cache.set(map, buf); }
  return buf;
}

function paintGround(map: MapConfig): Uint8ClampedArray {
  const f = fields(map);
  const buf = new Uint8ClampedArray(MAP_PX * MAP_PX * 4);
  const pick = <T>(list: T[], px: number, py: number, k = 0) => list[Math.floor(hash(px, py, k) * list.length)]!;
  const lo = MAP_MARGIN - 2;
  const hi = MAP_PX - MAP_MARGIN + 2;
  for (let py = 0; py < MAP_PX; py++) {
    for (let px = 0; px < MAP_PX; px++) {
      const i = py * MAP_PX + px;
      const lane = f.lane[i]!;
      const river = f.river[i]!;
      let c: Rgb;
      const outside = px < lo || py < lo || px >= hi || py >= hi;
      if (outside && lane > LANE_EDGE) c = pick(GROUND.border, px, py);
      else if (f.arena[i]! < ARENA) {
        // Round stone platform on the river with a ring of runes.
        const d = f.arena[i]!;
        c = d > ARENA - 4 ? GROUND.laneEdge : d > ARENA - 12 && d < ARENA - 8 ? GROUND.mortar : pick(GROUND.plaza, px >> 2, py >> 2, 3);
      } else if (lane < LANE_EDGE && river < RIVER) {
        // Wooden bridge where a lane crosses the river (planks across the lane).
        c = lane > LANE ? GROUND.plankGap : (px + py) % 4 === 0 ? GROUND.plankGap : pick(GROUND.plank, (px + py) >> 2, 0, 5);
      } else if (river < RIVER) {
        const ripple = (px - py + 999) % 9 === 0 && ((px + py) >> 1) % 7 < 3;
        c = ripple ? GROUND.ripple : river < RIVER - 16 ? GROUND.deep : GROUND.water;
      } else if (lane < LANE) {
        // Stone slabs in offset rows.
        const row = py >> 2;
        const mortar = py % 4 === 0 || (px + (row % 2) * 3) % 6 === 0;
        c = mortar ? GROUND.mortar : pick(GROUND.stone, Math.floor((px + (row % 2) * 3) / 6), row, 1);
      } else if (lane < LANE_EDGE) c = GROUND.laneEdge;
      else if (river < BANK) c = river < RIVER + 3 ? GROUND.sandDark : GROUND.sand;
      else if (f.plaza[i]! < PLAZA) {
        const mortar = py % 8 === 0 || px % 8 === 0;
        c = mortar ? GROUND.plazaMortar : pick(GROUND.plaza, px >> 3, py >> 3, 2);
      } else if (f.trail[i]! < TRAIL) c = pick(GROUND.dirt, px, py, 4);
      else if (f.trail[i]! < TRAIL_EDGE) c = GROUND.dirtEdge;
      else if (f.camp[i]! < CLEARING) c = f.camp[i]! < 14 ? pick(GROUND.dirt, px, py, 6) : GROUND.clearing;
      else {
        const r = hash(px, py, 7);
        c = r < 0.012 ? pick(GROUND.flower, px, py, 8) : r < 0.05 ? GROUND.grassDark : pick(GROUND.grass, px, py, 9);
      }
      const k = i * 4;
      buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; buf[k + 3] = 255;
    }
  }
  // Trees, bushes, rocks and reeds where nobody walks, placed on a jittered grid.
  const decor: { y: number; x: number; rows: string[] }[] = [];
  const CELL = 8;
  for (let cy = 0; cy < MAP_PX; cy += CELL) {
    for (let cx = 0; cx < MAP_PX; cx += CELL) {
      const px = cx + Math.floor(hash(cx, cy, 11) * CELL);
      const py = cy + Math.floor(hash(cx, cy, 12) * CELL);
      if (px >= MAP_PX || py >= MAP_PX) continue;
      const i = py * MAP_PX + px;
      const clear = Math.min(f.lane[i]! - LANE_EDGE, f.trail[i]! - TRAIL_EDGE, f.river[i]! - BANK, f.plaza[i]! - PLAZA, f.arena[i]! - ARENA, f.camp[i]! - CLEARING);
      const outside = px < lo || py < lo || px >= hi || py >= hi;
      const r = hash(cx, cy, 13);
      if (f.river[i]! > RIVER + 1 && f.river[i]! < BANK && f.lane[i]! > LANE_EDGE + 8 && r < 0.35) decor.push({ x: px - 1, y: py - 3, rows: REEDS });
      else if (clear < 4) continue;
      else if (outside || clear > 34) decor.push({ x: px - 6, y: py - 12, rows: r < 0.75 ? TREE : TREE_SMALL });
      else if (clear > 16) { if (r < 0.45) decor.push({ x: px - 4, y: py - 7, rows: r < 0.25 ? TREE_SMALL : BUSH }); else if (r < 0.55) decor.push({ x: px - 3, y: py - 4, rows: ROCK }); }
      else if (r < 0.12) decor.push({ x: px - 4, y: py - 5, rows: BUSH });
      else if (r < 0.18) decor.push({ x: px - 3, y: py - 4, rows: ROCK });
    }
  }
  decor.sort((a, b) => a.y + a.rows.length - (b.y + b.rows.length) || a.x - b.x);
  for (const d of decor) stamp(buf, d.rows, d.x, d.y, d.rows !== REEDS);
  return buf;
}

// --- sprites -------------------------------------------------------------------

/** Sprite grids. Team colour letters: c, C (shadow), t (light), x (crystal). */
export const MAP_SPRITES = {
  tower: [
    '.......o......',
    '.......otto...',
    '.......ottto..',
    '.......otto...',
    '......oo......',
    '.....octo.....',
    '....occtco....',
    '...occctcco...',
    '..occcctccco..',
    '.oCCCCCCCCCCo.',
    '..oooooooooo..',
    '..ogaaaaaaAo..',
    '..ogakkaaaAo..',
    '..ogakyaaaAo..',
    '..ogaaaaaaAo..',
    '..oAAAAAAAAo..',
    '..ogaaaaaaAo..',
    '..ogaaaakkAo..',
    '..ogaaaakyAo..',
    '.ogaaaaaaaaAo.',
    'oAAAAAAAAAAAAo',
    '.oooooooooooo.',
  ],
  towerRuin: [
    '....o..o......',
    '...oAooaoo....',
    '..ogAoaaAo.o..',
    '..oaaaoAaaooo.',
    '.oaAaaaoaaAaAo',
    'oAAAAAAAAAAAAo',
    '.oooooooooooo.',
  ],
  base: [
    '...........oo...........',
    '..........oxxo..........',
    '.........oxwxXo.........',
    '.........oxxxXo.........',
    '..........oxXo..........',
    '...........oo...........',
    '..oo...oo......oo...oo..',
    '.octo.oCCo....oCCo.octo.',
    '.octo.oaao....oaao.octo.',
    'oaaaaooaaoooooaaooaaaaao',
    'oagaaaaaaaaaaaaaaaaaagAo',
    'oagaaaaaaaaaaaaaaaaaaaAo',
    'oagakkaaaaoooooaaaakkaAo',
    'oagakyaaaoccccooaaakyaAo',
    'oagaaaaaaoctccCoaaaaaaAo',
    'oagaaaaaaocccCCoaaaaaaAo',
    'oAAAAAAAAocccCCoAAAAAAAo',
    'oagaaaaaaoccCCCoaaaaaaAo',
    'oaaaaaaaaoCCCCCoaaaaaaAo',
    'oAAAAAAAAAAAAAAAAAAAAAAo',
    '.oooooooooooooooooooooo.',
  ],
  baseRuin: [
    '..o.....o......o.....o..',
    '.oAo..ooaoo...oaoo..oAo.',
    'oaaAoooaaAaoooaaAooaaaao',
    'oagaaAaaoaaAaaaoaaAaaaAo',
    'oAAAAAAAAAAAAAAAAAAAAAAo',
    '.oooooooooooooooooooooo.',
  ],
  // 守望者: a stone guardian with glowing eyes.
  warden: [
    '.....oooooo.....',
    '....ogggggGo....',
    '...ogxggggxGo...',
    '...oggggggggo...',
    '...oGgoooogGo...',
    '.oooGGGGGGGGooo.',
    'oggGoggggggoGggo',
    'ogGGoggxxggoGGgo',
    'oGGooggxxggooGGo',
    '.oo.oggggggo.oo.',
    '....oGGGGGGo....',
    '....oGGooGGo....',
    '...oGGo..oGGo...',
    '...oooo..oooo...',
  ],
  // 晶核: a floating crystal over a small pedestal.
  core: [
    '......oo......',
    '.....oxwo.....',
    '....oxwxxo....',
    '...oxwxxxXo...',
    '...oxxxxXXo...',
    '....oxxXXo....',
    '.....oXXo.....',
    '......oo......',
    '..............',
    '...oooooooo...',
    '..oggggggggo..',
    '..oGGGGGGGGo..',
    '...oooooooo...',
  ],
  pedestal: [
    '...oooooooo...',
    '..oggggggggo..',
    '..oGGGGGGGGo..',
    '...oooooooo...',
  ],
  // Jungle monsters: a round furry beast, and a bigger horned one at the core camps.
  beast: [
    '...o....o...',
    '..omo..omo..',
    '.ommmmmmmmo.',
    'ommwkmmwkmmo',
    'ommmmmmmmmmo',
    'omMmmnnmmMmo',
    '.oMMMMMMMMo.',
    '..oo....oo..',
  ],
  bigBeast: [
    '.ww........ww.',
    '.owo......owo.',
    '..ommmmmmmmo..',
    '.ommmmmmmmmmo.',
    'ommwkmmmmwkmmo',
    'ommmmmmmmmmmmo',
    'omMmmmnnmmmMmo',
    'omMMmmmmmmMMmo',
    '.oMMMMMMMMMMo.',
    '..oo..oo..oo..',
  ],
  creepA: ['..ooo..', '.ottto.', '.oseso.', '.occco.', 'oaccco.', '.occco.', '.o..o..'],
  creepB: ['..ooo..', '.ottto.', '.oseso.', '.occco.', '.occcao', '.occco.', '..o..o.'],
};
export type MapSprite = keyof typeof MAP_SPRITES;

const SPRITE_COLORS: Record<string, string> = {
  o: '#2a1a14', a: '#c9c3b5', A: '#8f8879', g: '#e4dfd3', G: '#9d978a', k: '#2b2233', y: '#ffd76a', w: '#ffffff',
  m: '#8a6aa8', M: '#5e4878', n: '#f3b0c0', s: '#f6d3b3', e: '#1b1220',
};

/** Colours for a map sprite; `team` colours towers, bases and creeps, `glow` the objective crystal and eyes. */
export function mapPalette(team: string | null, glow = '#7fd3ff'): Record<string, string> {
  const t = team ?? '#a0a0a0';
  return { ...SPRITE_COLORS, c: t, C: scale(t, 0.7), t: scale(t, 1.35), x: team ? scale(t, 1.5) : glow, X: team ? t : scale(glow, 0.7) };
}

function scale(h: string, f: number): string {
  const [r, g, b] = hex(h);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1)}`;
}
