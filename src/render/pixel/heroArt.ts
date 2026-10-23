// Hero sprites for the match view, built from text grids (no canvas here, so
// the art is checked in Node). Each hero is a chibi with its own headgear,
// face, outfit and weapon; the outfit takes the team colour.
//
// Letters: o outline, s skin, e eye, r blush, m mouth, h hair, H hair light,
// c team colour, C team shadow, t team light, a gear, A gear shadow, g gear light,
// p trousers, b boots, w steel, W dark steel, d wood, D dark wood, y gold,
// x glow (per hero), k mask, f string/feather (white).

import type { Archetype } from '../../core/types';

export type HeroFrame = 'stand' | 'walkA' | 'walkB' | 'attack' | 'cast' | 'down';
export const HERO_FRAMES: readonly HeroFrame[] = ['stand', 'walkA', 'walkB', 'attack', 'cast', 'down'];

/** Frame size; the feet are at the bottom centre, so a flipped frame stays in place. */
export const HERO_W = 28;
export const HERO_H = 24;
const BX = 8; // left edge of the 12-wide body
const HEAD_Y = 6; // first row of the head (headgear rows above it are allowed)
const BODY_Y = HEAD_Y + 11;

type Grid = string[];
interface Weapon {
  rows: Grid; // drawn pointing up, held at `grip`
  grip: [number, number];
  /** Grid used in the attack pose instead of turning the weapon to point forward (bows). */
  aim?: { rows: Grid; grip: [number, number] };
  /** Grid held at rest instead of the leaning upright weapon. */
  rest?: { rows: Grid; grip: [number, number] };
  lean?: number; // how far it leans outwards at rest (0 = upright, 1 = 45 degrees)
}
type Body = 'light' | 'armor' | 'robe';
type Face = 'plain' | 'wide' | 'mask';

interface HeroArt {
  head: Grid; // 6 rows of headgear above the face, plus any rows sticking up; 12 or 14 wide
  face: Face;
  body: Body;
  weapon: Weapon;
  offhand?: Weapon; // shield or second blade, left hand
  colors: Record<string, string>;
}

const OUTLINE = '#2a1a14';
const BASE_COLORS: Record<string, string> = {
  o: OUTLINE, e: '#1b1220', r: '#f08a8a', m: '#b0464a', p: '#3a3a4a', b: '#2b2b33',
  w: '#e3e8ee', W: '#8d99a6', d: '#b07440', D: '#6b4424', y: '#f2c14e', k: '#2b2236', f: '#f6f2e6',
};

// --- weapons (pointing up) ------------------------------------------------

const SWORD: Weapon = { rows: ['.o.', 'owo', 'owo', 'owo', 'owo', 'yyy', '.D.'], grip: [1, 6], lean: 1 };
const DAGGER: Weapon = { rows: ['.o.', 'owo', 'owo', 'yyy', '.D.'], grip: [1, 4], lean: 1 };
const MALLET: Weapon = {
  rows: ['ooooo', 'oaaao', 'ogaao', 'ooooo', '..D..', '..D..', '..D..'], grip: [2, 6],
  rest: { rows: ['..D..', '..D..', 'ooooo', 'oaaao', 'ooooo'], grip: [2, 0] }, // head on the ground
};
const MACE: Weapon = {
  rows: ['o.o.o', 'ooooo', 'oWWWo', 'ooooo', 'o.D.o', '..D..', '..D..'], grip: [2, 6],
  rest: { rows: ['..D..', 'o.D.o', 'ooooo', 'oWWWo', 'ooooo'], grip: [2, 0] },
};
const STAR_STAFF: Weapon = { rows: ['.x.', 'xyx', '.x.', '.D.', '.D.', '.D.', '.D.', '.D.', '.D.'], grip: [1, 7], lean: 0.5 };
const LEAF_STAFF: Weapon = { rows: ['a.a', 'aga', '.d.', '.d.', '.d.', '.d.', '.d.', '.d.', '.d.'], grip: [1, 7], lean: 0.5 };
const BELL_STAFF: Weapon = { rows: ['DDD', 'oyo', 'yyy', 'yyy', '.D.', '.D.', '.D.', '.D.', '.D.'], grip: [1, 7], lean: 0.5 };
const FLUTE: Weapon = { rows: ['.o.', 'oxo', 'owo', 'oxo', 'owo', 'owo', '.o.'], grip: [1, 5], lean: 1 };
const LONGBOW: Weapon = {
  rows: ['dd.', 'fdd', 'f.d', 'f.d', 'f.D', 'f.d', 'f.d', 'fdd', 'dd.'], grip: [2, 4],
  rest: { rows: ['.dd', 'ddf', 'd.f', 'd.f', 'D.f', 'd.f', 'd.f', 'ddf', '.dd'], grip: [0, 4] },
  aim: { rows: ['dd.....', '.fd....', '..fd...', '..fDwwy', '..fd...', '.fd....', 'dd.....'], grip: [3, 3] },
};
const CROSSBOW: Weapon = {
  rows: ['.D.', 'dDd', '.D.', '.D.', '.D.'], grip: [1, 4],
  rest: { rows: ['..d..', '..d..', 'DDDDw', '..d..', '..d..'], grip: [0, 2] },
  aim: { rows: ['..d...', '..d...', 'DDDDwy', '..d...', '..d...'], grip: [0, 2] },
};
const HORN_LANCE: Weapon = { rows: ['.x.', 'xxx', 'oxo', '.D.', '.D.', '.D.', '.D.', '.D.', '.D.'], grip: [1, 6], lean: 0.6 };
const FEATHER_BLADE: Weapon = { rows: ['.g.', 'gxg', 'owo', 'owo', 'yyy', '.D.'], grip: [1, 5], lean: 1 };
const EMBER_STAFF: Weapon = { rows: ['x.x', 'xyx', 'oxo', '.D.', '.D.', '.D.', '.D.', '.D.', '.D.'], grip: [1, 7], lean: 0.5 };
const STORM_BOW: Weapon = {
  rows: ['.dd', 'dxf', 'd.f', 'D.f', 'd.f', 'dxf', '.dd'], grip: [0, 3],
  rest: { rows: ['.dd', 'dxf', 'd.f', 'D.f', 'd.f', 'dxf', '.dd'], grip: [0, 3] },
  aim: { rows: ['dd....', '.xd...', '..dDyx', '.xd...', 'dd....'], grip: [2, 2] },
};
const DROP_STAFF: Weapon = { rows: ['.o.', 'oxo', 'xgx', 'oxo', '.D.', '.D.', '.D.', '.D.', '.D.'], grip: [1, 7], lean: 0.5 };
const TOWER_SHIELD: Weapon = { rows: ['oooooo', 'oaaaao', 'oayyao', 'oaaaao', 'oayyao', 'oaaaao', 'oaaaao', '.oooo.'], grip: [2, 3] };
const SHORT_SWORD: Weapon = { rows: ['.o.', 'owo', 'owo', 'yyy', '.D.'], grip: [1, 4], lean: 0.8 };
const SQUARE_SHIELD: Weapon = { rows: ['oooooo', 'oaaaao', 'oaccao', 'oaccao', 'oaaaao', '.oaao.', '..oo..'], grip: [2, 3] };
const THORN_SHIELD: Weapon = { rows: ['.o..o.', 'oooooo', 'oaaaao', 'oaxxao', 'oaaaao', 'oooooo', '.o..o.'], grip: [2, 3] };

// --- faces and bodies ----------------------------------------------------

const FACES: Record<Face, Grid> = {
  plain: ['.osssssssso.', '.osesssseso.', '.osesssseso.', '.orssmmssro.', '..oossssoo..'],
  wide: ['ohssssssssho', 'ohsessssesho', 'ohsessssesho', 'ohrssmmssrho', '.ohossssoho.'],
  mask: ['oaossssssoao', 'oaosessesoao', 'oaosessesoao', 'oaokkkkkkoao', '.oaokkkkoao.'],
};

// Torsos are 14 wide (one spare column each side for arms). Hands: [x, y] in that grid.
interface Torso { rows: Grid; right: [number, number]; left: [number, number] }
const TORSO_SIDE = BX - 1; // x of the 14-wide torso in the frame
const LIGHT: Record<'rest' | 'attack' | 'cast', Torso> = {
  rest: { rows: ['....occcco....', '...occtccco...', '..osccccccoso.', '..osCCCCCCo...', '...oppppppo...'], right: [11, 2], left: [3, 2] },
  attack: { rows: ['....occcco....', '...occtcccoooo', '..osccccccssso', '..osCCCCCCooo.', '...oppppppo...'], right: [12, 2], left: [3, 2] },
  cast: { rows: ['....occcco.os.', '...occtcccoso.', '..osccccccoo..', '..osCCCCCCo...', '...oppppppo...'], right: [12, 0], left: [3, 2] },
};
function armored(t: Torso): Torso {
  // Shoulder plates in the gear colour.
  const r = [...t.rows];
  r[0] = r[0]!.replace('occcco', 'aoccoa');
  r[1] = r[1]!.replace(/^(\.\.\.)occtccco/, '$1aactccaa').replace(/^(\.\.\.)occtcccoooo/, '$1aactccaaooo');
  return { ...t, rows: r };
}
function robed(t: Torso): Torso {
  // A long robe: the trousers row becomes the hem.
  const r = [...t.rows];
  r[3] = r[3]!.replace('CCCCCC', 'cxcccc');
  r[4] = '..oCCCCCCCCo..';
  return { ...t, rows: r };
}
function torso(body: Body, pose: 'rest' | 'attack' | 'cast'): Torso {
  const t = LIGHT[pose];
  return body === 'armor' ? armored(t) : body === 'robe' ? robed(t) : t;
}
const LEGS: Record<'stand' | 'walkA' | 'walkB', Grid> = {
  stand: ['...opp..ppo...', '...obb..bbo...'],
  walkA: ['...opp..ppo...', '..obb....bo...'],
  walkB: ['...opp..ppo...', '...ob....bbo..'],
};
const ROBE_LEGS: Record<'stand' | 'walkA' | 'walkB', Grid> = {
  stand: ['...oCCCCCCo...', '....bb..bb....'],
  walkA: ['...oCCCCCCo...', '...bb....b....'],
  walkB: ['...oCCCCCCo...', '....b....bb...'],
};

// --- the heroes ------------------------------------------------------------

const ART: Record<string, HeroArt> = {
  panyue: {
    head: ['.....oo.....', '....occo....', '...oocco....', '...oooooo...', '..oaaggaao..', '.oaaaggaaao.', '.oaaaaaaaao.', '.oAAAAAAAAo.', '.oAssssssAo.'],
    face: 'plain', body: 'armor', weapon: MALLET, offhand: SQUARE_SHIELD,
    colors: { h: '#3b2a20', H: '#5a4030', s: '#d9a57c', a: '#b8863b', A: '#7d5a26', g: '#e8c27a', x: '#ffe08a' },
  },
  tieji: {
    head: ['.o...oo...o.', '.oo.oaao.oo.', '.oaooaaooao.', '..oaaaaaao..', '.oaggaaaaao.', '.oaaaaaaaao.', 'oAoAoAoAoAoo', '.oAssssssAo.'],
    face: 'plain', body: 'armor', weapon: MACE, offhand: THORN_SHIELD,
    colors: { h: '#1d1d26', H: '#333344', s: '#eec19c', a: '#6d8a63', A: '#46603f', g: '#a8c49a', x: '#c9e06a' },
  },
  yexiao: {
    head: ['.oo......oo.', '.oao....oao.', '.oaao..oaao.', '.oaaaooaaao.', '.oaaaaaaaao.', 'oaaaAAAAaaao', 'oaaAhhhhhAao', 'oaAhhhhhhhAo', 'oaAsshhhssAo'],
    face: 'mask', body: 'light', weapon: DAGGER,
    colors: { h: '#2a2238', H: '#4a3d63', s: '#eec19c', a: '#4b3a6b', A: '#2f2447', g: '#7a66a3', x: '#c39bff', p: '#2b2236' },
  },
  feiren: {
    head: ['.........oo.', '........ohho', '.......ohho.', '...oooooooo.', '..ohhhhhhho.', '.ohHhhhhhhho', '.ohHhhhhhhho', '.oggggggggo.', '.ohsshhssho.'],
    face: 'plain', body: 'light', weapon: SWORD, offhand: { rows: ['.D.', 'yyy', 'owo', 'owo', '.o.'], grip: [1, 0] },
    colors: { h: '#c23a3a', H: '#e8706a', s: '#f6d3b3', g: '#f6f2e6', a: '#c23a3a', A: '#8a2626', x: '#ff8a7a' },
  },
  xingzhu: {
    head: ['.......oo...', '......oaao..', '.....oaaao..', '....oaxaao..', '...oaaaaao..', '..oaaaaaaao.', '.oaaaaaaaaao', 'oAAAAAAAAAAo', '.ohhhhhhhho.', '.ohsshhssho.'],
    face: 'plain', body: 'robe', weapon: STAR_STAFF,
    colors: { h: '#d9d4c7', H: '#ffffff', s: '#f6d3b3', a: '#2f3f7a', A: '#1f2a55', g: '#4a5fa8', x: '#ffe066' },
  },
  shuangdi: {
    head: ['...oooooo...', '..ohhhhhho..', '.ohHhhhhhxo.', 'ohhHhhhhhhho', 'ohhhhhhhhhho', 'ohhsshhsshho'],
    face: 'wide', body: 'robe', weapon: FLUTE,
    colors: { h: '#9fd3f0', H: '#e6f6ff', s: '#f6d3b3', a: '#7fb8d8', A: '#4f86a8', g: '#d0ecff', x: '#bff0ff' },
  },
  zhufeng: {
    head: ['........o...', '.......ofo..', '......offo..', '...oooooofo.', '..oaaaaaaoo.', '.oaaaaaaaao.', '.oAAAAAAAAAo', '.ohhhhhhhho.', '.ohsshhssho.'],
    face: 'plain', body: 'light', weapon: LONGBOW,
    colors: { h: '#7a4a26', H: '#a06a3a', s: '#eec19c', a: '#4f8a3e', A: '#356329', g: '#7fbf5f', x: '#d8ffb0', p: '#4a3a2e' },
  },
  chisun: {
    head: ['..o.oo.o.o..', '.ohohhohoho.', '.ohHhhhhhho.', '.ogxgoogxgo.', '.ohhhhhhhho.', '.ohhhhhhhho.', '.ohshhhhsho.'],
    face: 'plain', body: 'light', weapon: CROSSBOW,
    colors: { h: '#8a3a22', H: '#c25a32', s: '#d9a57c', g: '#c9a35a', a: '#8a6a3a', A: '#5a4422', x: '#9fe0ff', p: '#3a3a3a' },
  },
  qingluo: {
    head: ['..oao..oao..', '...oooooo...', '.oaoxooxoao.', '.ohaaaaaaho.', 'ohhHhhhhhhho', 'ohhhhhhhhhho', 'ohhsshhsshho'],
    face: 'wide', body: 'robe', weapon: LEAF_STAFF,
    colors: { h: '#3f7a3a', H: '#6fae5a', s: '#f6d3b3', a: '#5fae4e', A: '#3d7a32', g: '#a6e08a', x: '#ff9ec4' },
  },
  mingzhong: {
    head: ['.....oo.....', '....oaao....', '...oaaaao...', '..oaaaaaao..', '.oaaggaaaao.', 'oAAAAAAAAAAAAo', '.ohhhhhhhho.', '.ohhhhhhhho.', '.ohsshhssho.'],
    face: 'plain', body: 'robe', weapon: BELL_STAFF,
    colors: { h: '#3b2a20', H: '#5a4030', s: '#eec19c', a: '#c8a45a', A: '#8a6e34', g: '#ead39a', x: '#fff3b0' },
  },
  // --- T26: six more ---
  yanxi: {
    head: ['.....o......', '....oxo.....', '....oxxo....', '...ooxxoo...', '..oaaaaaao..', '.oaaggaaaao.', '.oaaaaaaaao.', '.oAAAAAAAAo.', '.oAssssssAo.'],
    face: 'plain', body: 'armor', weapon: HORN_LANCE, offhand: SQUARE_SHIELD,
    colors: { h: '#3b3b44', s: '#d9a57c', a: '#8a8f96', A: '#5b6068', g: '#c2c7cc', x: '#f0ead8' },
  },
  moya: {
    head: ['.....oo.....', '....oxxo....', '...oaxxao...', '..oaaaaaao..', '.oaaaaaaaao.', 'oaaaAAAAaaao', 'oaaAhhhhAaao', 'oaAhhhhhhAao', 'oaAsshhssAao'],
    face: 'mask', body: 'light', weapon: FEATHER_BLADE, offhand: { rows: ['.D.', 'yyy', 'owo', 'gxg', '.g.'], grip: [1, 0] },
    colors: { h: '#15151c', s: '#e6c2a0', a: '#24242e', A: '#3e3e56', g: '#6a6aa0', x: '#9a7aff', k: '#101018', p: '#1c1c24' },
  },
  yanwen: {
    head: ['...o.o..o...', '..oxoxooxo..', '..oxxxxxxo..', '...oaaaao...', '..oaaaaaao..', '.oaaggggaao.', 'oAAAAAAAAAAo', '.ohhhhhhhho.', '.ohsshhssho.'],
    face: 'plain', body: 'robe', weapon: EMBER_STAFF,
    colors: { h: '#2a1a14', s: '#f6d3b3', a: '#b8402a', A: '#7a2618', g: '#f08a3a', x: '#ffb347' },
  },
  leixian: {
    head: ['...oooooo...', '..ohhhhhho..', '.ohHhhhhhho.', '.oxxyxxyxxo.', '.ohhhhhhhho.', '.ohhhhhhhho.', '.ohsshhssho.'],
    face: 'plain', body: 'light', weapon: STORM_BOW,
    colors: { h: '#e8e0c8', H: '#ffffff', s: '#eec19c', a: '#5a3a8a', A: '#3a2460', x: '#ffe066', p: '#3a2a4a' },
  },
  quanyin: {
    head: ['..oxo..oxo..', '...oooooo...', '..ohhhhhho..', '.ohHhhhhhho.', 'ohhHhhhhhhho', 'ohhhhhhhhhho', 'ohhsshhsshho'],
    face: 'wide', body: 'robe', weapon: DROP_STAFF,
    colors: { h: '#2f6fa8', H: '#5a9fd8', s: '#f6d3b3', a: '#4f9fd0', A: '#2f6f9a', g: '#e6f6ff', x: '#bff0ff' },
  },
  tongwei: {
    head: ['.....oo.....', '....oyyo....', '....oyyo....', '..oooooooo..', '.oaaaaaaaao.', 'oaayaaaayaao', 'oaaaaaaaaaao', 'oAooooooooAo', '.oAssssssAo.'],
    face: 'plain', body: 'armor', weapon: SHORT_SWORD, offhand: TOWER_SHIELD,
    colors: { h: '#3b2a20', s: '#e0b48c', a: '#b07a3a', A: '#7a5226', g: '#e0b070', x: '#ffe08a' },
  },
};

const BY_ARCHETYPE: Record<Archetype, string> = {
  TANK: 'panyue', ASSASSIN: 'yexiao', MAGE: 'xingzhu', MARKSMAN: 'zhufeng', SUPPORT: 'qingluo',
};

export const HERO_ART_IDS = Object.keys(ART);

// --- grid helpers ----------------------------------------------------------

function blank(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
}

function stamp(g: string[][], rows: Grid, x: number, y: number): void {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]!;
      if (ch === '.') continue;
      const yy = y + dy;
      const xx = x + dx;
      if (yy >= 0 && yy < g.length && xx >= 0 && xx < g[0]!.length) g[yy]![xx] = ch;
    }
  });
}

/** Turns a grid a quarter clockwise; `p` (a point in it) is moved with it. */
export function rotateCW(rows: Grid, p: [number, number] = [0, 0]): { rows: Grid; p: [number, number] } {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const out: Grid = [];
  for (let y = 0; y < w; y++) {
    let line = '';
    for (let x = 0; x < h; x++) line += rows[h - 1 - x]![y] ?? '.';
    out.push(line);
  }
  return { rows: out, p: [h - 1 - p[1], p[0]] };
}

/** Turns a grid a quarter anticlockwise (the top ends up on the left). */
export function rotateCCW(rows: Grid): Grid {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const out: Grid = [];
  for (let y = 0; y < w; y++) {
    let line = '';
    for (let x = 0; x < h; x++) line += rows[x]![w - 1 - y] ?? '.';
    out.push(line);
  }
  return out;
}

/** Leans an upright weapon outwards: each row above the grip shifts right by `f`. */
function lean(w: Weapon): { rows: Grid; grip: [number, number] } {
  const f = w.lean ?? 0;
  if (!f) return { rows: w.rows, grip: w.grip };
  const shifts = w.rows.map((_, y) => Math.round((w.grip[1] - y) * f));
  const lo = Math.min(0, ...shifts);
  const width = Math.max(...w.rows.map((r, y) => r.length + shifts[y]! - lo));
  const rows = w.rows.map((r, y) => ('.'.repeat(shifts[y]! - lo) + r).padEnd(width, '.'));
  return { rows, grip: [w.grip[0] - lo, w.grip[1]] };
}

function place(g: string[][], rows: Grid, grip: [number, number], hand: [number, number]): void {
  stamp(g, rows, hand[0] - grip[0], hand[1] - grip[1]);
}

/** The highest non-empty pixel of a placed weapon (where a spell glows). */
function tipOf(rows: Grid, grip: [number, number], hand: [number, number]): [number, number] {
  for (let y = 0; y < rows.length; y++) {
    const x = [...rows[y]!].findIndex((c) => c !== '.');
    if (x >= 0) return [hand[0] - grip[0] + x, hand[1] - grip[1] + y];
  }
  return hand;
}

function headRows(a: HeroArt): Grid {
  const rows = [...a.head, ...FACES[a.face]];
  return rows.map((r) => (r.length >= 14 ? r : `.${r}.`));
}

function artFor(heroId: string, archetype?: Archetype): HeroArt {
  return ART[heroId] ?? ART[BY_ARCHETYPE[archetype ?? 'TANK']]!;
}

/** The finished frame as rows of palette letters, HERO_W x HERO_H, facing right. */
export function heroRows(heroId: string, frame: HeroFrame, archetype?: Archetype): Grid {
  const a = artFor(heroId, archetype);
  if (frame === 'down') return downRows(a);
  const g = blank(HERO_W, HERO_H);
  const pose = frame === 'attack' ? 'attack' : frame === 'cast' ? 'cast' : 'rest';
  const t = torso(a.body, pose);
  const legs = (a.body === 'robe' ? ROBE_LEGS : LEGS)[frame === 'walkA' || frame === 'walkB' ? frame : 'stand'];
  const head = headRows(a);
  const right: [number, number] = [TORSO_SIDE + t.right[0], BODY_Y + t.right[1]];
  const left: [number, number] = [TORSO_SIDE + t.left[0], BODY_Y + t.left[1]];

  // Weapons held at rest or raised are drawn behind the body; an attack swings in front.
  let weapon: { rows: Grid; grip: [number, number] };
  if (pose === 'attack') weapon = a.weapon.aim ?? (() => { const r = rotateCW(a.weapon.rows, a.weapon.grip); return { rows: r.rows, grip: r.p }; })();
  else if (pose === 'cast') weapon = { rows: a.weapon.rows, grip: a.weapon.grip };
  else weapon = a.weapon.rest ?? lean(a.weapon);

  if (pose === 'rest') place(g, weapon.rows, weapon.grip, right);
  stamp(g, t.rows, TORSO_SIDE, BODY_Y);
  stamp(g, legs.map((r) => r), TORSO_SIDE, BODY_Y + 5);
  stamp(g, head, TORSO_SIDE, BODY_Y - head.length);
  if (pose !== 'rest') place(g, weapon.rows, weapon.grip, right);
  if (a.offhand) place(g, a.offhand.rows, a.offhand.grip, left);
  if (pose === 'cast') {
    const [x, y] = tipOf(weapon.rows, weapon.grip, right);
    stamp(g, ['..x..', '.x.x.', 'x...x', '.x.x.', '..x..'], x - 2, y - 2);
  }
  return g.map((r) => r.join(''));
}

/** Knocked out: the standing figure (without weapons) lying on its back, head to the left. */
function downRows(a: HeroArt): Grid {
  const g = blank(14, HERO_H);
  const t = torso(a.body, 'rest');
  const head = headRows(a);
  const legs = (a.body === 'robe' ? ROBE_LEGS : LEGS).stand;
  stamp(g, t.rows, 0, BODY_Y);
  stamp(g, legs, 0, BODY_Y + 5);
  stamp(g, head, 0, BODY_Y - head.length);
  // Crop to the figure, turn it, and set it on the ground in the middle of the frame.
  const rows = g.map((r) => r.join('')).filter((r) => /[^.]/.test(r));
  const lying = rotateCCW(rows).filter((r) => /[^.]/.test(r));
  const out = blank(HERO_W, HERO_H);
  const w = lying[0]!.length;
  stamp(out, lying, Math.floor((HERO_W - w) / 2), HERO_H - lying.length);
  return out.map((r) => r.join(''));
}

/** Colours for a hero in a team colour. */
export function heroPalette(heroId: string, team: string, archetype?: Archetype): Record<string, string> {
  const a = artFor(heroId, archetype);
  return { ...BASE_COLORS, c: team, C: scale(team, 0.72), t: scale(team, 1.35), H: '#ffffff', ...a.colors };
}

function scale(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${((1 << 24) | (c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).slice(1)}`;
}
