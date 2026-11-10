// The club base, the game's main screen: a spacious single-floor Kairosoft-style
// isometric cut-away building (Training Hall in the centre, Lounge & Stream Studio
// on the left, Manager & Staff Office on the right, and a landscaped courtyard in
// front). Drawn pixel-exact at low resolution and scaled up; supports panning/zooming
// in the view layer while keeping exact pixel hit-testing for players and furniture.

import { chibi, lookFor, type ChibiFrame, type ChibiLook } from '../pixel/chibi';
import { fillPoly, makeSprite, mix, outlinedPoly, shade, type Pt } from '../pixel/raster';
import type { Activity, ClubActivity } from './activities';
import type { FacilityId } from '../../core/types';
import { HOTSPOT_LABELS, STUDIO_CJ as CJ, corridorRoute, type Hotspot, type Marker } from './markers';

export const SCENE_W = 300;
export const SCENE_H = 200;
const TW = 20;
const TH = 10;
const OX = 114;
const OY = 66;
const L = 15; // total building length along i (3 rooms side by side)
const D = 6.0; // building depth along j
const WALL_H = 38; // back & side wall height
const PART_D = 4.3; // partition walls stop before the front corridor (j = 4.3..6.0 is open archway)
const R1 = 4.6; // Room 1 (Lounge/Stream) -> Room 2 (Training Hall) partition i
const R2 = 10.2; // Room 2 (Training Hall) -> Room 3 (Office) partition i
const SPEED = 3.4; // tiles per second
const OUT = '#2a1a14';

/** Objects you can tap, and what they open. */
export type { Hotspot, Marker };
export type Tap = { kind: 'player'; id: string } | { kind: 'hotspot'; name: Hotspot } | null;

export interface SceneExtras {
  titles: number; // championships won (gold cups)
  finals: number; // lost finals (silver cups)
  facilities?: Partial<Record<FacilityId, number>>; // room levels (T22): more furniture at higher levels
  staff?: string[]; // ids of hired staff (P3): each gets a seat at the staff desk in the office
  branches?: ('FPS' | 'CARD')[]; // opened sister divisions (P4): shown as plaques flanking the roof sign & courtyard stations
}

export interface HotspotSpot {
  hotspot: Hotspot;
  label: string;
  x: number;
  y: number;
}

const iso = (i: number, j: number): Pt => [OX + (i - j) * (TW / 2), OY + (i + j) * (TH / 2)];
const up = (p: Pt, h: number): Pt => [p[0], p[1] - h];

interface Waypoint { i: number; j: number }

interface Figure {
  id: string;
  look: ChibiLook;
  i: number;
  j: number;
  path: Waypoint[];
  activity: Activity;
  phase: number;
  flip: boolean;
  cheer: boolean;
}

interface Spot { i: number; j: number; pose: 'sit' | 'sleep' | 'sofa' | 'stand' }

// 8 gaming desks in the central Training Hall (i = 4.6..10.2)
const DESKS: Pt[] = [
  [5.0, 0.55], [6.2, 0.55], [7.4, 0.55], [8.6, 0.55],
  [5.0, 2.55], [6.2, 2.55], [7.4, 2.55], [8.6, 2.55],
];
const SEAT = (d: Pt): Pt => [d[0] + 0.5, d[1] + 1.05];
// 2 beds in the left Lounge (i = 0..4.6)
const BEDS: Pt[] = [[0.35, 3.0], [1.75, 3.0]];

const SPOTS: Record<Activity, Spot[]> = {
  TRAIN: DESKS.map((d) => { const [i, j] = SEAT(d); return { i, j, pose: 'sit' }; }),
  REST: [
    ...BEDS.map(([i, j]): Spot => ({ i: i + 0.45, j: j + 0.7, pose: 'sleep' })),
    { i: 0.95, j: 0.95, pose: 'sofa' }, { i: 1.65, j: 0.95, pose: 'sofa' }, { i: 2.35, j: 0.95, pose: 'sofa' },
    { i: 3.3, j: 2.1, pose: 'stand' }, { i: 2.8, j: 4.5, pose: 'stand' }, { i: 1.5, j: 2.3, pose: 'stand' },
  ],
  IDLE: [
    { i: 8.8, j: 4.7, pose: 'stand' }, { i: 3.6, j: 4.6, pose: 'stand' }, { i: 9.5, j: 4.3, pose: 'stand' },
    { i: 1.3, j: 4.8, pose: 'stand' }, { i: 6.2, j: 4.8, pose: 'stand' }, { i: 11.2, j: 4.8, pose: 'stand' },
    { i: 7.5, j: 4.8, pose: 'stand' }, { i: 3.8, j: 1.8, pose: 'stand' },
  ],
  TALK: [{ i: 11.55, j: 3.15, pose: 'sit' }],
};
const MANAGER: Spot = { i: 11.55, j: 1.5, pose: 'stand' };
/** Seats behind the staff desk in the right-hand Office, one per hired staff member (P3). */
const STAFF_SEATS: [number, number][] = [[12.15, 4.15], [13.0, 4.15], [13.85, 4.15]];
const STAFF_DESK_DEPTH = 11.9 + 4.45 + 1.2;

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

interface Prop { depth: number; img: HTMLCanvasElement; x: number; y: number; alpha: Uint8ClampedArray; anim?: () => void; hotspot?: Hotspot }
type AddProp = (depth: number, draw: () => void, extra?: { anim?: () => void; hotspot?: Hotspot }) => void;

export class ClubScene {
  private ctx: CanvasRenderingContext2D;
  private figures = new Map<string, Figure>();
  private raf = 0;
  private last = 0;
  private time = 0;
  private color: string;
  private extras: SceneExtras = { titles: 0, finals: 0 };
  private markers: Partial<Record<Hotspot, Marker>> = {};
  private onFrame?: (ms: number) => void;
  private manager: ChibiLook = { hair: 'short', hairColor: '#2b2118', skin: '#f1c9a5', shirt: '#3b4252', accent: '#c0392b', trousers: '#2b2f3a' };
  private sky: HTMLCanvasElement | null = null;
  private baseLayer: { img: HTMLCanvasElement; x: number; y: number } | null = null;
  private props: Prop[] = [];
  private propsDesc: Prop[] = [];
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

  /** Returns the screen positions of key interactive hotspots so the UI can overlay optional Kairosoft labels. */
  hotspotSpots(): HotspotSpot[] {
    this.build();
    const seen = new Set<Hotspot>();
    const out: HotspotSpot[] = [];
    for (const p of this.props) {
      if (!p.hotspot || seen.has(p.hotspot)) continue;
      seen.add(p.hotspot);
      out.push({
        hotspot: p.hotspot,
        label: HOTSPOT_LABELS[p.hotspot],
        x: Math.round(p.x + p.img.width / 2),
        y: Math.round(p.y),
      });
    }
    return out;
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
        // New signings walk in from the front courtyard path.
        fig = {
          id: a.playerId,
          look: lookFor(a.playerId, clubColor),
          i: 7.1 + (k % 3) * 0.25,
          j: D + 1.8,
          path: [],
          activity: a.activity,
          phase: k * 0.77,
          flip: false,
          cheer: false,
        };
        this.figures.set(a.playerId, fig);
      }
      fig.look = { ...fig.look, shirt: clubColor, accent: shade(clubColor, 1.5) };
      fig.cheer = cheer;
      const goal = fig.path[fig.path.length - 1] ?? { i: fig.i, j: fig.j };
      if (fig.activity !== a.activity || Math.abs(goal.i - s.i) > 0.01 || Math.abs(goal.j - s.j) > 0.01) {
        fig.path = corridorRoute({ i: fig.i, j: fig.j }, s);
      }
      fig.activity = a.activity;
    });
    for (const id of [...this.figures.keys()]) if (!seen.has(id)) this.figures.delete(id);
  }

  /** What is under a point in scene pixels: a player first, then furniture. */
  tap(x: number, y: number): Tap {
    let best: string | null = null;
    let bestD = 12;
    for (const f of this.figures.values()) {
      const [sx, sy] = iso(f.i, f.j);
      const d = Math.hypot(sx - x, sy - 9 - y);
      if (d < bestD) { bestD = d; best = f.id; }
    }
    if (best) return { kind: 'player', id: best };
    this.build();
    const at = (px0: number, py0: number): Hotspot | null => {
      for (const p of this.propsDesc) {
        if (!p.hotspot) continue;
        const px = Math.floor(px0 - p.x);
        const py = Math.floor(py0 - p.y);
        if (px < 0 || py < 0 || px >= p.img.width || py >= p.img.height) continue;
        if (p.alpha[(py * p.img.width + px) * 4 + 3]! > 0) return p.hotspot;
      }
      return null;
    };
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
      const dt = Math.min(0.1, Math.max(0, (t - (this.last || t)) / 1000));
      this.last = t;
      const t0 = performance.now();
      this.update(dt);
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
      const di = next.i - f.i;
      const dj = next.j - f.j;
      const dist = Math.hypot(di, dj);
      const move = SPEED * dt;
      if (Math.abs(di - dj) > 0.01) f.flip = di - dj < 0;
      if (dist <= move) { f.i = next.i; f.j = next.j; f.path.shift(); } else { f.i += (di / dist) * move; f.j += (dj / dist) * move; }
    }
  }

  // -------------------------------------------------------------------------
  // Drawing helpers

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

  /** A flat panel on the back wall (j = 0), from i0 to i1, between heights lo and hi. */
  private back(i0: number, i1: number, lo: number, hi: number, color: string, outline = true): void {
    const a = iso(i0, 0);
    const b = iso(i1, 0);
    const pts: Pt[] = [up(a, lo), up(b, lo), up(b, hi), up(a, hi)];
    if (outline) outlinedPoly(this.ctx, pts, color, OUT); else fillPoly(this.ctx, pts, color);
  }

  /** A flat panel on a wall parallel to j at coordinate `iWall` (defaults to 0 = left outer wall). */
  private sideWall(iWall: number, j0: number, j1: number, lo: number, hi: number, color: string, outline = true): void {
    const a = iso(iWall, j0);
    const b = iso(iWall, j1);
    const pts: Pt[] = [up(a, lo), up(b, lo), up(b, hi), up(a, hi)];
    if (outline) outlinedPoly(this.ctx, pts, color, OUT); else fillPoly(this.ctx, pts, color);
  }

  private tile(i: number, j: number, w: number, d: number, color: string): void {
    fillPoly(this.ctx, [iso(i, j), iso(i + w, j), iso(i + w, j + d), iso(i, j + d)], color);
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

  /** Everything that does not move is drawn once, and rebuilt only when club colour, rooms, or trophies change. */
  private build(): void {
    const key = `${this.color}|${this.extras.titles}|${this.extras.finals}|${JSON.stringify(this.extras.facilities ?? {})}|${JSON.stringify(this.extras.branches ?? [])}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    this.sky = this.capture(() => {
      for (let y = 0; y < SCENE_H; y += 4) this.px(0, y, SCENE_W, 4, mix('#74c2f0', '#dff2fc', y / SCENE_H));
    }).img;
    this.baseLayer = this.capture(() => {
      this.drawYard();
      this.drawBuildingShell();
    });
    this.props = [];
    const add: AddProp = (depth, draw, extra = {}) => {
      const c = this.capture(draw);
      this.props.push({ depth, ...c, ...extra });
    };
    this.addInteriorPartitions(add);
    this.addLoungeProps(add);
    this.addTrainingProps(add);
    this.addOfficeProps(add);
    this.addYardProps(add);
    this.props.sort((a, b) => a.depth - b.depth);
    this.propsDesc = [...this.props].reverse();
  }

  private draw(): void {
    this.build();
    const ctx = this.ctx;
    ctx.drawImage(this.sky!, 0, 0);
    for (const [cx, cy, w] of [[24, 12, 24], [140, 7, 32], [250, 18, 20]] as const) {
      const x = ((cx + this.time * 2) % (SCENE_W + 40)) - 20;
      this.px(x, cy, w, 4, '#ffffff');
      this.px(x + 4, cy - 2, w - 8, 2, '#ffffff');
    }
    if (this.baseLayer) ctx.drawImage(this.baseLayer.img, this.baseLayer.x, this.baseLayer.y);
    this.drawWallScreens();

    const dyn: { depth: number; fig?: Figure; staffId?: string; staffIdx?: number; mgr?: boolean }[] = [];
    for (const fig of this.figures.values()) dyn.push({ depth: this.figureDepth(fig), fig });
    dyn.push({ depth: MANAGER.i + MANAGER.j, mgr: true });
    (this.extras.staff ?? []).forEach((id, k) => {
      dyn.push({ depth: STAFF_DESK_DEPTH - 0.1 - k * 0.01, staffId: id, staffIdx: k });
    });
    dyn.sort((a, b) => a.depth - b.depth);

    const drawDyn = (d: (typeof dyn)[number]) => {
      if (d.fig) this.drawFigure(d.fig);
      else if (d.mgr) this.drawManager();
      else if (d.staffId !== undefined) this.drawStaff(d.staffId, d.staffIdx!);
    };
    let di = 0;
    for (const p of this.props) {
      while (di < dyn.length && dyn[di]!.depth <= p.depth) drawDyn(dyn[di++]!);
      ctx.drawImage(p.img, p.x, p.y);
      p.anim?.();
    }
    while (di < dyn.length) drawDyn(dyn[di++]!);

    for (const fig of this.figures.values()) this.drawBubble(fig);
    this.drawMarkers();
  }

  // -------------------------------------------------------------------------
  // Static layers: Kairosoft courtyard + single-floor 3-room studio

  private drawYard(): void {
    // Rich green grass surrounding the studio, stone walkways, hedge border, and flowers.
    fillPoly(this.ctx, [iso(-1.1, -0.9), iso(L + 1.0, -0.9), iso(L + 1.0, D + 2.6), iso(-1.1, D + 2.6)], '#76b848');
    // Outer hedge trim along back-left and back-right lawn edges.
    fillPoly(this.ctx, [iso(-1.0, -0.8), iso(L + 0.9, -0.8), iso(L + 0.9, -0.45), iso(-1.0, -0.45)], '#5c9c34');
    // Front sidewalk pavement strip along the bottom of the yard.
    this.tile(-0.8, D + 1.85, L + 1.6, 0.65, '#d6cfc2');
    this.tile(-0.8, D + 1.8, L + 1.6, 0.08, '#b5ada0');
    // Stone stepping path from the sidewalk to the central entrance door (i = 6.8..8.0).
    for (let k = 0; k < 4; k++) {
      this.tile(6.85, D + 0.18 + k * 0.42, 1.1, 0.3, '#cfc8b8');
      this.tile(6.95, D + 0.22 + k * 0.42, 0.9, 0.22, '#e2dcd0');
    }
    // Welcome mat at the front doorway.
    this.tile(6.75, D - 0.05, 1.3, 0.32, shade(this.color, 0.85));
    this.tile(6.85, D, 1.1, 0.22, this.color);
    // Decorative flowers and grass tufts across the front lawn.
    for (let k = 0; k < 48; k++) {
      const gi = ((k * 7.31) % (L + 1.4)) - 0.6;
      const gj = D + 0.25 + ((k * 3.17) % 1.45);
      if (gi > 6.4 && gi < 8.4) continue;
      const [x, y] = iso(gi, gj);
      const flower = k % 4 === 0 || k % 7 === 0;
      this.px(x, y, flower ? 2 : 1, flower ? 2 : 2, k % 4 === 0 ? '#ffe055' : k % 7 === 0 ? '#ff8aa6' : '#589632');
    }
  }

  private drawBuildingShell(): void {
    // Raised foundation slab with crisp Kairosoft brick-concrete edge.
    fillPoly(this.ctx, [iso(L, D), iso(L, 0), up(iso(L, 0), -5), up(iso(L, D), -5)], '#827c75');
    fillPoly(this.ctx, [iso(0, D), iso(L, D), up(iso(L, D), -5), up(iso(0, D), -5)], '#9e978e');
    fillPoly(this.ctx, [up(iso(0, D), -5), up(iso(L, D), -5), up(iso(L, D), -6), up(iso(0, D), -6)], OUT);

    // 1) Left Room (i = 0 .. R1): Warm Kairosoft wooden planks for the Lounge & Stream Studio.
    for (let r = 0; r < D * 2; r++) {
      for (let i = -(r % 2); i < R1; i += 2) {
        const i0 = Math.max(0, i);
        const i1 = Math.min(R1, i + 2);
        this.tile(i0, r / 2, i1 - i0, 0.5, (Math.floor(i) + r) % 3 === 0 ? '#cfa068' : r % 2 ? '#dcb07a' : '#c6955c');
      }
    }
    // Cozy rug under the Lounge coffee table.
    this.tile(1.05, 1.55, 1.75, 1.05, '#b54540');
    this.tile(1.17, 1.67, 1.51, 0.81, '#e48366');

    // 2) Centre Room (i = R1 .. R2): Pro Esports Training Hall blue checkered floor.
    for (let i = R1; i < R2; i += 0.7) {
      const w = Math.min(0.7, R2 - i);
      for (let j = 0; j < D; j += 0.75) {
        const d = Math.min(0.75, D - j);
        const odd = (Math.round((i - R1) / 0.7) + Math.round(j / 0.75)) % 2;
        this.tile(i, j, w, d, odd ? '#5c76ab' : '#6a84ba');
      }
    }
    if (this.lvl('TRAINING') >= 3) {
      // Gold-bordered team carpet under the 8 gaming desks.
      this.tile(4.85, 0.35, 5.1, 3.65, '#ecc878');
      this.tile(5.0, 0.5, 4.8, 3.35, mix(this.color, '#ffffff', 0.38));
    }

    // 3) Right Room (i = R2 .. L): Executive Office & Trophy Hall green checkered carpet.
    for (let i = R2; i < L; i += 0.8) {
      const w = Math.min(0.8, L - i);
      for (let j = 0; j < D; j += 0.75) {
        const d = Math.min(0.75, D - j);
        const odd = (Math.round((i - R2) / 0.8) + Math.round(j / 0.75)) % 2;
        this.tile(i, j, w, d, odd ? '#5b986c' : '#68a678');
      }
    }
    if (this.lvl('OFFICE') >= 3) {
      this.tile(10.75, 1.65, 2.3, 2.3, '#a8403d');
      this.tile(10.87, 1.77, 2.06, 2.06, '#c8564c');
    }
    // Cream mat under the negotiation chair.
    this.tile(11.0, 2.75, 1.5, 1.15, '#e8d9a8');
    this.tile(11.1, 2.85, 1.3, 0.95, '#f5eccb');

    // Continuous front indoor corridor runner connecting all 3 rooms (j = 4.85 .. 5.65).
    this.tile(0.15, CJ - 0.4, L - 0.3, 0.8, '#8d98b3');
    this.tile(0.15, CJ - 0.3, L - 0.3, 0.6, '#9da8c2');
    // Room threshold strips at R1 and R2.
    this.tile(R1 - 0.06, 0, 0.12, D, '#7a5434');
    this.tile(R2 - 0.06, 0, 0.12, D, '#7a5434');

    // Back wall (j = 0) with room-specific Kairosoft wallpaper panels.
    for (let i = 0; i < L; i += 0.5) {
      const odd = Math.round(i * 2) % 2;
      const c = i < R1
        ? (odd ? '#f0deb6' : '#f8ead0') // Warm cream in Lounge
        : i < R2
          ? (odd ? '#d6e3f2' : '#e5effa') // Crisp sky-blue in Training Hall
          : (odd ? '#d6e8ce' : '#e4f2de'); // Mint-ivory in Office
      this.back(i, i + 0.5, 0, WALL_H, c, false);
    }
    // Left outer wall (i = 0).
    for (let j = 0; j < D; j += 0.5) {
      this.sideWall(0, j, j + 0.5, 0, WALL_H, Math.round(j * 2) % 2 ? '#e9d5aa' : '#f2e1bc', false);
    }
    // Wood wainscot baseboard along back and left walls.
    this.back(0, L, 0, 7, '#a8693c', false);
    this.back(0, L, 7, 8, '#7b4a2a', false);
    this.sideWall(0, 0, D, 0, 7, '#935b33', false);
    this.sideWall(0, 0, D, 7, 8, '#6d4226', false);

    // Top wall timber caps (classic Kairosoft cutaway wall top border).
    fillPoly(this.ctx, [up(iso(0, 0), WALL_H), up(iso(L, 0), WALL_H), up(iso(L, -0.22), WALL_H), up(iso(0, -0.22), WALL_H)], '#8a5a3a');
    fillPoly(this.ctx, [up(iso(-0.22, D), WALL_H), up(iso(0, D), WALL_H), up(iso(0, -0.22), WALL_H), up(iso(-0.22, -0.22), WALL_H)], '#7a4e32');
    const [cx, cy] = iso(0, 0);
    this.px(cx, cy - WALL_H, 1, WALL_H, OUT);

    // Lounge back wall decorations: window & Lv2 landscape painting.
    this.window(0.45, 1.55);
    if (this.lvl('LOUNGE') >= 2) {
      this.back(1.75, 2.45, 15, 27, '#8a5a34');
      this.back(1.82, 2.38, 17, 25, '#7cc6f2', false);
      this.back(1.82, 2.38, 17, 20, '#59b36b', false);
    }
    // Left wall poster in Lounge.
    this.sideWall(0, 0.9, 2.1, 13, 31, '#59b36b');
    this.sideWall(0, 1.05, 1.95, 16, 28, '#2f6fbf', false);

    // Training Hall back wall decorations: club banner with star, window, LED board frame, bunting flags.
    this.back(6.45, 7.25, 11, 34, this.color);
    this.back(6.45, 7.25, 11, 14, shade(this.color, 0.7), false);
    this.star(6.85, 24);
    this.window(7.45, 8.45);
    this.back(8.65, 10.05, 12, 33, '#22252e');
    this.back(8.75, 9.95, 14, 31, '#14213d', false);
    for (let k = 0; k < 15; k++) {
      const i = R1 + 0.25 + k * 0.35;
      const [x, y] = up(iso(i, 0), 35);
      const col = ['#e05a4a', '#f2b84b', '#59b36b', '#3a7bd5'][k % 4]!;
      this.px(x, y, 3, 2, col);
      this.px(x + 1, y + 2, 1, 1, col);
    }

    // Office back wall certificates.
    this.back(12.6, 13.3, 18, 29, '#f7f1dc');
    this.back(12.7, 13.2, 20, 27, '#e8cf7a', false);
  }

  private window(i0: number, i1: number): void {
    this.back(i0, i1, 13, 33, '#f4f4f4');
    this.back(i0 + 0.1, i1 - 0.1, 15, 31, '#9fd8f7', false);
    this.back(i0 + 0.1, i1 - 0.1, 25, 31, '#c6ecff', false);
    const mid = (i0 + i1) / 2;
    this.back(mid - 0.04, mid + 0.04, 15, 31, '#f4f4f4', false);
    this.back(i0 + 0.1, i1 - 0.1, 22, 23, '#f4f4f4', false);
  }

  private star(i: number, h: number): void {
    const [x, y] = up(iso(i, 0), h);
    const X = Math.round(x);
    const Y = Math.round(y);
    const rows = ['...y...', '...y...', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', 'yy...yy'];
    rows.forEach((r, dy) => { for (let dx = 0; dx < r.length; dx++) if (r[dx] === 'y') this.px(X - 3 + dx, Y - 3 + dy, 1, 1, '#ffe680'); });
  }

  /** Animated pictures on the back wall: the Lounge TV and the Training Hall LED scoreboard. */
  private drawWallScreens(): void {
    // Training Hall LED tactical display (i = 8.75..9.95).
    const phase = Math.floor(this.time * 1.5) % 3;
    if (phase === 0) {
      this.back(8.8, 9.3, 16, 29, this.color, false);
      this.back(9.4, 9.9, 16, 29, '#d9572b', false);
    } else if (phase === 1) {
      for (let k = 0; k < 4; k++) {
        this.back(8.82 + k * 0.28, 9.0 + k * 0.28, 16, 19 + ((k * 7 + Math.floor(this.time * 6)) % 11), '#59b36b', false);
      }
    } else {
      this.back(9.0, 9.7, 19, 25, '#f2b84b', false);
      this.back(9.25, 9.45, 16, 29, '#f2b84b', false);
    }
  }

  private drawTv(): void {
    const tv = Math.floor(this.time * 2) % 4;
    this.back(2.7, 3.9, 16, 28, ['#3ea55a', '#46b062', '#3ea55a', '#4fb96b'][tv]!, false);
    this.back(2.9 + (tv % 2) * 0.3, 3.1 + (tv % 2) * 0.3, 20, 22, '#3a7bd5', false);
    this.back(3.5 - (tv % 2) * 0.2, 3.7 - (tv % 2) * 0.2, 22, 24, '#d9572b', false);
  }

  // -------------------------------------------------------------------------
  // Interior partitions & Furniture props

  private addInteriorPartitions(add: AddProp): void {
    // Low Kairosoft waist-high room divider between Lounge (Room 1) and Training Hall (Room 2) at i = R1.
    add(R1 + 2.0, () => {
      this.box(R1 - 0.12, 0.1, 0.24, PART_D, 7, '#b8834e');
      this.box(R1 - 0.14, PART_D - 0.15, 0.28, 0.28, 10, '#8a5a34');
    });
    // Tactics whiteboard mounted prominently on the Training Hall back wall (`lineup` hotspot).
    add(0.025, () => {
      this.back(4.8, 6.3, 12, 32, '#7a7f8a');
      this.back(4.9, 6.2, 14, 30, '#fbfbfb', false);
      const dot = (i: number, h: number, c: string) => { const [x, y] = up(iso(i, 0), h); this.px(x, y, 2, 2, c); };
      dot(5.15, 25, '#3a7bd5');
      dot(5.45, 19, '#3a7bd5');
      dot(5.25, 16, '#3a7bd5');
      dot(5.85, 24, '#d9572b');
      dot(6.0, 17, '#d9572b');
      for (let k = 0; k < 6; k++) { const [x, y] = up(iso(5.35 + k * 0.08, 0), 18 + k); this.px(x, y, 1, 1, '#4a4a4a'); }
      this.back(4.9, 6.2, 12, 14, '#b8bcc6', false);
    }, { hotspot: 'lineup' });

    // Low Kairosoft waist-high room divider between Training Hall (Room 2) and Office (Room 3) at i = R2.
    add(R2 + 2.0, () => {
      this.box(R2 - 0.12, 0.1, 0.24, PART_D, 7, '#b8834e');
      this.box(R2 - 0.14, PART_D - 0.15, 0.28, 0.28, 10, '#8a5a34');
    });
  }

  private addLoungeProps(add: AddProp): void {
    // Red plush sofa along the Lounge back wall.
    add(1.2, () => {
      this.box(0.55, 0.25, 2.15, 0.28, 13, '#c64a3f');
      this.box(0.55, 0.35, 2.15, 0.55, 6, '#d9574a');
      this.box(0.45, 0.3, 0.22, 0.62, 9, '#b5413a');
      this.box(2.65, 0.3, 0.22, 0.62, 9, '#b5413a');
    });
    // Two beds for resting players.
    for (const [bi, bj] of BEDS) {
      add(bi + bj + 1.5, () => {
        this.box(bi, bj - 0.05, 0.92, 0.18, 13, '#7a4a28');
        this.box(bi, bj, 0.92, 1.4, 5, '#8a5a34');
        this.box(bi + 0.05, bj + 0.05, 0.82, 1.3, 3, '#f4f4f8', 5);
        this.box(bi + 0.1, bj + 0.1, 0.72, 0.35, 2, '#ffffff', 8);
      });
    }
    // Coffee table with cups.
    add(1.5 + 1.85 + 0.9, () => {
      this.box(1.45, 1.8, 0.85, 0.48, 5, '#8a5a34');
      const [x, y] = up(iso(1.75, 2.0), 5);
      this.px(x, y - 3, 2, 3, '#ffffff');
      this.px(x + 5, y - 1, 2, 3, '#ffffff');
    });
    // Drink vending machine.
    add(0.1 + 1.5 + 0.8, () => {
      this.box(0.1, 1.45, 0.48, 0.55, 25, '#d23c3c');
      const [x, y] = iso(0.58, 1.45);
      this.px(x - 6, y - 22, 4, 8, '#ffe9a8');
      for (let k = 0; k < 3; k++) this.px(x - 6 + k * 2, y - 12, 1, 2, ['#5ab0ee', '#f2b84b', '#59b36b'][k]!);
    });
    add(4.1 + 0.3 + 0.4, () => this.plant(4.05, 0.25));
    // Wall TV in Lounge: tapping opens Schedule.
    add(0.02, () => this.back(2.6, 4.0, 14, 30, '#22252e'), { hotspot: 'schedule', anim: () => this.drawTv() });

    // Lounge & Stream room upgrades (T22).
    const lounge = this.lvl('LOUNGE');
    if (lounge >= 2) {
      add(0.15 + 0.3 + 0.4, () => {
        this.box(0.15, 0.3, 0.24, 0.24, 2, '#5a3a22');
        this.box(0.12, 0.27, 0.3, 0.3, 6, '#ffe9a8', 18);
      });
    }
    if (lounge >= 3) {
      add(0.03, () => {
        this.sideWall(0, 3.3, 4.6, 16, 29, '#5a6a7a');
        this.sideWall(0, 3.4, 4.5, 18, 27, '#4aa8d8', false);
        this.sideWall(0, 3.4, 4.5, 18, 20, '#e0c890', false);
      }, {
        anim: () => {
          for (let k = 0; k < 3; k++) {
            const j = 3.5 + ((this.time * 0.25 + k * 0.33) % 1) * 0.85;
            const [x, y] = up(iso(0, j), 22 + k * 2);
            this.px(x, y, 2, 1, ['#ff8a3a', '#ffd35a', '#ff5a7a'][k]!);
          }
        },
      });
    }
    const stream = this.lvl('STREAM');
    add(3.85 + 2.85 + 0.3, () => {
      const [x, y] = up(iso(3.88, 2.88), 22);
      this.px(x, y, 1, 18, '#3b3f4c');
      for (let k = 0; k < 10; k++) {
        const a = (k * Math.PI) / 5;
        this.px(Math.round(x + Math.cos(a) * 3.5), Math.round(y + Math.sin(a) * 3.5), 1, 1, '#fff6d8');
      }
    });
    if (stream >= 2) {
      add(3.3 + 3.6 + 0.6, () => {
        this.box(3.3, 3.6, 0.82, 0.44, 7, '#8a5a34');
        this.box(3.58, 3.64, 0.38, 0.16, 6, '#22252e', 7);
      }, {
        anim: () => {
          const [x, y] = up(iso(3.66, 3.66), 13);
          this.px(x + 1, y - 2, 5, 3, Math.sin(this.time * 5) > -0.3 ? '#ff5a7a' : '#c03a5a');
          const [lx, ly] = up(iso(4.05, 3.65), 23);
          const on = Math.floor(this.time * 2) % 2 === 0;
          this.px(lx - 6, ly, 12, 5, on ? '#e8304a' : '#a8202e');
          if (on) for (const dx of [-4, -1, 2]) this.px(lx + dx, ly + 1, 2, 3, '#ffffff');
        },
      });
    }
    if (stream >= 3) {
      add(4.05 + 2.6 + 0.2, () => {
        this.box(4.02, 2.6, 0.18, 0.75, 20, '#3ec46a');
        this.box(3.08, 2.75, 0.24, 0.2, 5, '#22252e', 12);
      });
    }
  }

  private addTrainingProps(add: AddProp): void {
    DESKS.forEach(([di, dj], k) => {
      add(di + dj + 0.7, () => {
        this.box(di, dj, 1.0, 0.52, 7, '#b87a46', 2);
        this.box(di + 0.72, dj + 0.06, 0.22, 0.32, 8, '#3b3f4c', 9);
        this.box(di + 0.16, dj + 0.06, 0.5, 0.16, 8, '#22252e', 9);
        this.box(di + 0.2, dj + 0.26, 0.42, 0.16, 2, '#e8e8ee', 9);
      }, {
        hotspot: 'training',
        anim: () => {
          const lit = Math.sin(this.time * 4 + k) > -0.6;
          const [x, y] = iso(di + 0.18, dj + 0.16);
          this.px(x + 2, y - 16, 7, 4, lit ? '#7fe3ff' : '#4fb6e8');
          this.px(x + 3, y - 15, 2, 1, '#ffffff');
          if (this.lvl('TRAINING') >= 2) {
            const hue = ['#ff5a7a', '#ffd35a', '#5aff9a', '#5ac8ff', '#c95aff'][(Math.floor(this.time * 3) + k) % 5]!;
            const [ax, ay] = iso(di, dj + 0.5);
            const [bx] = iso(di + 1.0, dj + 0.5);
            for (let x2 = Math.ceil(ax); x2 < bx; x2++) this.px(x2, ay - 7 + Math.round((x2 - ax) / 2), 1, 1, hue);
          }
        },
      });
      const [si, sj] = SEAT([di, dj]);
      add(si + sj + 0.3, () => {
        const chairColor = this.lvl('TRAINING') >= 3 ? this.color : (k % 2 ? '#c0392b' : '#2d6cdf');
        this.box(si - 0.18, sj + 0.04, 0.36, 0.3, 4, '#2b2b33', 3);
        this.box(si - 0.2, sj + 0.2, 0.4, 0.18, 9, chairColor, 6);
      });
    });

    // Water cooler and potted plant in the Training Hall.
    add(9.6 + 4.1 + 0.4, () => {
      this.box(9.5, 4.0, 0.36, 0.36, 12, '#d0d6de');
      this.box(9.55, 4.05, 0.26, 0.26, 6, '#7fc8f8', 12);
    });
    add(4.85 + 4.35 + 0.4, () => this.plant(4.8, 4.3));

    // Analyst corner in Training Hall (T22).
    if (this.lvl('ANALYSIS') >= 2) {
      add(9.25 + 1.15 + 0.6, () => {
        this.box(9.2, 1.15, 0.68, 0.44, 7, '#5c6470');
        this.box(9.28, 1.2, 0.36, 0.22, 6, '#22252e', 7);
        const [x, y] = iso(9.28, 1.26);
        this.px(x + 2, y - 12, 4, 3, '#7fe3ff');
      });
    }
    if (this.lvl('ANALYSIS') >= 3) {
      add(9.25 + 2.65 + 0.6, () => {
        this.box(9.25, 2.65, 0.58, 0.48, 6, '#3b3f4c');
        this.box(9.3, 2.7, 0.48, 0.38, 2, '#2a6f8a', 6);
      }, {
        anim: () => {
          const [x, y] = up(iso(9.52, 2.88), 8);
          const t = this.time * 2;
          for (let k = 0; k < 6; k++) {
            const a = t + (k * Math.PI) / 3;
            this.px(Math.round(x + Math.cos(a) * 5), Math.round(y - 5 + Math.sin(a) * 2), 1, 1, '#9ff0ff');
          }
          this.px(x - 2, y - 8, 4, 3, Math.sin(t * 2) > 0 ? '#7fe3ff' : '#c6f6ff');
          this.px(x, y - 10, 1, 2, '#9ff0ff');
        },
      });
    }

    // Roof sign & sister-division plaques above the central Training Hall back wall (`group` hotspot).
    add(0.005, () => {
      this.back(5.2, 9.6, WALL_H + 1, WALL_H + 13, '#5a3a22');
      this.back(5.35, 9.45, WALL_H + 3, WALL_H + 11, '#7a5232', false);
      const branches = this.extras.branches ?? [];
      if (branches.includes('FPS')) {
        this.back(3.8, 4.9, WALL_H + 1, WALL_H + 11, '#3b3f4c');
        this.back(3.9, 4.8, WALL_H + 3, WALL_H + 9, '#d9574a', false);
        const [fx, fy] = up(iso(4.35, 0), WALL_H + 6);
        this.px(fx - 2, fy, 5, 1, '#fff3b8');
        this.px(fx, fy - 2, 1, 5, '#fff3b8');
      }
      if (branches.includes('CARD')) {
        this.back(9.9, 11.0, WALL_H + 1, WALL_H + 11, '#5a3a22');
        this.back(10.0, 10.9, WALL_H + 3, WALL_H + 9, '#f2b84b', false);
        const [cx, cy] = up(iso(10.45, 0), WALL_H + 6);
        this.px(cx - 1, cy - 2, 3, 5, '#fffdf5');
        this.px(cx, cy - 1, 1, 3, '#c0392b');
      }
    }, { hotspot: 'group' });
  }

  private addOfficeProps(add: AddProp): void {
    // Bookshelf (match reports) on Office back wall.
    add(10.55 + 0.2 + 0.5, () => {
      this.box(10.5, 0.2, 0.9, 0.36, 29, '#8a5a34');
      const [x, y] = iso(10.5, 0.56);
      const colors = ['#c0392b', '#2d6cdf', '#f2b84b', '#59b36b', '#9b59b6', '#e67e22'];
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 5; k++) {
          this.px(x + 2 + k * 2 + Math.round(k * 0.2), y - 25 + row * 8 + k, 2, 5, colors[(k + row * 2) % colors.length]!);
        }
      }
    }, { hotspot: 'report' });

    // Trophy cabinet (history) on Office back wall.
    add(11.75 + 0.2 + 0.5, () => {
      this.box(11.7, 0.2, 0.65, 0.4, 28, '#6b4a2b');
      const [x, y] = iso(11.7, 0.6);
      this.px(x + 2, y - 25, 5, 20, '#cfe8f7');
      const gold = Math.min(4, this.extras.titles);
      const silver = Math.max(0, Math.min(4 - gold, this.extras.finals));
      for (let k = 0; k < gold + silver; k++) {
        const c = k < gold ? '#f2c230' : '#c9cdd6';
        this.px(x + 3, y - 23 + k * 5, 3, 2, c);
        this.px(x + 4, y - 21 + k * 5, 1, 1, c);
        this.px(x + 3, y - 20 + k * 5, 3, 1, c);
      }
    }, { hotspot: 'history' });

    // Safe (finance) on the right side of the Office.
    add(14.1 + 2.0 + 0.6, () => {
      this.box(13.95, 1.9, 0.6, 0.6, 13, '#5c6470');
      const [x, y] = iso(13.95, 2.5);
      this.px(x + 2, y - 10, 3, 3, '#f2c230');
    }, { hotspot: 'finance' });

    // Manager's desk (contracts & transfers) + guest chair.
    add(11.0 + 1.95 + 1.4, () => {
      this.box(10.95, 1.95, 1.25, 0.54, 9, '#a86f3e');
      this.box(11.28, 2.02, 0.46, 0.28, 5, '#3b3f4c', 9);
      const [x, y] = iso(11.32, 2.08);
      this.px(x + 1, y - 14, 4, 3, '#9fe0ff');
      this.box(11.88, 2.05, 0.22, 0.22, 3, '#f4f4f4', 9);
    }, { hotspot: 'contracts' });
    add(11.55 + 3.15 + 0.3, () => this.box(11.35, 3.35, 0.4, 0.2, 7, '#6d4c8a', 4));

    // Staff desk (P3): long desk with 3 laptops for coach, manager, finance chief.
    add(STAFF_DESK_DEPTH, () => {
      this.box(11.9, 4.4, 2.35, 0.38, 8, '#9a6a3e');
      for (let k = 0; k < 3; k++) {
        const [x, y] = iso(12.15 + k * 0.85, 4.45);
        this.px(x - 2, y - 12, 5, 3, '#3b3f4c');
        this.px(x - 1, y - 11, 3, 1, '#9fe0ff');
      }
    }, { hotspot: 'staff' });

    // Office room upgrades (T22).
    const office = this.lvl('OFFICE');
    if (office >= 2) {
      add(13.8 + 0.25 + 0.4, () => {
        this.box(13.75, 0.25, 0.38, 0.38, 12, '#d0d6de');
        this.box(13.8, 0.3, 0.28, 0.28, 6, '#7fc8f8', 12);
        this.back(13.45, 13.95, 19, 28, '#f7f1dc');
        this.back(13.52, 13.88, 21, 26, '#9fd8a7', false);
      });
    }
    if (office >= 3) {
      add(10.55 + 3.5 + 0.4, () => {
        this.box(10.52, 3.48, 0.28, 0.28, 3, '#6b4a2b');
        const [x, y] = up(iso(10.65, 3.6), 12);
        this.px(x - 3, y - 3, 7, 7, OUT);
        this.px(x - 2, y - 2, 5, 5, '#3a7bd5');
        this.px(x - 1, y - 2, 2, 2, '#59b36b');
        this.px(x + 1, y, 2, 2, '#59b36b');
      });
      add(11.0 + 1.95 + 1.5, () => this.box(11.48, 2.34, 0.36, 0.16, 2, '#f2c230', 9));
    }
    add(14.4 + 4.3 + 0.4, () => this.plant(14.35, 4.25));
  }

  private addYardProps(add: AddProp): void {
    // Red mailbox (`inbox` hotspot) in the left front yard.
    add(2.5 + D + 0.75 + 0.5, () => {
      this.box(2.65, D + 0.85, 0.12, 0.12, 9, '#6b4a2b');
      this.box(2.42, D + 0.68, 0.56, 0.38, 8, '#d23c3c', 9);
      this.box(2.42, D + 0.68, 0.56, 0.08, 2, '#f2f2f2', 13);
    }, { hotspot: 'inbox' });

    // Scouting notice board (`market` hotspot) in the centre-left yard.
    add(4.4 + D + 0.85 + 0.5, () => {
      this.box(4.4, D + 0.85, 0.1, 0.1, 13, '#6b4a2b');
      this.box(5.55, D + 0.85, 0.1, 0.1, 13, '#6b4a2b');
      this.box(4.3, D + 0.8, 1.45, 0.14, 13, '#c89060', 11);
      for (let k = 0; k < 3; k++) {
        const [x, y] = up(iso(4.55 + k * 0.42, D + 0.92), 21);
        this.px(x - 2, y - 2 + k, 5, 7, ['#fffbe8', '#ffe4e1', '#e8f4ff'][k]!);
        this.px(x - 1, y + k, 3, 1, '#8a7a6a');
        this.px(x - 1, y + 2 + k, 2, 1, '#8a7a6a');
      }
    }, { hotspot: 'market' });

    // Facility red toolbox (`facilities` hotspot) in the centre-right yard.
    add(9.8 + D + 0.8 + 0.5, () => {
      this.box(9.8, D + 0.75, 0.7, 0.42, 6, '#d23c3c');
      this.box(9.8, D + 0.75, 0.7, 0.42, 1, '#a82c2c', 6);
      this.box(10.06, D + 0.9, 0.18, 0.1, 2, '#f2b84b', 5);
      this.box(9.98, D + 0.92, 0.34, 0.05, 3, '#2b2b33', 7);
    }, { hotspot: 'facilities' });

    // Sister-division courtyard stations on the front lawn when opened (V9): tapping opens Group (`group`).
    const branches = this.extras.branches ?? [];
    if (branches.includes('FPS')) {
      add(8.35 + D + 0.7 + 0.6, () => {
        this.tile(8.25, D + 0.58, 0.96, 0.72, '#cfc8b8');
        this.box(8.35, D + 0.68, 0.76, 0.24, 6, '#8a6f4e');
        for (const [ti, tc] of [[8.5, '#d9574a'], [8.86, '#3a7bd5']] as const) {
          this.box(ti, D + 0.73, 0.08, 0.08, 5, '#4a3b2c', 6);
          const [tx, ty] = up(iso(ti + 0.04, D + 0.77), 13);
          this.px(tx - 2, ty - 2, 5, 5, OUT);
          this.px(tx - 1, ty - 1, 3, 3, '#fffdf5');
          this.px(tx, ty, 1, 1, tc);
        }
      }, {
        hotspot: 'group',
        anim: () => {
          const idx = Math.floor(this.time * 2.4) % 2;
          const ti = idx === 0 ? 8.54 : 8.9;
          const [tx, ty] = up(iso(ti, D + 0.77), 15);
          this.px(tx - 1, ty - 2, 3, 2, '#ffe055');
        },
      });
    }
    if (branches.includes('CARD')) {
      add(13.95 + D + 0.7 + 0.6, () => {
        this.tile(13.85, D + 0.58, 0.86, 0.66, '#cfc8b8');
        this.box(13.95, D + 0.66, 0.66, 0.46, 6, '#6e4124');
        this.box(14.01, D + 0.71, 0.54, 0.36, 1, '#236e42', 6);
      }, {
        hotspot: 'group',
        anim: () => {
          const lift = Math.sin(this.time * 3.2) > 0 ? 1 : 0;
          const [cx, cy] = up(iso(14.28, D + 0.89), 8 + lift);
          this.px(cx - 2, cy - 2, 2, 3, '#fffdf5');
          this.px(cx + 1, cy - 1, 2, 3, '#ffd84d');
        },
      });
    }

    // Courtyard trees on left and right.
    add(0.8 + D + 1.0 + 0.6, () => this.tree(0.8, D + 0.95));
    add(12.8 + D + 1.0 + 0.6, () => this.tree(12.8, D + 0.95));
  }

  private plant(i: number, j: number): void {
    this.box(i, j, 0.28, 0.28, 5, '#b5653a');
    const [x, y] = up(iso(i + 0.14, j + 0.14), 5);
    const X = Math.round(x);
    const Y = Math.round(y);
    this.px(X - 4, Y - 10, 9, 9, OUT);
    const leaves: [number, number, string][] = [[-3, -9, '#3e9a4a'], [0, -11, '#4fb35a'], [-2, -7, '#2f7d3a'], [1, -8, '#3e9a4a'], [-1, -5, '#4fb35a']];
    for (const [dx, dy, c] of leaves) this.px(X + dx, Y + dy, 3, 3, c);
  }

  private tree(i: number, j: number): void {
    this.box(i, j, 0.24, 0.24, 12, '#7a4a28');
    const [x, y] = up(iso(i + 0.12, j + 0.12), 12);
    const X = Math.round(x);
    const Y = Math.round(y);
    this.px(X - 8, Y - 16, 17, 16, OUT);
    const blobs: [number, number, number, string][] = [[-7, -14, 7, '#3e9a4a'], [0, -15, 8, '#4fb35a'], [-4, -9, 9, '#2f7d3a'], [2, -9, 6, '#3e9a4a'], [-2, -12, 5, '#5fc46a']];
    for (const [dx, dy, s, c] of blobs) this.px(X + dx, Y + dy, s, s, c);
  }

  // -------------------------------------------------------------------------
  // People

  private spotOf(f: Figure): Spot | undefined {
    if (f.path.length > 0) return undefined;
    return SPOTS[f.activity].find((s) => Math.abs(s.i - f.i) < 0.05 && Math.abs(s.j - f.j) < 0.05);
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
    const [x, y] = iso(f.i, f.j);
    if (frame !== 'sleep') this.px(x - 4, y - 1, 8, 2, 'rgba(40,20,10,0.28)');
    const bob = !walking && f.activity === 'IDLE' ? Math.round(Math.sin(this.time * 1.5 + f.phase)) : 0;
    const img = chibi(f.look, frame, f.flip);
    const h = crop ?? img.height;
    this.ctx.drawImage(img, 0, 0, img.width, h, Math.round(x - img.width / 2), Math.round(y - h + dy + bob), img.width, h);
  }

  /** A hired staff member behind the staff desk, typing (P3). */
  private drawStaff(id: string, k: number): void {
    const [si, sj] = STAFF_SEATS[k]!;
    const img = chibi(lookFor(id, this.color), Math.floor(this.time * 4 + k) % 2 ? 'typeA' : 'typeB');
    const [x, y] = iso(si, sj);
    this.ctx.drawImage(img, 0, 0, img.width, 15, Math.round(x - img.width / 2), Math.round(y - 17), img.width, 15);
  }

  private drawManager(): void {
    const img = chibi(this.manager, 'stand');
    const [x, y] = iso(MANAGER.i, MANAGER.j);
    this.ctx.drawImage(img, 0, 0, img.width, 15, Math.round(x - img.width / 2), Math.round(y - 17), img.width, 15);
  }

  private drawBubble(f: Figure): void {
    if (f.path.length > 0) return;
    if (Math.sin(this.time * 0.9 + f.phase * 2.3) <= 0.2 && !f.cheer) return;
    const pose = this.spotOf(f)?.pose;
    const lift = pose === 'sit' ? 18 : pose === 'sleep' ? 10 : 20;
    const name = f.cheer ? 'star' : f.activity === 'TALK' ? 'bang' : f.activity === 'REST' ? 'zzz' : f.activity === 'IDLE' ? 'dots' : 'note';
    const [x, y] = iso(f.i, f.j);
    this.bubble(x, y - lift, name);
  }

  private drawMarkers(): void {
    const bounce = Math.round(Math.abs(Math.sin(this.time * 3)) * 3);
    for (const [name, m] of Object.entries(this.markers) as [Hotspot, Marker][]) {
      const p = this.props.find((x) => x.hotspot === name);
      if (!p) continue;
      const my = p.img.height > 24 ? p.y + 7 : p.y - 1;
      this.bubble(p.x + p.img.width / 2, my - bounce, m);
    }
  }
}
