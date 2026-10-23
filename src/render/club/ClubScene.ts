// The club base in a bright pixel-art style: a cut-away building with a
// training room, a lounge and an office, seen at a 2:1 isometric angle.
// Drawn pixel-exact at a low resolution and scaled up. Chibi players walk
// to the spot their activity gives them; the only input is a tap.

import { chibi, lookFor, type ChibiFrame, type ChibiLook } from '../pixel/chibi';
import { fillPoly, makeSprite, mix, outlinedPoly, shade, type Pt } from '../pixel/raster';
import type { Activity, ClubActivity } from './activities';

export const SCENE_W = 256;
export const SCENE_H = 176;
const TW = 24;
const TH = 12;
const OX = 88;
const OY = 54;
const WALL = 40;
const ROOM_J = 5; // depth of the building
const LEN_I = 12; // length of the building
const WALK_J = 4.35;
const SPEED = 2.2; // tiles per second
const FPS = 30;
const OUT = '#2a1a14';

export interface SceneExtras {
  titles: number; // championships won (gold cups)
  finals: number; // lost finals (silver cups)
}

const iso = (i: number, j: number): Pt => [OX + (i - j) * (TW / 2), OY + (i + j) * (TH / 2)];
const up = (p: Pt, h: number): Pt => [p[0], p[1] - h];

interface Figure {
  id: string;
  look: ChibiLook;
  i: number;
  j: number;
  path: Pt[];
  activity: Activity;
  phase: number;
  flip: boolean;
}

const DESKS: Pt[] = [[0.35, 0.45], [1.5, 0.45], [2.65, 0.45], [3.8, 0.45], [0.35, 2.25], [1.5, 2.25], [2.65, 2.25], [3.8, 2.25]];
const SEAT = (d: Pt): Pt => [d[0] + 0.45, d[1] + 1.05];
const SOFA_SEATS: Pt[] = [[5.75, 0.95], [6.45, 0.95], [7.15, 0.95]];
const BEDS: Pt[] = [[5.3, 2.7], [7.3, 2.7]];
const BED_SPOT = (b: Pt): Pt => [b[0] + 0.5, b[1] + 0.7];
const IDLE_SPOTS: Pt[] = [[8.55, 1.6], [6.3, 2.0], [8.4, 3.9], [5.6, 3.95], [7.7, 1.9], [6.9, 3.95], [8.7, 0.95], [5.5, 1.9]];
const MANAGER: Pt = [10.45, 1.05];
const GUEST: Pt = [10.45, 2.75];

function spotsFor(a: Activity): Pt[] {
  if (a === 'TRAIN') return DESKS.map(SEAT);
  if (a === 'REST') return [...BEDS.map(BED_SPOT), ...SOFA_SEATS, [8.1, 3.3], [6.2, 3.3], [7.8, 0.95]];
  if (a === 'TALK') return [GUEST];
  return IDLE_SPOTS;
}

// Small icons for the speech bubbles (6x6).
const ICON_PAL = { o: OUT, n: '#3a6fd8', z: '#5a5aa8', r: '#e04848', b: '#5ab0ee', d: '#555555' };
const ICON_ROWS: Record<string, string[]> = {
  note: ['...nn.', '...n.n', '...n..', '.nnn..', 'nnnn..', '.nn...'],
  zzz: ['zzzz..', '..z...', '.z....', 'zzzz..', '...zz.', '...zz.'],
  bang: ['..rr..', '..rr..', '..rr..', '..rr..', '......', '..rr..'],
  dots: ['......', '......', '......', 'd.d.d.', '......', '......'],
  sweat: ['...b..', '..bb..', '.bbbb.', '.bbbb.', '..bb..', '......'],
};
const ICONS = new Map<string, HTMLCanvasElement>();
function icon(name: string): HTMLCanvasElement {
  let c = ICONS.get(name);
  if (!c) { c = makeSprite(ICON_ROWS[name]!, ICON_PAL); ICONS.set(name, c); }
  return c;
}

export class ClubScene {
  private ctx: CanvasRenderingContext2D;
  private figures = new Map<string, Figure>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private color: string;
  private extras: SceneExtras = { titles: 0, finals: 0 };
  private onFrame?: (ms: number) => void;
  private manager: ChibiLook = { hair: 'short', hairColor: '#2b2118', skin: '#f1c9a5', shirt: '#3b4252', accent: '#c0392b', trousers: '#2b2f3a' };

  constructor(canvas: HTMLCanvasElement, clubColor: string, onFrame?: (ms: number) => void) {
    canvas.width = SCENE_W;
    canvas.height = SCENE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.color = clubColor;
    this.onFrame = onFrame;
  }

  setExtras(e: SceneExtras): void {
    this.extras = e;
  }

  /** New activities: figures keep their position and walk to their new spot. */
  setActivities(list: ClubActivity[], clubColor: string): void {
    this.color = clubColor;
    const seen = new Set<string>();
    const used: Record<Activity, number> = { TRAIN: 0, REST: 0, IDLE: 0, TALK: 0 };
    list.forEach((a, k) => {
      seen.add(a.playerId);
      const spots = spotsFor(a.activity);
      const target = spots[used[a.activity]++ % spots.length]!;
      let f = this.figures.get(a.playerId);
      if (!f) {
        // New signings walk in through the front of the training room.
        f = { id: a.playerId, look: lookFor(a.playerId, clubColor), i: 0.3, j: WALK_J + 0.3, path: [], activity: a.activity, phase: k * 0.77, flip: false };
        this.figures.set(a.playerId, f);
      }
      f.look = { ...f.look, shirt: clubColor, accent: shade(clubColor, 1.5) };
      const goal = f.path[f.path.length - 1] ?? [f.i, f.j];
      if (f.activity !== a.activity || Math.abs(goal[0] - target[0]) > 0.01 || Math.abs(goal[1] - target[1]) > 0.01) f.path = this.route(f.i, f.j, target);
      f.activity = a.activity;
    });
    for (const id of [...this.figures.keys()]) if (!seen.has(id)) this.figures.delete(id);
  }

  /** Out to the front corridor, along it, and in to the spot. */
  private route(i: number, j: number, to: Pt): Pt[] {
    if (Math.abs(i - to[0]) < 0.05 && Math.abs(j - to[1]) < 0.05) return [];
    return [[i, WALK_J], [to[0], WALK_J], to];
  }

  /** The figure under a point in scene pixels, if any. */
  pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = 14;
    for (const f of this.figures.values()) {
      const [sx, sy] = iso(f.i, f.j);
      const d = Math.hypot(sx - x, sy - 9 - y);
      if (d < bestD) { bestD = d; best = f.id; }
    }
    return best;
  }

  start(): void {
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) { this.last = t; return; }
      const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
      this.last = t;
      this.acc += dt;
      if (this.acc < 1 / FPS) return;
      const step = this.acc;
      this.acc = 0;
      const t0 = performance.now();
      this.update(step);
      this.draw();
      this.onFrame?.(performance.now() - t0);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private update(dt: number): void {
    this.time += dt;
    for (const f of this.figures.values()) {
      const next = f.path[0];
      if (!next) continue;
      const di = next[0] - f.i;
      const dj = next[1] - f.j;
      const dist = Math.hypot(di, dj);
      const move = SPEED * dt;
      // On screen, +i goes right and +j goes left.
      if (Math.abs(di - dj) > 0.01) f.flip = di - dj < 0;
      if (dist <= move) { f.i = next[0]; f.j = next[1]; f.path.shift(); } else { f.i += (di / dist) * move; f.j += (dj / dist) * move; }
    }
  }

  // -------------------------------------------------------------------------
  // Drawing helpers

  /** An outlined isometric box on tile area [i, i+w] x [j, j+d], h pixels tall, raised z pixels. */
  private box(i: number, j: number, w: number, d: number, h: number, top: string, z = 0): void {
    const ctx = this.ctx;
    const a = up(iso(i, j), z);
    const b = up(iso(i + w, j), z);
    const c = up(iso(i + w, j + d), z);
    const e = up(iso(i, j + d), z);
    outlinedPoly(ctx, [e, c, up(c, h), up(e, h)], shade(top, 0.78), OUT);
    outlinedPoly(ctx, [c, b, up(b, h), up(c, h)], shade(top, 0.62), OUT);
    outlinedPoly(ctx, [up(a, h), up(b, h), up(c, h), up(e, h)], top, OUT);
  }

  /** A flat panel on the back wall (j = 0), from i0 to i1 and from height lo to hi. */
  private onBackWall(i0: number, i1: number, lo: number, hi: number, color: string, outline = true): void {
    const a = iso(i0, 0);
    const b = iso(i1, 0);
    const pts: Pt[] = [up(a, lo), up(b, lo), up(b, hi), up(a, hi)];
    if (outline) outlinedPoly(this.ctx, pts, color, OUT); else fillPoly(this.ctx, pts, color);
  }

  /** A flat panel on the left wall (i = 0), from j0 to j1. */
  private onLeftWall(j0: number, j1: number, lo: number, hi: number, color: string, outline = true): void {
    const a = iso(0, j0);
    const b = iso(0, j1);
    const pts: Pt[] = [up(a, lo), up(b, lo), up(b, hi), up(a, hi)];
    if (outline) outlinedPoly(this.ctx, pts, color, OUT); else fillPoly(this.ctx, pts, color);
  }

  private floorTile(i: number, j: number, w: number, d: number, color: string): void {
    fillPoly(this.ctx, [iso(i, j), iso(i + w, j), iso(i + w, j + d), iso(i, j + d)], color);
  }

  private px(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private sprite(img: HTMLCanvasElement, i: number, j: number, dx = 0, dy = 0, sh?: number): void {
    const [x, y] = iso(i, j);
    const h = sh ?? img.height;
    this.ctx.drawImage(img, 0, 0, img.width, h, Math.round(x - img.width / 2 + dx), Math.round(y - h + dy), img.width, h);
  }

  private bubble(i: number, j: number, name: string, lift: number): void {
    const [x, y] = iso(i, j);
    const bx = Math.round(x) - 5;
    const by = Math.round(y) - lift - 11;
    this.px(bx, by + 1, 10, 7, OUT);
    this.px(bx + 1, by, 8, 9, OUT);
    this.px(bx + 1, by + 1, 8, 7, '#ffffff');
    this.px(bx + 3, by + 9, 2, 1, OUT);
    this.px(bx + 3, by + 10, 1, 1, OUT);
    this.ctx.drawImage(icon(name), bx + 2, by + 1);
  }

  // -------------------------------------------------------------------------

  private sky: HTMLCanvasElement | null = null;
  private ground: { img: HTMLCanvasElement; x: number; y: number } | null = null;
  private props: { depth: number; img: HTMLCanvasElement; x: number; y: number; anim?: () => void }[] = [];
  private builtFor = '';

  /** Renders `fn` into an off-screen copy of the scene and returns the drawn part. */
  private capture(fn: () => void): { img: HTMLCanvasElement; x: number; y: number } {
    const full = document.createElement('canvas');
    full.width = SCENE_W;
    full.height = SCENE_H;
    const saved = this.ctx;
    this.ctx = full.getContext('2d')!;
    fn();
    const data = this.ctx.getImageData(0, 0, SCENE_W, SCENE_H).data;
    this.ctx = saved;
    let x0 = SCENE_W, y0 = SCENE_H, x1 = -1, y1 = -1;
    for (let y = 0; y < SCENE_H; y++) {
      for (let x = 0; x < SCENE_W; x++) {
        if (data[(y * SCENE_W + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const img = document.createElement('canvas');
    img.width = Math.max(1, x1 - x0 + 1);
    img.height = Math.max(1, y1 - y0 + 1);
    if (x1 >= 0) img.getContext('2d')!.drawImage(full, x0, y0, img.width, img.height, 0, 0, img.width, img.height);
    return { img, x: x0, y: y0 };
  }

  /** Everything that does not move is drawn once, and again only when the club colour or the trophies change. */
  private build(): void {
    const key = `${this.color}|${this.extras.titles}|${this.extras.finals}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    this.sky = this.capture(() => {
      for (let y = 0; y < SCENE_H; y += 4) this.px(0, y, SCENE_W, 4, mix('#7cc6f2', '#d7eef9', y / SCENE_H));
    }).img;
    this.ground = this.capture(() => {
      fillPoly(this.ctx, [iso(-1.4, -1.4), iso(LEN_I + 1.4, -1.4), iso(LEN_I + 1.4, ROOM_J + 1.8), iso(-1.4, ROOM_J + 1.8)], '#79b84a');
      for (let k = 0; k < 30; k++) {
        const gi = ((k * 7.31) % (LEN_I + 2.4)) - 1.2;
        const gj = ROOM_J + 0.35 + ((k * 3.17) % 1.3);
        const [x, y] = iso(gi, gj);
        const flower = k % 5 === 0 || k % 7 === 0;
        this.px(x, y, flower ? 2 : 1, flower ? 2 : 3, k % 5 === 0 ? '#f6e05e' : k % 7 === 0 ? '#f08aa6' : '#5e9a35');
      }
      fillPoly(this.ctx, [iso(LEN_I, ROOM_J), iso(LEN_I, 0), up(iso(LEN_I, 0), -4), up(iso(LEN_I, ROOM_J), -4)], '#8c8c94');
      fillPoly(this.ctx, [iso(0, ROOM_J), iso(LEN_I, ROOM_J), up(iso(LEN_I, ROOM_J), -4), up(iso(0, ROOM_J), -4)], '#a7a7ae');
      this.drawFloors();
      this.drawWalls();
    });
    this.props = [];
    const add = (depth: number, draw: () => void, anim?: () => void) => {
      const c = this.capture(draw);
      this.props.push({ depth, img: c.img, x: c.x, y: c.y, anim });
    };
    this.addTraining(add);
    this.addLounge(add);
    this.addOffice(add);
  }

  private draw(): void {
    this.build();
    const ctx = this.ctx;
    ctx.drawImage(this.sky!, 0, 0);
    for (const [cx, cy, w] of [[30, 16, 22], [150, 8, 30], [232, 30, 18]] as const) {
      const x = ((cx + this.time * 2) % (SCENE_W + 40)) - 20;
      this.px(x, cy, w, 5, '#ffffff');
      this.px(x + 4, cy - 3, w - 10, 3, '#ffffff');
    }
    ctx.drawImage(this.ground!.img, this.ground!.x, this.ground!.y);
    this.drawTv();
    // Furniture and people, back to front.
    const items: { depth: number; draw: () => void }[] = this.props.map((p) => ({
      depth: p.depth,
      draw: () => { ctx.drawImage(p.img, p.x, p.y); p.anim?.(); },
    }));
    for (const f of this.figures.values()) items.push({ depth: this.figureDepth(f), draw: () => this.drawFigure(f) });
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();
    for (const f of this.figures.values()) this.drawBubble(f);
  }

  private drawTv(): void {
    const tv = Math.floor(this.time * 2) % 4;
    this.onBackWall(7.4, 8.6, 17, 29, ['#3ea55a', '#46b062', '#3ea55a', '#4fb96b'][tv]!, false);
    this.onBackWall(7.6 + (tv % 2) * 0.3, 7.8 + (tv % 2) * 0.3, 21, 23, '#3a7bd5', false);
    this.onBackWall(8.2 - (tv % 2) * 0.2, 8.4 - (tv % 2) * 0.2, 23, 25, '#d9572b', false);
  }

  private drawFloors(): void {
    // Training: blue carpet tiles.
    for (let i = 0; i < 5; i++) for (let j = 0; j < ROOM_J; j++) this.floorTile(i, j, 1, 1, (i + j) % 2 ? '#5d74a8' : '#6880b4');
    // Lounge: wooden planks in staggered rows.
    for (let r = 0; r < ROOM_J * 2; r++) {
      for (let i = 5 - (r % 2); i < 9; i += 2) {
        const i0 = Math.max(5, i);
        const i1 = Math.min(9, i + 2);
        this.floorTile(i0, r / 2, i1 - i0, 0.5, (Math.floor(i) + r) % 3 === 0 ? '#c99256' : r % 2 ? '#d6a066' : '#c98f54');
      }
    }
    // Office: green carpet.
    for (let i = 9; i < LEN_I; i++) for (let j = 0; j < ROOM_J; j++) this.floorTile(i, j, 1, 1, (i + j) % 2 ? '#5e9a6e' : '#67a576');
    // Rugs.
    this.floorTile(6, 1.85, 1.9, 1.15, '#a8403d');
    this.floorTile(6.12, 1.97, 1.66, 0.91, '#e07a5f');
    this.floorTile(9.6, 2.4, 1.8, 1.4, '#e8d9a8');
    this.floorTile(9.72, 2.52, 1.56, 1.16, '#f3e8c4');
    // Sunlight from the windows.
    this.ctx.globalAlpha = 0.16;
    fillPoly(this.ctx, [iso(5.6, 0), iso(6.8, 0), iso(7.6, 1.6), iso(6.4, 1.6)], '#fff8d8');
    fillPoly(this.ctx, [iso(10.95, 0), iso(11.65, 0), iso(12, 1.0), iso(11.6, 1.6)], '#fff8d8');
    this.ctx.globalAlpha = 1;
    // Thresholds between the rooms.
    for (const bi of [5, 9]) fillPoly(this.ctx, [iso(bi - 0.04, 0), iso(bi + 0.04, 0), iso(bi + 0.04, ROOM_J), iso(bi - 0.04, ROOM_J)], '#8a6a4a');
    // Front edge of the floor.
    fillPoly(this.ctx, [iso(0, ROOM_J), iso(LEN_I, ROOM_J), up(iso(LEN_I, ROOM_J), 2), up(iso(0, ROOM_J), 2)], '#3d2a20');
  }

  private drawWalls(): void {
    const zones: [number, number, string, string][] = [[0, 5, '#e6eef7', '#d7e3f0'], [5, 9, '#f7e8c6', '#efdcb2'], [9, LEN_I, '#e4f0dc', '#d6e6cc']];
    for (const [i0, i1, a, b] of zones) {
      for (let i = i0; i < i1; i += 0.5) this.onBackWall(i, i + 0.5, 0, WALL, Math.round(i * 2) % 2 ? b : a, false);
      this.onBackWall(i0, i1, 0, 8, '#a8693c', false); // wainscot
      this.onBackWall(i0, i1, 8, 9, '#7b4a2a', false);
    }
    for (let j = 0; j < ROOM_J; j += 0.5) this.onLeftWall(j, j + 0.5, 0, WALL, Math.round(j * 2) % 2 ? '#c9d6e6' : '#d3deeb', false);
    this.onLeftWall(0, ROOM_J, 0, 8, '#935b33', false);
    this.onLeftWall(0, ROOM_J, 8, 9, '#6d4226', false);
    // Wall caps and the corner.
    fillPoly(this.ctx, [up(iso(0, 0), WALL), up(iso(LEN_I, 0), WALL), up(iso(LEN_I, -0.2), WALL), up(iso(0, -0.2), WALL)], '#8a5a3a');
    fillPoly(this.ctx, [up(iso(-0.2, ROOM_J), WALL), up(iso(0, ROOM_J), WALL), up(iso(0, -0.2), WALL), up(iso(-0.2, -0.2), WALL)], '#7a4e32');
    const [cx, cy] = iso(0, 0);
    this.px(cx, cy - WALL, 1, WALL, OUT);

    // Training room: club banner, tactics whiteboard, clock; posters on the left wall.
    this.onBackWall(0.4, 1.2, 13, 36, this.color);
    this.onBackWall(0.4, 1.2, 13, 16, shade(this.color, 0.7), false);
    this.star(0.8, 27);
    this.onBackWall(1.8, 3.6, 14, 33, '#fbfbfb');
    this.tactics();
    this.onBackWall(4.1, 4.6, 26, 34, '#ffffff');
    this.clockHands(4.35, 30);
    this.onLeftWall(1.0, 2.0, 16, 34, '#f2b84b');
    this.onLeftWall(1.15, 1.85, 20, 30, '#e05a4a', false);
    this.onLeftWall(2.8, 3.8, 16, 34, '#59b36b');
    this.onLeftWall(2.95, 3.65, 21, 31, '#2f6fbf', false);
    // Lounge: window and a TV showing a match.
    this.window(5.5, 6.9);
    this.onBackWall(7.3, 8.7, 15, 31, '#22252e');
    // Office: window and framed certificates.
    this.window(10.9, 11.7);
    this.onBackWall(9.3, 9.9, 20, 30, '#f7f1dc');
    this.onBackWall(9.4, 9.8, 22, 28, '#e8cf7a', false);
    this.onBackWall(10.0, 10.6, 20, 30, '#f7f1dc');
    this.onBackWall(10.1, 10.5, 22, 28, '#9cc3e6', false);
  }

  private window(i0: number, i1: number): void {
    this.onBackWall(i0, i1, 14, 34, '#f4f4f4');
    this.onBackWall(i0 + 0.1, i1 - 0.1, 16, 32, '#9fd8f7', false);
    this.onBackWall(i0 + 0.1, i1 - 0.1, 26, 32, '#c6ecff', false);
    const mid = (i0 + i1) / 2;
    this.onBackWall(mid - 0.04, mid + 0.04, 16, 32, '#f4f4f4', false);
    this.onBackWall(i0 + 0.1, i1 - 0.1, 23, 24, '#f4f4f4', false);
  }

  private star(i: number, h: number): void {
    const [x, y] = up(iso(i, 0), h);
    const X = Math.round(x);
    const Y = Math.round(y);
    // A five-point star, 7x7.
    const rows = ['...y...', '...y...', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', 'yy...yy'];
    rows.forEach((r, dy) => { for (let dx = 0; dx < r.length; dx++) if (r[dx] === 'y') this.px(X - 3 + dx, Y - 3 + dy, 1, 1, '#ffe680'); });
  }

  private tactics(): void {
    const dot = (i: number, h: number, c: string) => { const [x, y] = up(iso(i, 0), h); this.px(x, y, 2, 2, c); };
    dot(2.1, 28, '#3a7bd5');
    dot(2.3, 21, '#3a7bd5');
    dot(2.6, 26, '#3a7bd5');
    dot(3.2, 29, '#d9572b');
    dot(3.3, 21, '#d9572b');
    for (let k = 0; k < 7; k++) { const [x, y] = up(iso(2.4 + k * 0.1, 0), 24 + k * 0.7); this.px(x, y, 1, 1, '#4a4a4a'); }
  }

  private clockHands(i: number, h: number): void {
    const [x, y] = up(iso(i, 0), h);
    this.px(x, y - 2, 1, 3, OUT);
    this.px(x, y, 2, 1, OUT);
  }

  private addTraining(add: (d: number, f: () => void, anim?: () => void) => void): void {
    DESKS.forEach(([di, dj], k) => {
      add(di + dj + 0.6, () => {
        // Legs, desk top, PC tower, monitor and keyboard.
        this.box(di + 0.02, dj + 0.38, 0.08, 0.08, 8, '#7a4a28');
        this.box(di + 0.8, dj + 0.38, 0.08, 0.08, 8, '#7a4a28');
        this.box(di, dj, 0.9, 0.5, 2, '#b87a46', 8);
        this.box(di + 0.72, dj + 0.05, 0.16, 0.3, 9, '#3b3f4c', 10);
        this.box(di + 0.15, dj + 0.06, 0.5, 0.1, 9, '#22252e', 10);
        this.box(di + 0.2, dj + 0.25, 0.4, 0.12, 1, '#e8e8ee', 10);
      }, () => {
        const lit = Math.sin(this.time * 4 + k) > -0.6;
        const [x, y] = iso(di + 0.15, dj + 0.16);
        this.px(x + 2, y - 18, 7, 5, lit ? '#7fe3ff' : '#4fb6e8');
        this.px(x + 3, y - 17, 2, 1, '#ffffff');
      });
      // Gaming chair: its back is between the player and the viewer.
      const [si, sj] = SEAT([di, dj]);
      add(si + sj + 0.3, () => {
        this.box(si - 0.04, sj + 0.1, 0.08, 0.08, 4, '#555555');
        this.box(si - 0.18, sj + 0.02, 0.36, 0.3, 3, '#2b2b33', 4);
        this.box(si - 0.2, sj + 0.25, 0.4, 0.08, 8, k % 2 ? '#c0392b' : '#2d6cdf', 6);
      });
    });
    // PC rack with blinking lights in the corner, and a plant.
    add(0.15 + 4.2 + 0.7, () => {
      this.box(0.15, 4.2, 0.35, 0.35, 18, '#2b2f3a');
    }, () => {
      const [x, y] = iso(0.15, 4.55);
      for (let k = 0; k < 3; k++) this.px(x + 2, y - 14 + k * 3, 1, 1, Math.sin(this.time * 6 + k * 2) > 0 ? '#5df27a' : '#235c30');
    });
    add(4.55 + 0.3 + 0.6, () => this.plant(4.55, 0.3));
  }

  private addLounge(add: (d: number, f: () => void, anim?: () => void) => void): void {
    // Sofa.
    add(6.0, () => { // behind the people sitting on it
      this.box(5.35, 0.25, 2.2, 0.22, 14, '#c64a3f');
      this.box(5.35, 0.35, 2.2, 0.55, 6, '#d9574a');
      this.box(5.25, 0.3, 0.2, 0.65, 10, '#b5413a');
      this.box(7.5, 0.3, 0.2, 0.65, 10, '#b5413a');
    });
    // Coffee table with cups.
    add(6.4 + 2.1 + 1.0, () => {
      this.box(6.4, 2.1, 0.9, 0.5, 5, '#8a5a34');
      const [x, y] = up(iso(6.7, 2.3), 5);
      this.px(x, y - 3, 2, 3, '#ffffff');
      this.px(x + 6, y - 1, 2, 3, '#ffffff');
    });
    // Beds.
    for (const [bi, bj] of BEDS) {
      add(bi + bj + 1.6, () => {
        this.box(bi, bj - 0.05, 1.0, 0.12, 14, '#7a4a28');
        this.box(bi, bj, 1.0, 1.5, 5, '#8a5a34');
        this.box(bi + 0.05, bj + 0.05, 0.9, 1.4, 3, '#f4f4f8', 5);
        this.box(bi + 0.1, bj + 0.1, 0.8, 0.35, 2, '#ffffff', 8);
      });
    }
    // Vending machine and a plant.
    add(8.25 + 0.2 + 1.0, () => {
      this.box(8.25, 0.2, 0.6, 0.5, 28, '#d23c3c');
      const [x, y] = iso(8.25, 0.7);
      this.px(x + 2, y - 25, 5, 9, '#ffe9a8');
      for (let k = 0; k < 3; k++) this.px(x + 2 + k * 2, y - 13, 1, 2, ['#5ab0ee', '#f2b84b', '#59b36b'][k]!);
    });
    add(8.55 + 4.4 + 0.5, () => this.plant(8.55, 4.4));
  }

  private addOffice(add: (d: number, f: () => void, anim?: () => void) => void): void {
    // Bookshelf.
    add(9.25 + 0.2 + 0.5, () => {
      this.box(9.25, 0.2, 1.0, 0.35, 32, '#8a5a34');
      const [x, y] = iso(9.25, 0.55);
      const colors = ['#c0392b', '#2d6cdf', '#f2b84b', '#59b36b', '#9b59b6', '#e67e22'];
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 6; k++) this.px(x + 2 + k * 2 + Math.round(k * 0.3), y - 28 + row * 9 + k, 2, 6, colors[(k + row * 2) % colors.length]!);
      }
    });
    // Trophy cabinet: one gold cup per title, a silver one per lost final.
    add(11.3 + 0.2 + 0.6, () => {
      this.box(11.3, 0.2, 0.6, 0.4, 30, '#6b4a2b');
      const [x, y] = iso(11.3, 0.6);
      this.px(x + 2, y - 27, 5, 22, '#cfe8f7');
      const gold = Math.min(4, this.extras.titles);
      const silver = Math.max(0, Math.min(4 - gold, this.extras.finals));
      for (let k = 0; k < gold + silver; k++) {
        const c = k < gold ? '#f2c230' : '#c9cdd6';
        this.px(x + 3, y - 25 + k * 5, 3, 2, c);
        this.px(x + 4, y - 23 + k * 5, 1, 1, c);
        this.px(x + 3, y - 22 + k * 5, 3, 1, c);
      }
    });
    // You, behind the desk; the desk with a laptop; the guest chair.
    add(MANAGER[0] + MANAGER[1], () => this.sprite(chibi(this.manager, 'stand'), MANAGER[0], MANAGER[1], 0, -2, 15));
    add(9.85 + 1.55 + 1.5, () => {
      this.box(9.85, 1.55, 1.3, 0.55, 10, '#a86f3e');
      this.box(10.2, 1.62, 0.5, 0.3, 1, '#3b3f4c', 10);
      this.box(10.25, 1.62, 0.4, 0.06, 6, '#3b3f4c', 11);
      const [x, y] = iso(10.25, 1.68);
      this.px(x + 1, y - 16, 4, 3, '#9fe0ff');
      this.box(10.85, 1.65, 0.15, 0.15, 3, '#f4f4f4', 10);
    });
    add(GUEST[0] + GUEST[1] + 0.3, () => this.box(GUEST[0] - 0.2, GUEST[1] + 0.25, 0.4, 0.08, 8, '#6d4c8a', 5));
    add(11.55 + 4.4 + 0.5, () => this.plant(11.55, 4.4));
    add(9.35 + 4.2 + 0.6, () => {
      this.box(9.35, 4.2, 0.5, 0.45, 14, '#9aa3b0');
      this.box(9.35, 4.2, 0.5, 0.45, 1, '#c3cad4', 14);
    });
  }

  private plant(i: number, j: number): void {
    this.box(i, j, 0.3, 0.3, 6, '#b5653a');
    const [x, y] = up(iso(i + 0.15, j + 0.15), 6);
    const X = Math.round(x);
    const Y = Math.round(y);
    this.px(X - 5, Y - 12, 11, 11, OUT);
    const leaves: [number, number, string][] = [[-4, -11, '#3e9a4a'], [0, -13, '#4fb35a'], [-2, -8, '#2f7d3a'], [2, -9, '#3e9a4a'], [-1, -5, '#4fb35a']];
    for (const [dx, dy, c] of leaves) this.px(X + dx, Y + dy, 4, 4, c);
  }

  private onBed(f: Figure): boolean {
    return f.path.length === 0 && BEDS.some((b) => { const [si, sj] = BED_SPOT(b); return Math.abs(f.i - si) < 0.05 && Math.abs(f.j - sj) < 0.05; });
  }

  /** Sleepers lie on top of their bed, so they are drawn after it. */
  private figureDepth(f: Figure): number {
    return this.onBed(f) ? f.i + f.j + 1.2 : f.i + f.j + 0.15;
  }

  private drawFigure(f: Figure): void {
    const walking = f.path.length > 0;
    let frame: ChibiFrame = 'stand';
    let dy = 0;
    let crop: number | undefined;
    if (walking) frame = Math.floor(this.time * 6 + f.phase) % 2 ? 'walkA' : 'walkB';
    else if (f.activity === 'TRAIN' || f.activity === 'TALK') { frame = Math.floor(this.time * 5 + f.phase) % 2 ? 'typeA' : 'typeB'; dy = -3; }
    else if (f.activity === 'REST') {
      if (this.onBed(f)) { frame = 'sleep'; dy = -6; } else { crop = 15; dy = -3; }
    }
    const [x, y] = iso(f.i, f.j);
    if (frame !== 'sleep') this.px(x - 4, y - 1, 8, 2, 'rgba(40,20,10,0.28)');
    const bob = !walking && f.activity === 'IDLE' ? Math.round(Math.sin(this.time * 1.5 + f.phase)) : 0;
    this.sprite(chibi(f.look, frame, f.flip), f.i, f.j, 0, dy + bob, crop);
  }

  private drawBubble(f: Figure): void {
    if (f.path.length > 0) return;
    // Bubbles come and go so the scene stays readable.
    if (Math.sin(this.time * 0.9 + f.phase * 2.3) <= 0.2) return;
    const lift = f.activity === 'TRAIN' || f.activity === 'TALK' ? 18 : f.activity === 'REST' ? 10 : 20;
    const name = f.activity === 'TALK' ? 'bang' : f.activity === 'REST' ? 'zzz' : f.activity === 'IDLE' ? 'dots' : 'note';
    this.bubble(f.i, f.j, name, lift);
  }
}
