// Chibi people (big head, small body), 12x18 pixels, drawn from text rows.
// Letters: o outline, h hair, H hair highlight, s skin, e eye, r blush,
// m mouth, c shirt, C shirt shadow, t tie/accent, p trousers, b shoes,
// k keyboard-hand (skin), w white.

import { flipped, makeSprite, shade } from './raster';

const HAIR: Record<string, string[]> = {
  short: [
    '...oooooo...',
    '..ohhhhhho..',
    '.ohHhhhhhho.',
    '.ohHhhhhhho.',
    '.ohhhhhhhho.',
    '.ohsshhssho.',
  ],
  spiky: [
    '..o.oo.o.o..',
    '.ohohhohoho.',
    '.ohHhhhhhho.',
    '.ohHhhhhhho.',
    '.ohhhhhhhho.',
    '.ohshhhhsho.',
  ],
  long: [
    '...oooooo...',
    '..ohhhhhho..',
    '.ohHhhhhhho.',
    'ohhHhhhhhhho',
    'ohhhhhhhhhho',
    'ohhsshhsshho',
  ],
  cap: [
    '...oooooo...',
    '..otttttto..',
    '.otttwwttto.',
    '.ottttttttto',
    '.ohhhhhhhho.',
    '.ohsshhssho.',
  ],
  bun: [
    '....oooo....',
    '...ohhhho...',
    '..oohhhhoo..',
    '.ohHhhhhhho.',
    '.ohhhhhhhho.',
    '.ohsshhssho.',
  ],
};

// Face (rows 6-10), the same for every style; long hair keeps its sides.
const FACE = [
  '.osssssssso.',
  '.osesssseso.',
  '.osesssseso.',
  '.orssmmssro.',
  '..oossssoo..',
];
const FACE_LONG = [
  'ohssssssssho',
  'ohsessssesho',
  'ohsessssesho',
  'ohrssmmssrho',
  'oh.ossssohho',
];

const BODY = [
  '...occcco...',
  '..occtccco..',
  '.osccccccso.',
  '.osCCCCCCso.',
  '..oppppppo..',
];
const LEGS_STAND = ['..opp..ppo..', '..obb..bbo..'];
const LEGS_WALK_A = ['..opp..ppo..', '.obb....bo..'];
const LEGS_WALK_B = ['..opp..ppo..', '..ob....bbo.'];
const BODY_CHEER = [
  'os.occcco.so',
  'osoccccccoso',
  '..occccccso.',
  '..oCCCCCCo..',
  '..oppppppo..',
];

// Seen from behind, sitting at a desk: all hair, arms forward on the keyboard.
const BACK_HEAD = [
  '...oooooo...',
  '..ohhhhhho..',
  '.ohHhhhhhho.',
  '.ohHhhhhhho.',
  '.ohhhhhhhho.',
  '.ohhhhhhhho.',
  '.ohhhhhhhho.',
  '.ohhhhhhhho.',
  '..ohhhhhho..',
  '...oossoo...',
];
const BACK_SIT_A = ['..occcccco..', '.okccccccko.', '.ooCCCCCCoo.', '..oppppppo..'];
const BACK_SIT_B = ['..occcccco..', '.ocCcccccko.', '.ooCCCCCCoo.', '..oppppppo..'];

// Lying in bed (head on the pillow, blanket in the shirt colour), 16x7.
const SLEEP = [
  '.ooooo..........',
  'ohhhhho.........',
  'ohssssoooooooooo',
  'ohsoosscccccccco',
  'ohssssocccccccco',
  '.oossooCCCCCCCCo',
  '...oo..oooooooo.',
];

export type ChibiFrame = 'stand' | 'walkA' | 'walkB' | 'cheer' | 'typeA' | 'typeB' | 'sleep';

export interface ChibiLook {
  hair: keyof typeof HAIR | string;
  hairColor: string;
  skin: string;
  shirt: string;
  accent: string; // tie, collar or cap colour
  trousers: string;
}

function palette(l: ChibiLook): Record<string, string> {
  return {
    o: '#2a1a14', h: l.hairColor, H: shade(l.hairColor, 1.45), s: l.skin, e: '#1b1220', r: '#f08a8a', m: '#b0464a',
    c: l.shirt, C: shade(l.shirt, 0.72), t: l.accent, p: l.trousers, b: '#2b2b33', k: l.skin, w: '#ffffff',
  };
}

function rowsFor(l: ChibiLook, frame: ChibiFrame): string[] {
  if (frame === 'sleep') return SLEEP;
  if (frame === 'typeA' || frame === 'typeB') return [...BACK_HEAD, ...(frame === 'typeA' ? BACK_SIT_A : BACK_SIT_B)];
  const hair = HAIR[l.hair] ?? HAIR.short!;
  const face = l.hair === 'long' ? FACE_LONG : FACE;
  if (frame === 'cheer') return [...hair, ...face, ...BODY_CHEER, ...LEGS_STAND];
  const legs = frame === 'walkA' ? LEGS_WALK_A : frame === 'walkB' ? LEGS_WALK_B : LEGS_STAND;
  return [...hair, ...face, ...BODY, ...legs];
}

const cache = new Map<string, HTMLCanvasElement>();

/** A cached frame for one look; `flip` faces it the other way. */
export function chibi(l: ChibiLook, frame: ChibiFrame, flip = false): HTMLCanvasElement {
  const key = `${l.hair}|${l.hairColor}|${l.skin}|${l.shirt}|${l.accent}|${l.trousers}|${frame}|${flip}`;
  let c = cache.get(key);
  if (!c) {
    c = makeSprite(rowsFor(l, frame), palette(l));
    if (flip) c = flipped(c);
    cache.set(key, c);
  }
  return c;
}

export const HAIR_STYLES = Object.keys(HAIR);
export const HAIR_COLORS = ['#3b2a20', '#1d1d26', '#7a4a26', '#c98f3e', '#5a3d7a', '#b33a3a', '#d9d4c7', '#2f5d8a'];
export const SKINS = ['#f6d3b3', '#eec19c', '#d9a57c', '#b98260'];

/** A stable look for a player id. */
export function lookFor(id: string, shirt: string): ChibiLook {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return {
    hair: HAIR_STYLES[h % HAIR_STYLES.length]!,
    hairColor: HAIR_COLORS[(h >>> 4) % HAIR_COLORS.length]!,
    skin: SKINS[(h >>> 8) % SKINS.length]!,
    shirt,
    accent: shade(shirt, 1.5),
    trousers: ['#2f3a56', '#3a3a3a', '#4a3a2e'][(h >>> 12) % 3]!,
  };
}
