// Where heroes are drawn. The match often keeps several heroes on the very same spot,
// so the view spreads them out, and in a fight puts each team on its own side with
// melee heroes in front and ranged heroes behind. Only the picture moves: these
// offsets never reach the match, so results stay exactly the same.

export interface FormUnit {
  id: string;
  side: 'BLUE' | 'RED';
  x: number; // world units
  y: number;
  melee: boolean;
}
export interface Offset { dx: number; dy: number }

export const CLUSTER = 70; // heroes closer than this are drawn as one group
export const SPACING = 44; // side by side, heroes of a group are drawn at least this far apart (about a body width)
const DEPTH_MELEE = 10; // in a fight each side steps back from the other by this much...
const DEPTH_RANGED = 36; // ...and ranged heroes further
const BEHIND = 16; // with no enemy around, ranged heroes walk this far behind melee ones
const TALL = 1.6; // a gap straight up or down counts this much less than a gap sideways
export const MAX_OFFSET = 60; // never drawn further than this from where the match has them
const FORWARD = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }; // from the blue base towards the red base

const centroid = (us: { x: number; y: number }[]) => ({
  x: us.reduce((a, u) => a + u.x, 0) / us.length,
  y: us.reduce((a, u) => a + u.y, 0) / us.length,
});

/** Target drawing offsets (world units) for living heroes. Same input, same output. */
export function formationOffsets(units: readonly FormUnit[]): Map<string, Offset> {
  const list = [...units].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = new Map<string, Offset>();
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (Math.hypot(list[i]!.x - list[j]!.x, list[i]!.y - list[j]!.y) < CLUSTER) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, FormUnit[]>();
  list.forEach((u, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), u]); });

  for (const group of groups.values()) {
    if (group.length === 1) { out.set(group[0]!.id, { dx: 0, dy: 0 }); continue; }
    const blue = group.filter((u) => u.side === 'BLUE');
    const red = group.filter((u) => u.side === 'RED');
    const fight = blue.length > 0 && red.length > 0;
    let ax = FORWARD.x;
    let ay = FORWARD.y;
    if (fight) {
      const cb = centroid(blue);
      const cr = centroid(red);
      const d = Math.hypot(cr.x - cb.x, cr.y - cb.y);
      if (d > 5) { ax = (cr.x - cb.x) / d; ay = (cr.y - cb.y) / d; }
    }
    const pos = group.map((u) => {
      const toward = u.side === 'BLUE' ? 1 : -1; // the way this hero's team faces
      const back = fight ? (u.melee ? DEPTH_MELEE : DEPTH_RANGED) : u.melee ? 0 : BEHIND;
      return { x: u.x - toward * back * ax, y: u.y - toward * back * ay };
    });
    // Push apart anyone still too close, a few rounds. Sprites and name labels are wider than
    // they are tall apart, so a hero just above another still counts as too close, and the push
    // goes mostly sideways: a group ends up standing in a row.
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const a = pos[i]!;
          const b = pos[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy * TALL);
          if (d >= SPACING) continue;
          let ux = dx;
          const uy = dy * 0.3;
          if (Math.abs(ux) < 0.01) ux = (i + j) % 2 ? 1 : -1; // same spot: one goes left, one right
          const m = Math.hypot(ux, uy);
          const push = (SPACING - d) / 2;
          a.x -= (ux / m) * push; a.y -= (uy / m) * push;
          b.x += (ux / m) * push; b.y += (uy / m) * push;
        }
      }
    }
    group.forEach((u, i) => {
      let dx = pos[i]!.x - u.x;
      let dy = pos[i]!.y - u.y;
      const m = Math.hypot(dx, dy);
      if (m > MAX_OFFSET) { dx *= MAX_OFFSET / m; dy *= MAX_OFFSET / m; }
      out.set(u.id, { dx, dy });
    });
  }
  return out;
}

/** Moves a drawn offset smoothly towards its target; `dt` in seconds. */
export function approach(cur: Offset, target: Offset, dt: number, rate = 6): Offset {
  const k = 1 - Math.exp(-rate * dt);
  return { dx: cur.dx + (target.dx - cur.dx) * k, dy: cur.dy + (target.dy - cur.dy) * k };
}

export interface LabelBox {
  id: string;
  x: number; // screen pixels, horizontal centre
  y: number; // screen pixels, bottom of label
  w: number; // label width in screen pixels
}

export const LABEL_H = 13; // label line height in screen pixels
const LABEL_PAD = 4; // horizontal gap between neighbouring labels

/**
 * Target screen offsets (pixels) for hero name labels so two nearby heroes (e.g. "8 惊蛰" and
 * "8 Lanternfish" walking down the same lane) never print on top of each other.
 */
export function labelOffsets(labels: readonly LabelBox[]): Map<string, Offset> {
  const list = [...labels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: { x: number; y: number; w: number }[] = [];
  const out = new Map<string, Offset>();
  const hits = (x: number, y: number, w: number) =>
    placed.some((p) => Math.abs(x - p.x) < (w + p.w) / 2 + LABEL_PAD && Math.abs(y - p.y) < LABEL_H);

  for (const l of list) {
    let dx = 0;
    let dy = 0;
    if (hits(l.x, l.y, l.w)) {
      const near = placed.find((p) => Math.abs(l.x - p.x) < (l.w + p.w) / 2 + LABEL_PAD && Math.abs(l.y - p.y) < LABEL_H)!;
      const dir = l.x > near.x || (l.x === near.x && placed.length % 2 === 1) ? 1 : -1;
      const need = (l.w + near.w) / 2 + LABEL_PAD - Math.abs(l.x - near.x);
      if (need <= 16 && !hits(l.x + dir * need, l.y, l.w)) {
        dx = dir * need;
      } else {
        for (let step = 1; step <= 6; step++) {
          if (!hits(l.x, l.y - step * LABEL_H, l.w)) { dy = -step * LABEL_H; break; }
        }
      }
    }
    placed.push({ x: l.x + dx, y: l.y + dy, w: l.w });
    out.set(l.id, { dx, dy });
  }
  return out;
}

