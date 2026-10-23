// The club base, the game's main screen: a two-storey cut-away building in a
// bright pixel-art style, seen at a 2:1 isometric angle. Downstairs is the
// training room; upstairs the lounge and the office, joined by a lift. Drawn
// pixel-exact at a low resolution and scaled up. Players walk to the spot
// their activity gives them; taps on players and on furniture are reported.

import { chibi, lookFor, type ChibiFrame, type ChibiLook } from '../pixel/chibi';
import { fillPoly, makeSprite, mix, outlinedPoly, shade, type Pt } from '../pixel/raster';
import type { Activity, ClubActivity } from './activities';
import type { FacilityId } from '../../core/types';
import type { Hotspot, Marker } from './markers';

export const SCENE_W = 208;
export const SCENE_H = 292;
const TW = 24;
const TH = 12;
const OX = 92;
const OY = 180;
const L = 8; // building length (i)
const D = 6; // building depth (j)
const FH = 116; // height of the ground floor (where the upper floor sits)
const WALL2 = 40; // upper floor wall height
const CJ = 5.3; // front corridor on both floors
const LIFT: Pt = [7.4, 0.75];
const SPEED = 2.2; // tiles per second
const FPS = 30;
const OUT = '#2a1a14';

type Floor = 0 | 1;
/** Objects you can tap, and what they open. */
export type { Hotspot, Marker };
export type Tap = { kind: 'player'; id: string } | { kind: 'hotspot'; name: Hotspot } | null;

export interface SceneExtras {
  titles: number; // championships won (gold cups)
  finals: number; // lost finals (silver cups)
  facilities?: Partial<Record<FacilityId, number>>; // room levels (T22): more furniture at higher levels
}

const z0 = (f: Floor) => (f === 1 ? FH : 0);
const iso = (i: number, j: number, f: Floor = 0): Pt => [OX + (i - j) * (TW / 2), OY + (i + j) * (TH / 2) - z0(f)];
const up = (p: Pt, h: number): Pt => [p[0], p[1] - h];

interface Waypoint { i: number; j: number; f: Floor; lift?: boolean }

interface Figure {
  id: string;
  look: ChibiLook;
  i: number;
  j: number;
  f: Floor;
  path: Waypoint[];
  activity: Activity;
  phase: number;
  flip: boolean;
  inLift: number; // seconds left inside the lift (hidden)
  cheer: boolean;
}

interface Spot { i: number; j: number; f: Floor; pose: 'sit' | 'sleep' | 'sofa' | 'stand' }

const DESKS: Pt[] = [[0.5, 0.5], [2.0, 0.5], [3.5, 0.5], [5.0, 0.5], [0.5, 2.6], [2.0, 2.6], [3.5, 2.6], [5.0, 2.6]];
const SEAT = (d: Pt): Pt => [d[0] + 0.55, d[1] + 1.15];
const BEDS: Pt[] = [[0.35, 3.2], [2.15, 3.2]];
const SPOTS: Record<Activity, Spot[]> = {
  TRAIN: DESKS.map((d) => { const [i, j] = SEAT(d); return { i, j, f: 0, pose: 'sit' }; }),
  REST: [
    ...BEDS.map(([i, j]): Spot => ({ i: i + 0.5, j: j + 0.75, f: 1, pose: 'sleep' })),
    { i: 1.0, j: 1.0, f: 1, pose: 'sofa' }, { i: 1.7, j: 1.0, f: 1, pose: 'sofa' }, { i: 2.4, j: 1.0, f: 1, pose: 'sofa' },
    { i: 3.6, j: 2.6, f: 1, pose: 'stand' }, { i: 3.2, j: 4.6, f: 1, pose: 'stand' }, { i: 1.8, j: 2.4, f: 1, pose: 'stand' },
  ],
  IDLE: [
    { i: 6.3, j: 4.3, f: 0, pose: 'stand' }, { i: 3.9, j: 3.6, f: 1, pose: 'stand' }, { i: 6.6, j: 2.0, f: 0, pose: 'stand' },
    { i: 1.3, j: 2.4, f: 1, pose: 'stand' }, { i: 0.6, j: 4.6, f: 0, pose: 'stand' }, { i: 2.9, j: 2.4, f: 1, pose: 'stand' },
    { i: 4.2, j: 4.7, f: 0, pose: 'stand' }, { i: 3.9, j: 1.6, f: 1, pose: 'stand' },
  ],
  TALK: [{ i: 5.65, j: 3.3, f: 1, pose: 'sit' }],
};
const MANAGER: Spot = { i: 5.65, j: 1.55, f: 1, pose: 'stand' };

// Small icons for the speech bubbles (6x6).
const ICON_PAL = { o: OUT, n: '#3a6fd8', z: '#5a5aa8', r: '#e04848', b: '#5ab0ee', d: '#555555', y: '#f2b84b' };
const ICON_ROWS: Record<string, string[]> = {
  note: ['...nn.', '...n.n', '...n..', '.nnn..', 'nnnn..', '.nn...'],
  zzz: ['zzzz..', '..z...', '.z....', 'zzzz..', '...zz.', '...zz.'],
  bang: ['..rr..', '..rr..', '..rr..', '..rr..', '......', '..rr..'],
  dots: ['......', '......', '......', 'd.d.d.', '......', '......'],
  sweat: ['...b..', '..bb..', '.bbbb.', '.bbbb.', '..bb..', '......'],
  star: ['..y...', '.yyy..', 'yyyyy.', '.yyy..', '.y.y..', '......'],
};
const ICONS = new Map<string, HTMLCanvasElement>();
function icon(name: string): HTMLCanvasElement {
  let c = ICONS.get(name);
  if (!c) { c = makeSprite(ICON_ROWS[name]!, ICON_PAL); ICONS.set(name, c); }
  return c;
}

interface Prop { depth: number; f: Floor; img: HTMLCanvasElement; x: number; y: number; alpha: Uint8ClampedArray; anim?: () => void; hotspot?: Hotspot }
type AddProp = (f: Floor, depth: number, draw: () => void, extra?: { anim?: () => void; hotspot?: Hotspot }) => void;

export class ClubScene {
  private ctx: CanvasRenderingContext2D;
  private figures = new Map<string, Figure>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private color: string;
  private extras: SceneExtras = { titles: 0, finals: 0 };
  private markers: Partial<Record<Hotspot, Marker>> = {};
  private onFrame?: (ms: number) => void;
  private manager: ChibiLook = { hair: 'short', hairColor: '#2b2118', skin: '#f1c9a5', shirt: '#3b4252', accent: '#c0392b', trousers: '#2b2f3a' };
  private sky: HTMLCanvasElement | null = null;
  private layers: { img: HTMLCanvasElement; x: number; y: number }[] = [];
  private props: Prop[] = [];
  private builtFor = '';

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

  /** A room's level (1 when unknown). */
  private lvl(id: FacilityId): number {
    return this.extras.facilities?.[id] ?? 1;
  }

  /** Bouncing marks over furniture that needs attention (unread mail, expiring contracts...). */
  setMarkers(m: Partial<Record<Hotspot, Marker>>): void {
    this.markers = m;
  }

  /** New activities: figures keep their position and walk to their new spot. `cheer` makes everyone celebrate. */
  setActivities(list: ClubActivity[], clubColor: string, cheer = false): void {
    this.color = clubColor;
    const seen = new Set<string>();
    const used: Record<Activity, number> = { TRAIN: 0, REST: 0, IDLE: 0, TALK: 0 };
    list.forEach((a, k) => {
      seen.add(a.playerId);
      const spots = SPOTS[a.activity];
      const s = spots[used[a.activity]++ % spots.length]!;
      let fig = this.figures.get(a.playerId);
      if (!fig) {
        // New signings walk in from the front yard.
        fig = { id: a.playerId, look: lookFor(a.playerId, clubColor), i: 5.3 + (k % 3) * 0.2, j: D + 2.2, f: 0, path: [], activity: a.activity, phase: k * 0.77, flip: false, inLift: 0, cheer: false };
        this.figures.set(a.playerId, fig);
      }
      fig.look = { ...fig.look, shirt: clubColor, accent: shade(clubColor, 1.5) };
      fig.cheer = cheer;
      const goal = fig.path[fig.path.length - 1] ?? { i: fig.i, j: fig.j, f: fig.f };
      if (fig.activity !== a.activity || Math.abs(goal.i - s.i) > 0.01 || Math.abs(goal.j - s.j) > 0.01 || goal.f !== s.f) {
        fig.path = this.route({ i: fig.i, j: fig.j, f: fig.f }, s);
      }
      fig.activity = a.activity;
    });
    for (const id of [...this.figures.keys()]) if (!seen.has(id)) this.figures.delete(id);
  }

  /** Out to the front corridor and along it; between floors by lift. */
  private route(from: Waypoint, to: Spot): Waypoint[] {
    if (Math.abs(from.i - to.i) < 0.05 && Math.abs(from.j - to.j) < 0.05 && from.f === to.f) return [];
    const out: Waypoint[] = [{ i: from.i, j: CJ, f: from.f }];
    if (from.f !== to.f) {
      out.push({ i: LIFT[0], j: CJ, f: from.f }, { i: LIFT[0], j: LIFT[1], f: from.f }, { i: LIFT[0], j: LIFT[1], f: to.f, lift: true }, { i: LIFT[0], j: CJ, f: to.f });
    }
    out.push({ i: to.i, j: CJ, f: to.f }, { i: to.i, j: to.j, f: to.f });
    return out;
  }

  /** What is under a point in scene pixels: a player first, then furniture. */
  tap(x: number, y: number): Tap {
    let best: string | null = null;
    let bestD = 13;
    for (const f of this.figures.values()) {
      if (f.inLift > 0) continue;
      const [sx, sy] = iso(f.i, f.j, f.f);
      const d = Math.hypot(sx - x, sy - 9 - y);
      if (d < bestD) { bestD = d; best = f.id; }
    }
    if (best) return { kind: 'player', id: best };
    this.build();
    const order = [...this.props].sort((a, b) => b.f - a.f || b.depth - a.depth);
    const at = (x: number, y: number): Hotspot | null => {
      for (const p of order) {
        if (!p.hotspot) continue;
        const px = Math.floor(x - p.x);
        const py = Math.floor(y - p.y);
        if (px < 0 || py < 0 || px >= p.img.width || py >= p.img.height) continue;
        if (p.alpha[(py * p.img.width + px) * 4 + 3]! > 0) return p.hotspot;
      }
      return null;
    };
    // Furniture is small on a phone: a tap that just misses still counts (closest ring first).
    for (const r of [0, 2, 4, 6]) {
      for (let k = 0; k < (r ? 8 : 1); k++) {
        const name = at(x + Math.round(Math.cos((k * Math.PI) / 4) * r), y + Math.round(Math.sin((k * Math.PI) / 4) * r));
        if (name) return { kind: 'hotspot', name };
      }
    }
    return null;
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
      if (f.inLift > 0) { f.inLift -= dt; continue; }
      const next = f.path[0];
      if (!next) continue;
      if (next.lift) { f.f = next.f; f.inLift = 0.7; f.path.shift(); continue; }
      const di = next.i - f.i;
      const dj = next.j - f.j;
      const dist = Math.hypot(di, dj);
      const move = SPEED * dt;
      if (Math.abs(di - dj) > 0.01) f.flip = di - dj < 0; // on screen +i is right, +j is left
      if (dist <= move) { f.i = next.i; f.j = next.j; f.f = next.f; f.path.shift(); } else { f.i += (di / dist) * move; f.j += (dj / dist) * move; }
    }
  }

  // -------------------------------------------------------------------------
  // Drawing helpers

  private box(i: number, j: number, w: number, d: number, h: number, top: string, z = 0, f: Floor = 0): void {
    const ctx = this.ctx;
    const a = up(iso(i, j, f), z);
    const b = up(iso(i + w, j, f), z);
    const c = up(iso(i + w, j + d, f), z);
    const e = up(iso(i, j + d, f), z);
    outlinedPoly(ctx, [e, c, up(c, h), up(e, h)], shade(top, 0.78), OUT);
    outlinedPoly(ctx, [c, b, up(b, h), up(c, h)], shade(top, 0.62), OUT);
    outlinedPoly(ctx, [up(a, h), up(b, h), up(c, h), up(e, h)], top, OUT);
  }

  /** A flat panel on the back wall (j = 0) of a floor, from i0 to i1, between heights lo and hi. */
  private back(i0: number, i1: number, lo: number, hi: number, color: string, f: Floor = 0, outline = true): void {
    const a = iso(i0, 0, f);
    const b = iso(i1, 0, f);
    const pts: Pt[] = [up(a, lo), up(b, lo), up(b, hi), up(a, hi)];
    if (outline) outlinedPoly(this.ctx, pts, color, OUT); else fillPoly(this.ctx, pts, color);
  }

  /** A flat panel on the left wall (i = 0) of a floor, from j0 to j1. */
  private left(j0: number, j1: number, lo: number, hi: number, color: string, f: Floor = 0, outline = true): void {
    const a = iso(0, j0, f);
    const b = iso(0, j1, f);
    const pts: Pt[] = [up(a, lo), up(b, lo), up(b, hi), up(a, hi)];
    if (outline) outlinedPoly(this.ctx, pts, color, OUT); else fillPoly(this.ctx, pts, color);
  }

  private tile(i: number, j: number, w: number, d: number, color: string, f: Floor = 0): void {
    fillPoly(this.ctx, [iso(i, j, f), iso(i + w, j, f), iso(i + w, j + d, f), iso(i, j + d, f)], color);
  }

  private px(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private bubble(x: number, y: number, name: string): void {
    const bx = Math.round(x) - 5;
    const by = Math.round(y) - 11;
    this.px(bx, by + 1, 10, 7, OUT);
    this.px(bx + 1, by, 8, 9, OUT);
    this.px(bx + 1, by + 1, 8, 7, '#ffffff');
    this.px(bx + 3, by + 9, 2, 1, OUT);
    this.px(bx + 3, by + 10, 1, 1, OUT);
    this.ctx.drawImage(icon(name), bx + 2, by + 1);
  }

  /** Renders `fn` into an off-screen copy of the scene and returns the drawn part. */
  private capture(fn: () => void): { img: HTMLCanvasElement; x: number; y: number; alpha: Uint8ClampedArray } {
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
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
    const img = document.createElement('canvas');
    img.width = x1 - x0 + 1;
    img.height = y1 - y0 + 1;
    const ictx = img.getContext('2d')!;
    ictx.drawImage(full, x0, y0, img.width, img.height, 0, 0, img.width, img.height);
    return { img, x: x0, y: y0, alpha: ictx.getImageData(0, 0, img.width, img.height).data };
  }

  /** Everything that does not move is drawn once, and again only when the club colour or the trophies change. */
  private build(): void {
    const key = `${this.color}|${this.extras.titles}|${this.extras.finals}|${JSON.stringify(this.extras.facilities ?? {})}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    this.sky = this.capture(() => {
      for (let y = 0; y < SCENE_H; y += 4) this.px(0, y, SCENE_W, 4, mix('#7cc6f2', '#d7eef9', y / SCENE_H));
    }).img;
    this.layers = [this.capture(() => { this.drawYard(); this.drawGround(); }), this.capture(() => this.drawUpper())];
    this.props = [];
    const add: AddProp = (f, depth, draw, extra = {}) => {
      const c = this.capture(draw);
      this.props.push({ depth, f, ...c, ...extra });
    };
    this.addGroundProps(add);
    this.addUpperProps(add);
  }

  private draw(): void {
    this.build();
    const ctx = this.ctx;
    ctx.drawImage(this.sky!, 0, 0);
    for (const [cx, cy, w] of [[20, 14, 22], [120, 6, 30], [190, 26, 18]] as const) {
      const x = ((cx + this.time * 2) % (SCENE_W + 40)) - 20;
      this.px(x, cy, w, 5, '#ffffff');
      this.px(x + 4, cy - 3, w - 10, 3, '#ffffff');
    }
    for (const f of [0, 1] as Floor[]) {
      const layer = this.layers[f]!;
      ctx.drawImage(layer.img, layer.x, layer.y);
      if (f === 0) this.drawScreens(0);
      const items: { depth: number; draw: () => void }[] = this.props.filter((p) => p.f === f).map((p) => ({
        depth: p.depth,
        draw: () => { ctx.drawImage(p.img, p.x, p.y); p.anim?.(); },
      }));
      for (const fig of this.figures.values()) {
        if (fig.f !== f || fig.inLift > 0) continue;
        items.push({ depth: this.figureDepth(fig), draw: () => this.drawFigure(fig) });
      }
      if (f === 1) items.push({ depth: MANAGER.i + MANAGER.j, draw: () => this.drawManager() });
      items.sort((a, b) => a.depth - b.depth);
      for (const it of items) it.draw();
    }
    for (const fig of this.figures.values()) this.drawBubble(fig);
    this.drawMarkers();
  }

  // -------------------------------------------------------------------------
  // Static layers

  private drawYard(): void {
    // Lawn, a stone path to the door, flowers.
    fillPoly(this.ctx, [iso(-1.6, -1.6), iso(L + 1.6, -1.6), iso(L + 1.6, D + 3.4), iso(-1.6, D + 3.4)], '#79b84a');
    for (let k = 0; k < 5; k++) this.tile(4.9, D + 0.3 + k * 0.62, 0.9, 0.42, '#c9c3b5');
    for (let k = 0; k < 36; k++) {
      const gi = ((k * 7.31) % (L + 3)) - 1.4;
      const gj = D + 0.4 + ((k * 3.17) % 2.6);
      if (gi > 4.6 && gi < 6.1) continue;
      const [x, y] = iso(gi, gj);
      const flower = k % 5 === 0 || k % 7 === 0;
      this.px(x, y, flower ? 2 : 1, flower ? 2 : 3, k % 5 === 0 ? '#f6e05e' : k % 7 === 0 ? '#f08aa6' : '#5e9a35');
    }
  }

  private drawGround(): void {
    // Foundation.
    fillPoly(this.ctx, [iso(L, D), iso(L, 0), up(iso(L, 0), -4), up(iso(L, D), -4)], '#8c8c94');
    fillPoly(this.ctx, [iso(0, D), iso(L, D), up(iso(L, D), -4), up(iso(0, D), -4)], '#a7a7ae');
    // Training room carpet and the walkway along the front.
    for (let i = 0; i < L; i++) for (let j = 0; j < D; j++) this.tile(i, j, 1, 1, (i + j) % 2 ? '#5d74a8' : '#6880b4');
    this.tile(0, CJ - 0.45, L, 0.9, '#8792ad');
    if (this.lvl('TRAINING') >= 3) {
      // A rug with a gold border under the desks, in a lighter club colour.
      this.tile(0.25, 0.3, 5.9, 3.9, '#e8c27a');
      this.tile(0.4, 0.45, 5.6, 3.6, mix(this.color, '#ffffff', 0.35));
    }
    // Back walls, tall: the upper floor hides their top.
    for (let i = 0; i < L; i += 0.5) this.back(i, i + 0.5, 0, FH, Math.round(i * 2) % 2 ? '#d7e3f0' : '#e6eef7', 0, false);
    for (let j = 0; j < D; j += 0.5) this.left(j, j + 0.5, 0, FH, Math.round(j * 2) % 2 ? '#c9d6e6' : '#d3deeb', 0, false);
    this.back(0, L, 0, 8, '#a8693c', 0, false);
    this.back(0, L, 8, 9, '#7b4a2a', 0, false);
    this.left(0, D, 0, 8, '#935b33', 0, false);
    this.left(0, D, 8, 9, '#6d4226', 0, false);
    const [cx, cy] = iso(0, 0);
    this.px(cx, cy - FH, 1, FH, OUT);
    // Windows, the club banner and the lift.
    this.window(0.7, 1.9, 0);
    this.back(2.4, 3.2, 12, 42, this.color);
    this.back(2.4, 3.2, 12, 15, shade(this.color, 0.7), 0, false);
    this.star(2.8, 31, 0);
    this.window(3.7, 4.9, 0);
    this.lift(0);
    this.left(4.2, 5.2, 14, 36, '#f2b84b');
    this.left(4.35, 5.05, 18, 32, '#e05a4a', 0, false);
    // Up high: a club mural on the left wall, an LED board on the back wall, bunting.
    this.left(3.0, 5.6, 44, 88, this.color);
    this.left(3.0, 5.6, 44, 50, shade(this.color, 0.7), 0, false);
    this.left(3.0, 5.6, 82, 88, shade(this.color, 1.3), 0, false);
    this.bigStar(0, 4.3, 67);
    this.back(5.15, 6.75, 42, 76, '#22252e');
    this.back(5.25, 6.65, 45, 73, '#14213d', 0, false);
    for (let k = 0; k < 14; k++) {
      const i = 0.2 + k * 0.34;
      const [x, y] = up(iso(i, 0), 43);
      this.px(x, y, 3, 2, ['#e05a4a', '#f2b84b', '#59b36b', '#3a7bd5'][k % 4]!);
      this.px(x + 1, y + 2, 1, 1, ['#e05a4a', '#f2b84b', '#59b36b', '#3a7bd5'][k % 4]!);
    }
  }

  /** A large five-point star centred on the left wall at (j, height). */
  private bigStar(_i: number, j: number, h: number): void {
    const rows = ['.....y.....', '....yyy....', '....yyy....', 'yyyyyyyyyyy', '.yyyyyyyyy.', '..yyyyyyy..', '..yyyyyyy..', '.yyyy.yyyy.', '.yyy...yyy.', 'yy.......yy'];
    const [x, y] = up(iso(0, j), h);
    rows.forEach((r, dy) => { for (let dx = 0; dx < r.length; dx++) if (r[dx] === 'y') this.px(x - 5 + dx, y - 5 + dy, 1, 1, '#ffe680'); });
  }

  /** Animated pictures on the walls: the LED board downstairs, the TV upstairs. */
  private drawScreens(f: Floor): void {
    if (f === 0) {
      const phase = Math.floor(this.time * 1.5) % 3;
      if (phase === 0) { this.back(5.35, 5.95, 50, 68, this.color, 0, false); this.back(6.05, 6.55, 50, 68, '#d9572b', 0, false); }
      else if (phase === 1) for (let k = 0; k < 5; k++) this.back(5.35 + k * 0.25, 5.5 + k * 0.25, 48, 52 + ((k * 7 + Math.floor(this.time * 6)) % 18), '#59b36b', 0, false);
      else { this.back(5.6, 6.4, 55, 63, '#f2b84b', 0, false); this.back(5.85, 6.15, 50, 68, '#f2b84b', 0, false); }
      return;
    }
    this.drawTv();
  }

  private drawUpper(): void {
    // The upper floor slab.
    fillPoly(this.ctx, [iso(L, D, 1), iso(L, 0, 1), up(iso(L, 0, 1), -6), up(iso(L, D, 1), -6)], '#9a8f84');
    fillPoly(this.ctx, [iso(0, D, 1), iso(L, D, 1), up(iso(L, D, 1), -6), up(iso(0, D, 1), -6)], '#b6aca1');
    fillPoly(this.ctx, [up(iso(0, D, 1), -6), up(iso(L, D, 1), -6), up(iso(L, D, 1), -7), up(iso(0, D, 1), -7)], OUT);
    // Lounge planks and office carpet.
    for (let r = 0; r < D * 2; r++) {
      for (let i = -(r % 2); i < 4.4; i += 2) {
        const i0 = Math.max(0, i);
        const i1 = Math.min(4.4, i + 2);
        this.tile(i0, r / 2, i1 - i0, 0.5, (Math.floor(i) + r) % 3 === 0 ? '#c99256' : r % 2 ? '#d6a066' : '#c98f54', 1);
      }
    }
    for (let k = 0; k < 4; k++) for (let j = 0; j < D; j++) this.tile(4.4 + k * 0.9, j, 0.9, 1, (k + j) % 2 ? '#5e9a6e' : '#67a576', 1);
    fillPoly(this.ctx, [iso(4.36, 0, 1), iso(4.44, 0, 1), iso(4.44, D, 1), iso(4.36, D, 1)], '#8a6a4a');
    this.tile(1.2, 1.9, 1.9, 1.1, '#a8403d', 1);
    this.tile(1.32, 2.02, 1.66, 0.86, '#e07a5f', 1);
    if (this.lvl('OFFICE') >= 3) {
      this.tile(4.7, 1.7, 2.3, 2.6, '#a8403d', 1);
      this.tile(4.82, 1.82, 2.06, 2.36, '#c4534a', 1);
    }
    this.tile(5.0, 2.9, 1.6, 1.3, '#e8d9a8', 1);
    this.tile(5.12, 3.02, 1.36, 1.06, '#f3e8c4', 1);
    // Walls with wallpaper per room.
    for (let i = 0; i < L; i += 0.5) {
      const lounge = i < 4.4;
      const odd = Math.round(i * 2) % 2;
      this.back(i, i + 0.5, 0, WALL2, lounge ? (odd ? '#efdcb2' : '#f7e8c6') : (odd ? '#d6e6cc' : '#e4f0dc'), 1, false);
    }
    for (let j = 0; j < D; j += 0.5) this.left(j, j + 0.5, 0, WALL2, Math.round(j * 2) % 2 ? '#e8d3a6' : '#f0deb8', 1, false);
    this.back(0, L, 0, 7, '#a8693c', 1, false);
    this.left(0, D, 0, 7, '#935b33', 1, false);
    // Wall caps and the corner.
    fillPoly(this.ctx, [up(iso(0, 0, 1), WALL2), up(iso(L, 0, 1), WALL2), up(iso(L, -0.2, 1), WALL2), up(iso(0, -0.2, 1), WALL2)], '#8a5a3a');
    fillPoly(this.ctx, [up(iso(-0.2, D, 1), WALL2), up(iso(0, D, 1), WALL2), up(iso(0, -0.2, 1), WALL2), up(iso(-0.2, -0.2, 1), WALL2)], '#7a4e32');
    const [cx, cy] = iso(0, 0, 1);
    this.px(cx, cy - WALL2, 1, WALL2, OUT);
    // Roof sign: the page lays the club name over it.
    this.back(2.0, 6.0, WALL2 + 2, WALL2 + 13, '#5a3a22', 1);
    this.back(2.15, 5.85, WALL2 + 4, WALL2 + 11, '#7a5232', 1, false);
    // Lounge window and TV frame (the picture is animated); office certificate and lift.
    this.window(0.5, 1.6, 1);
    if (this.lvl('LOUNGE') >= 2) {
      // A painting between the window and the TV.
      this.back(1.75, 2.45, 16, 28, '#8a5a34', 1);
      this.back(1.82, 2.38, 18, 26, '#7cc6f2', 1, false);
      this.back(1.82, 2.38, 18, 21, '#59b36b', 1, false);
    }
    this.back(4.7, 5.3, 20, 30, '#f7f1dc', 1);
    this.back(4.8, 5.2, 22, 28, '#e8cf7a', 1, false);
    this.lift(1);
    this.left(2.2, 3.4, 14, 32, '#59b36b', 1);
    this.left(2.35, 3.25, 18, 28, '#2f6fbf', 1, false);
  }

  private window(i0: number, i1: number, f: Floor): void {
    this.back(i0, i1, 14, 36, '#f4f4f4', f);
    this.back(i0 + 0.1, i1 - 0.1, 16, 34, '#9fd8f7', f, false);
    this.back(i0 + 0.1, i1 - 0.1, 27, 34, '#c6ecff', f, false);
    const mid = (i0 + i1) / 2;
    this.back(mid - 0.04, mid + 0.04, 16, 34, '#f4f4f4', f, false);
    this.back(i0 + 0.1, i1 - 0.1, 24, 25, '#f4f4f4', f, false);
  }

  private lift(f: Floor): void {
    this.back(LIFT[0] - 0.5, LIFT[0] + 0.5, 0, 30, '#9aa3b0', f);
    this.back(LIFT[0] - 0.42, LIFT[0] - 0.02, 1, 26, '#c3cad4', f, false);
    this.back(LIFT[0] + 0.02, LIFT[0] + 0.42, 1, 26, '#c3cad4', f, false);
    this.back(LIFT[0] - 0.1, LIFT[0] + 0.1, 32, 35, '#f2b84b', f);
  }

  private star(i: number, h: number, f: Floor): void {
    const [x, y] = up(iso(i, 0, f), h);
    const X = Math.round(x);
    const Y = Math.round(y);
    const rows = ['...y...', '...y...', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', 'yy...yy'];
    rows.forEach((r, dy) => { for (let dx = 0; dx < r.length; dx++) if (r[dx] === 'y') this.px(X - 3 + dx, Y - 3 + dy, 1, 1, '#ffe680'); });
  }

  private drawTv(): void {
    const tv = Math.floor(this.time * 2) % 4;
    this.back(2.7, 3.9, 17, 29, ['#3ea55a', '#46b062', '#3ea55a', '#4fb96b'][tv]!, 1, false);
    this.back(2.9 + (tv % 2) * 0.3, 3.1 + (tv % 2) * 0.3, 21, 23, '#3a7bd5', 1, false);
    this.back(3.5 - (tv % 2) * 0.2, 3.7 - (tv % 2) * 0.2, 23, 25, '#d9572b', 1, false);
  }

  // -------------------------------------------------------------------------
  // Furniture

  private addGroundProps(add: AddProp): void {
    DESKS.forEach(([di, dj], k) => {
      add(0, di + dj + 0.7, () => {
        this.box(di + 0.02, dj + 0.42, 0.08, 0.08, 8, '#7a4a28');
        this.box(di + 1.0, dj + 0.42, 0.08, 0.08, 8, '#7a4a28');
        this.box(di, dj, 1.1, 0.55, 2, '#b87a46', 8);
        this.box(di + 0.85, dj + 0.06, 0.18, 0.3, 9, '#3b3f4c', 10);
        this.box(di + 0.2, dj + 0.07, 0.55, 0.1, 9, '#22252e', 10);
        this.box(di + 0.25, dj + 0.28, 0.45, 0.13, 1, '#e8e8ee', 10);
        if (this.lvl('TRAINING') >= 2) this.box(di + 0.85, dj + 0.3, 0.15, 0.12, 2, '#2b2b33', 10); // headset
      }, {
        hotspot: 'training',
        anim: () => {
          const lit = Math.sin(this.time * 4 + k) > -0.6;
          const [x, y] = iso(di + 0.2, dj + 0.17);
          this.px(x + 2, y - 18, 8, 5, lit ? '#7fe3ff' : '#4fb6e8');
          this.px(x + 3, y - 17, 2, 1, '#ffffff');
          if (this.lvl('TRAINING') >= 2) {
            // RGB light strip along the front edge of the desk.
            const hue = ['#ff5a7a', '#ffd35a', '#5aff9a', '#5ac8ff', '#c95aff'][(Math.floor(this.time * 3) + k) % 5]!;
            const [ax, ay] = iso(di, dj + 0.55);
            const [bx] = iso(di + 1.1, dj + 0.55);
            for (let x2 = Math.ceil(ax); x2 < bx; x2++) this.px(x2, ay - 8 + Math.round((x2 - ax) / 2), 1, 1, hue);
          }
        },
      });
      const [si, sj] = SEAT([di, dj]);
      add(0, si + sj + 0.3, () => {
        this.box(si - 0.04, sj + 0.1, 0.08, 0.08, 4, '#555555');
        this.box(si - 0.18, sj + 0.02, 0.36, 0.3, 3, '#2b2b33', 4);
        this.box(si - 0.2, sj + 0.25, 0.4, 0.08, 8, k % 2 ? '#c0392b' : '#2d6cdf', 6);
        if (this.lvl('TRAINING') >= 3) {
          // Gaming chairs: a tall back with a headrest in the club colour.
          this.box(si - 0.2, sj + 0.25, 0.4, 0.08, 10, this.color, 6);
          this.box(si - 0.12, sj + 0.25, 0.24, 0.08, 2, '#f4f4f4', 14);
        }
      });
    });
    // Tactics whiteboard on the left wall.
    add(0, 0.3 + 1.0 + 0.2, () => {
      this.left(0.9, 3.1, 8, 36, '#7a7f8a');
      this.left(1.0, 3.0, 10, 34, '#fbfbfb', 0, false);
      const dot = (j: number, h: number, c: string) => { const [x, y] = up(iso(0, j), h); this.px(x, y, 2, 2, c); };
      dot(1.3, 28, '#3a7bd5');
      dot(1.8, 20, '#3a7bd5');
      dot(1.5, 15, '#3a7bd5');
      dot(2.5, 27, '#d9572b');
      dot(2.7, 16, '#d9572b');
      for (let k = 0; k < 7; k++) { const [x, y] = up(iso(0, 1.9 + k * 0.08), 18 + k); this.px(x, y, 1, 1, '#4a4a4a'); }
      this.left(1.0, 3.0, 8, 10, '#b8bcc6', 0, false);
    }, { hotspot: 'lineup' });
    // Water cooler and plants.
    add(0, 6.6 + 4.2 + 0.4, () => {
      this.box(6.55, 4.15, 0.3, 0.3, 14, '#d0d6de');
      this.box(6.6, 4.2, 0.2, 0.2, 7, '#7fc8f8', 14);
    });
    add(0, 7.5 + 4.5 + 0.4, () => this.plant(7.45, 4.4, 0));
    add(0, 0.2 + 4.6 + 0.4, () => this.plant(0.15, 4.5, 0));
    // Analysis corner by the big screen (T22): an analyst's desk from level 2, a hologram table at level 3.
    if (this.lvl('ANALYSIS') >= 2) {
      add(0, 6.2 + 1.3 + 0.6, () => {
        this.box(6.2, 1.3, 0.75, 0.45, 8, '#5c6470');
        this.box(6.3, 1.38, 0.35, 0.22, 1, '#22252e', 8);
        this.box(6.32, 1.38, 0.32, 0.04, 5, '#22252e', 9);
        const [x, y] = iso(6.3, 1.42);
        this.px(x + 2, y - 13, 4, 3, '#7fe3ff');
        this.box(6.72, 1.42, 0.18, 0.14, 1, '#f4f4f4', 8); // printouts
      });
    }
    if (this.lvl('ANALYSIS') >= 3) {
      add(0, 6.25 + 2.75 + 0.6, () => {
        this.box(6.25, 2.75, 0.6, 0.5, 6, '#3b3f4c');
        this.box(6.3, 2.8, 0.5, 0.4, 1, '#2a6f8a', 6);
      }, {
        anim: () => {
          // A turning hologram of the match map above the table.
          const [x, y] = up(iso(6.55, 3.0), 9);
          const t = this.time * 2;
          for (let k = 0; k < 6; k++) {
            const a = t + (k * Math.PI) / 3;
            this.px(Math.round(x + Math.cos(a) * 6), Math.round(y - 6 + Math.sin(a) * 2), 1, 1, '#9ff0ff');
          }
          this.px(x - 2, y - 9, 4, 4, Math.sin(t * 2) > 0 ? '#7fe3ff' : '#c6f6ff');
          this.px(x, y - 12, 1, 3, '#9ff0ff');
        },
      });
    }
    // The toolbox in the yard opens the facilities window.
    add(0, 8.1 + D + 0.9 + 0.5, () => {
      this.box(8.1, D + 0.9, 0.6, 0.35, 5, '#d23c3c');
      this.box(8.1, D + 0.9, 0.6, 0.35, 1, '#a82c2c', 5);
      this.box(8.32, D + 1.02, 0.16, 0.1, 2, '#f2b84b', 4);
      this.box(8.25, D + 1.06, 0.3, 0.04, 3, '#2b2b33', 6);
    }, { hotspot: 'facilities' });
    // In the yard: the mailbox, the scouting notice board, a tree.
    add(0, 1.0 + D + 1.0 + 0.5, () => {
      this.box(1.05, D + 1.05, 0.1, 0.1, 10, '#6b4a2b');
      this.box(0.85, D + 0.9, 0.5, 0.35, 8, '#d23c3c', 10);
      this.box(0.85, D + 0.9, 0.5, 0.06, 2, '#f2f2f2', 14);
    }, { hotspot: 'inbox' });
    add(0, 2.6 + D + 1.4 + 0.5, () => {
      this.box(2.6, D + 1.45, 0.08, 0.08, 14, '#6b4a2b');
      this.box(3.7, D + 1.45, 0.08, 0.08, 14, '#6b4a2b');
      this.box(2.5, D + 1.4, 1.4, 0.12, 14, '#c89060', 12);
      for (let k = 0; k < 3; k++) {
        const [x, y] = up(iso(2.75 + k * 0.42, D + 1.52), 24);
        this.px(x - 2, y - 2 + k, 6, 8, ['#fffbe8', '#ffe4e1', '#e8f4ff'][k]!);
        this.px(x - 1, y + k, 4, 1, '#8a7a6a');
        this.px(x - 1, y + 2 + k, 3, 1, '#8a7a6a');
      }
    }, { hotspot: 'market' });
    add(0, 7.0 + D + 1.6 + 0.6, () => this.tree(7.2, D + 1.7));
  }

  private addUpperProps(add: AddProp): void {
    // Lounge: sofa (drawn behind the people on it), beds, coffee table, vending machine, plant.
    add(1, 1.2, () => {
      this.box(0.6, 0.25, 2.3, 0.22, 14, '#c64a3f', 0, 1);
      this.box(0.6, 0.35, 2.3, 0.55, 6, '#d9574a', 0, 1);
      this.box(0.5, 0.3, 0.2, 0.65, 10, '#b5413a', 0, 1);
      this.box(2.85, 0.3, 0.2, 0.65, 10, '#b5413a', 0, 1);
    });
    for (const [bi, bj] of BEDS) {
      add(1, bi + bj + 1.6, () => {
        this.box(bi, bj - 0.05, 1.0, 0.12, 14, '#7a4a28', 0, 1);
        this.box(bi, bj, 1.0, 1.5, 5, '#8a5a34', 0, 1);
        this.box(bi + 0.05, bj + 0.05, 0.9, 1.4, 3, '#f4f4f8', 5, 1);
        this.box(bi + 0.1, bj + 0.1, 0.8, 0.35, 2, '#ffffff', 8, 1);
      });
    }
    add(1, 1.6 + 2.1 + 1.0, () => {
      this.box(1.6, 2.1, 0.9, 0.5, 5, '#8a5a34', 0, 1);
      const [x, y] = up(iso(1.9, 2.3, 1), 5);
      this.px(x, y - 3, 2, 3, '#ffffff');
      this.px(x + 6, y - 1, 2, 3, '#ffffff');
    });
    add(1, 0.1 + 1.6 + 0.8, () => {
      this.box(0.1, 1.5, 0.5, 0.6, 28, '#d23c3c', 0, 1);
      const [x, y] = iso(0.6, 1.5, 1);
      this.px(x - 7, y - 25, 5, 9, '#ffe9a8');
      for (let k = 0; k < 3; k++) this.px(x - 7 + k * 2, y - 13, 1, 2, ['#5ab0ee', '#f2b84b', '#59b36b'][k]!);
    });
    add(1, 4.0 + 0.3 + 0.5, () => this.plant(4.0, 0.25, 1));
    // The TV frame: tapping it opens the schedule.
    add(1, 0.01, () => this.back(2.6, 4.0, 15, 31, '#22252e', 1), { hotspot: 'schedule', anim: () => this.drawScreens(1) });
    // Office: bookshelf (match reports), trophy cabinet (history), safe (finance), desk (contracts), guest chair.
    add(1, 4.6 + 0.2 + 0.5, () => {
      this.box(4.55, 0.2, 0.95, 0.35, 32, '#8a5a34', 0, 1);
      const [x, y] = iso(4.55, 0.55, 1);
      const colors = ['#c0392b', '#2d6cdf', '#f2b84b', '#59b36b', '#9b59b6', '#e67e22'];
      for (let row = 0; row < 3; row++) for (let k = 0; k < 5; k++) this.px(x + 2 + k * 2 + Math.round(k * 0.3), y - 28 + row * 9 + k, 2, 6, colors[(k + row * 2) % colors.length]!);
    }, { hotspot: 'report' });
    add(1, 5.9 + 0.2 + 0.5, () => {
      this.box(5.85, 0.2, 0.6, 0.4, 30, '#6b4a2b', 0, 1);
      const [x, y] = iso(5.85, 0.6, 1);
      this.px(x + 2, y - 27, 5, 22, '#cfe8f7');
      const gold = Math.min(4, this.extras.titles);
      const silver = Math.max(0, Math.min(4 - gold, this.extras.finals));
      for (let k = 0; k < gold + silver; k++) {
        const c = k < gold ? '#f2c230' : '#c9cdd6';
        this.px(x + 3, y - 25 + k * 5, 3, 2, c);
        this.px(x + 4, y - 23 + k * 5, 1, 1, c);
        this.px(x + 3, y - 22 + k * 5, 3, 1, c);
      }
    }, { hotspot: 'history' });
    add(1, 7.5 + 2.3 + 0.5, () => {
      this.box(7.4, 2.2, 0.45, 0.45, 12, '#5c6470', 0, 1);
      const [x, y] = iso(7.4, 2.65, 1);
      this.px(x + 1, y - 9, 3, 3, '#f2c230');
    }, { hotspot: 'finance' });
    add(1, 5.0 + 2.05 + 1.5, () => {
      this.box(5.0, 2.05, 1.3, 0.55, 10, '#a86f3e', 0, 1);
      this.box(5.35, 2.12, 0.5, 0.3, 1, '#3b3f4c', 10, 1);
      this.box(5.4, 2.12, 0.4, 0.06, 6, '#3b3f4c', 11, 1);
      const [x, y] = iso(5.4, 2.18, 1);
      this.px(x + 1, y - 16, 4, 3, '#9fe0ff');
      this.box(6.0, 2.15, 0.15, 0.15, 3, '#f4f4f4', 10, 1);
    }, { hotspot: 'contracts' });
    add(1, 5.65 + 3.3 + 0.3, () => this.box(5.45, 3.55, 0.4, 0.08, 8, '#6d4c8a', 5, 1));
    add(1, 7.5 + 4.5 + 0.4, () => this.plant(7.45, 4.4, 1));
    this.addRoomUpgrades(add);
  }

  /** Furniture that rooms gain as they level up (T22). */
  private addRoomUpgrades(add: AddProp): void {
    const lounge = this.lvl('LOUNGE');
    if (lounge >= 2) {
      // A floor lamp by the sofa.
      add(1, 0.15 + 0.3 + 0.4, () => {
        this.box(0.15, 0.3, 0.2, 0.2, 2, '#5a3a22', 0, 1);
        this.box(0.22, 0.37, 0.06, 0.06, 20, '#3b3f4c', 2, 1);
        this.box(0.12, 0.27, 0.26, 0.26, 6, '#ffe9a8', 22, 1);
      });
    }
    if (lounge >= 3) {
      // An aquarium on the left wall, with fish.
      add(1, 0.02, () => {
        this.left(3.5, 4.8, 18, 32, '#5a6a7a', 1);
        this.left(3.6, 4.7, 20, 30, '#4aa8d8', 1, false);
        this.left(3.6, 4.7, 20, 22, '#e0c890', 1, false);
      }, {
        anim: () => {
          for (let k = 0; k < 3; k++) {
            const j = 3.7 + ((this.time * 0.25 + k * 0.33) % 1) * 0.9;
            const [x, y] = up(iso(0, j, 1), 24 + k * 2);
            this.px(x, y, 2, 1, ['#ff8a3a', '#ffd35a', '#ff5a7a'][k]!);
          }
        },
      });
    }
    const stream = this.lvl('STREAM');
    // Streaming corner in the lounge: a ring light and a phone on a tripod; a desk with a
    // microphone and a LIVE sign from level 2; a green screen and a camera at level 3.
    add(1, 3.95 + 3.0 + 0.3, () => {
      this.box(3.95, 3.0, 0.06, 0.06, 22, '#3b3f4c', 0, 1);
      const [x, y] = up(iso(3.98, 3.03, 1), 24);
      for (let k = 0; k < 10; k++) {
        const a = (k * Math.PI) / 5;
        this.px(Math.round(x + Math.cos(a) * 4), Math.round(y + Math.sin(a) * 4), 1, 1, '#fff6d8');
      }
      this.box(3.5, 3.35, 0.05, 0.05, 12, '#3b3f4c', 0, 1);
      this.box(3.46, 3.31, 0.13, 0.04, 4, '#22252e', 12, 1);
    });
    if (stream >= 2) {
      add(1, 3.4 + 3.8 + 0.6, () => {
        this.box(3.4, 3.8, 0.85, 0.45, 8, '#8a5a34', 0, 1);
        this.box(3.75, 3.82, 0.35, 0.08, 7, '#22252e', 8, 1);
        this.box(3.5, 3.95, 0.06, 0.06, 4, '#c9cdd6', 8, 1);
        this.box(3.47, 3.92, 0.12, 0.12, 2, '#5c6470', 12, 1);
      }, {
        anim: () => {
          const [x, y] = up(iso(3.8, 3.86, 1), 15);
          this.px(x + 1, y - 2, 6, 4, Math.sin(this.time * 5) > -0.3 ? '#ff5a7a' : '#c03a5a');
          // LIVE: a red sign that blinks.
          const [lx, ly] = up(iso(4.2, 3.85, 1), 26);
          const on = Math.floor(this.time * 2) % 2 === 0;
          this.px(lx - 6, ly, 12, 5, on ? '#e8304a' : '#a8202e');
          if (on) for (const dx of [-4, -1, 2]) this.px(lx + dx, ly + 1, 2, 3, '#ffffff');
        },
      });
    }
    if (stream >= 3) {
      add(1, 4.15 + 2.7 + 0.2, () => {
        this.box(4.15, 2.75, 0.08, 0.8, 24, '#3ec46a', 0, 1);
        this.box(3.2, 2.95, 0.05, 0.05, 14, '#3b3f4c', 0, 1);
        this.box(3.12, 2.9, 0.22, 0.16, 5, '#22252e', 14, 1);
        this.box(3.31, 2.95, 0.06, 0.06, 2, '#7fe3ff', 16, 1);
      });
    }
    const office = this.lvl('OFFICE');
    if (office >= 2) {
      // A water dispenser and a second certificate.
      add(1, 6.55 + 0.25 + 0.4, () => {
        this.box(6.55, 0.25, 0.28, 0.28, 14, '#d0d6de', 0, 1);
        this.box(6.6, 0.3, 0.18, 0.18, 7, '#7fc8f8', 14, 1);
        this.back(6.5, 6.85, 22, 32, '#f7f1dc', 1);
        this.back(6.56, 6.79, 24, 30, '#9fd8a7', 1, false);
      });
    }
    if (office >= 3) {
      // A globe on a stand and a gold nameplate on the desk.
      add(1, 4.65 + 3.6 + 0.4, () => {
        this.box(4.7, 3.65, 0.2, 0.2, 2, '#6b4a2b', 0, 1);
        this.box(4.77, 3.72, 0.06, 0.06, 8, '#6b4a2b', 2, 1);
        const [x, y] = up(iso(4.8, 3.75, 1), 14);
        this.px(x - 3, y - 3, 7, 7, OUT);
        this.px(x - 2, y - 2, 5, 5, '#3a7bd5');
        this.px(x - 1, y - 2, 2, 2, '#59b36b');
        this.px(x + 1, y, 2, 2, '#59b36b');
      });
      add(1, 5.0 + 2.05 + 1.6, () => this.box(5.6, 2.5, 0.35, 0.06, 2, '#f2c230', 10, 1));
    }
  }

  private plant(i: number, j: number, f: Floor): void {
    this.box(i, j, 0.3, 0.3, 6, '#b5653a', 0, f);
    const [x, y] = up(iso(i + 0.15, j + 0.15, f), 6);
    const X = Math.round(x);
    const Y = Math.round(y);
    this.px(X - 5, Y - 12, 11, 11, OUT);
    const leaves: [number, number, string][] = [[-4, -11, '#3e9a4a'], [0, -13, '#4fb35a'], [-2, -8, '#2f7d3a'], [2, -9, '#3e9a4a'], [-1, -5, '#4fb35a']];
    for (const [dx, dy, c] of leaves) this.px(X + dx, Y + dy, 4, 4, c);
  }

  private tree(i: number, j: number): void {
    this.box(i, j, 0.25, 0.25, 14, '#7a4a28');
    const [x, y] = up(iso(i + 0.12, j + 0.12), 14);
    const X = Math.round(x);
    const Y = Math.round(y);
    this.px(X - 9, Y - 18, 19, 18, OUT);
    const blobs: [number, number, number, string][] = [[-8, -16, 8, '#3e9a4a'], [0, -17, 9, '#4fb35a'], [-5, -10, 10, '#2f7d3a'], [2, -10, 7, '#3e9a4a'], [-3, -14, 6, '#5fc46a']];
    for (const [dx, dy, s, c] of blobs) this.px(X + dx, Y + dy, s, s, c);
  }

  // -------------------------------------------------------------------------
  // People

  private spotOf(f: Figure): Spot | undefined {
    if (f.path.length > 0) return undefined;
    return SPOTS[f.activity].find((s) => s.f === f.f && Math.abs(s.i - f.i) < 0.05 && Math.abs(s.j - f.j) < 0.05);
  }

  /** Sleepers lie on top of their bed, so they are drawn after it. */
  private figureDepth(f: Figure): number {
    return this.spotOf(f)?.pose === 'sleep' ? f.i + f.j + 1.2 : f.i + f.j + 0.15;
  }

  private drawFigure(f: Figure): void {
    const walking = f.path.length > 0;
    const pose = this.spotOf(f)?.pose ?? 'stand';
    let frame: ChibiFrame = 'stand';
    let dy = 0;
    let crop: number | undefined;
    if (walking) frame = Math.floor(this.time * 6 + f.phase) % 2 ? 'walkA' : 'walkB';
    else if (f.cheer && pose !== 'sleep') { frame = Math.floor(this.time * 4 + f.phase) % 2 ? 'cheer' : 'stand'; dy = frame === 'cheer' ? -2 : 0; }
    else if (pose === 'sit') { frame = Math.floor(this.time * 5 + f.phase) % 2 ? 'typeA' : 'typeB'; dy = -3; }
    else if (pose === 'sleep') { frame = 'sleep'; dy = -6; }
    else if (pose === 'sofa') { crop = 15; dy = -3; }
    const [x, y] = iso(f.i, f.j, f.f);
    if (frame !== 'sleep') this.px(x - 4, y - 1, 8, 2, 'rgba(40,20,10,0.28)');
    const bob = !walking && f.activity === 'IDLE' ? Math.round(Math.sin(this.time * 1.5 + f.phase)) : 0;
    const img = chibi(f.look, frame, f.flip);
    const h = crop ?? img.height;
    this.ctx.drawImage(img, 0, 0, img.width, h, Math.round(x - img.width / 2), Math.round(y - h + dy + bob), img.width, h);
  }

  private drawManager(): void {
    const img = chibi(this.manager, 'stand');
    const [x, y] = iso(MANAGER.i, MANAGER.j, 1);
    this.ctx.drawImage(img, 0, 0, img.width, 15, Math.round(x - img.width / 2), Math.round(y - 17), img.width, 15);
  }

  private drawBubble(f: Figure): void {
    if (f.path.length > 0 || f.inLift > 0) return;
    if (Math.sin(this.time * 0.9 + f.phase * 2.3) <= 0.2 && !f.cheer) return;
    const pose = this.spotOf(f)?.pose;
    const lift = pose === 'sit' ? 18 : pose === 'sleep' ? 10 : 20;
    const name = f.cheer ? 'star' : f.activity === 'TALK' ? 'bang' : f.activity === 'REST' ? 'zzz' : f.activity === 'IDLE' ? 'dots' : 'note';
    const [x, y] = iso(f.i, f.j, f.f);
    this.bubble(x, y - lift, name);
  }

  private drawMarkers(): void {
    const bounce = Math.round(Math.abs(Math.sin(this.time * 3)) * 3);
    for (const [name, m] of Object.entries(this.markers) as [Hotspot, Marker][]) {
      const p = this.props.find((x) => x.hotspot === name);
      if (!p) continue;
      this.bubble(p.x + p.img.width / 2, p.y - 1 - bounce, m);
    }
  }
}
