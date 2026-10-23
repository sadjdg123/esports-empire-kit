// The club base: a small isometric pixel scene with three rooms. Drawn with the
// plain 2D canvas at a low resolution and scaled up, so it stays cheap on phones.
// Figures walk along the front corridor between rooms to the spot their
// activity puts them on. Purely visual: the only input is a tap on a figure.

import type { Activity, ClubActivity, Room } from './activities';

export const SCENE_W = 244;
export const SCENE_H = 160;
const TW = 24; // tile width
const TH = 12; // tile height
const OX = 80; // screen x of tile (0, 0)
const OY = 40; // screen y of tile (0, 0)
const WALL = 34;
const CORRIDOR_J = 5.3;
const SPEED = 2.4; // tiles per second
const FPS = 30;

const ROOMS: Record<Room, { i0: number; i1: number; floor: string; floor2: string; label: string }> = {
  TRAINING: { i0: 0, i1: 6, floor: '#3a4258', floor2: '#353c50', label: '训练室' },
  LOUNGE: { i0: 6, i1: 10, floor: '#4a3f37', floor2: '#433932', label: '休息室' },
  OFFICE: { i0: 10, i1: 13, floor: '#34463d', floor2: '#2f4038', label: '办公室' },
};
const DEPTH = 6;

/** Where figures stand or sit, per activity (tile coordinates). */
const SPOTS: Record<Activity, [number, number][]> = {
  TRAIN: [[1.2, 1.9], [2.6, 1.9], [4.0, 1.9], [1.2, 3.7], [2.6, 3.7], [4.0, 3.7], [5.2, 1.9], [5.2, 3.7]],
  REST: [[6.7, 1.3], [7.6, 1.3], [8.5, 1.3], [7.2, 3.6], [8.8, 3.6], [9.3, 2.4], [6.8, 2.6], [8.1, 2.6]],
  IDLE: [[9.4, 4.4], [6.6, 4.4], [8.0, 4.6], [9.4, 3.2], [6.6, 3.2], [8.0, 0.8], [7.0, 0.8], [9.0, 0.8]],
  TALK: [[11.4, 3.0]],
};
const MANAGER: [number, number] = [11.4, 1.5];

interface Figure {
  id: string;
  color: string;
  hair: string;
  i: number;
  j: number;
  path: [number, number][];
  activity: Activity;
  phase: number; // animation offset
  idleTimer: number;
}

const iso = (i: number, j: number): [number, number] => [OX + (i - j) * (TW / 2), OY + (i + j) * (TH / 2)];

function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function quad(ctx: CanvasRenderingContext2D, pts: [number, number][], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

/** An isometric box standing on tile area [i, i+w] x [j, j+d], h pixels tall. */
function box(ctx: CanvasRenderingContext2D, i: number, j: number, w: number, d: number, h: number, top: string): void {
  const a = iso(i, j);
  const b = iso(i + w, j);
  const c = iso(i + w, j + d);
  const e = iso(i, j + d);
  const up = (p: [number, number]): [number, number] => [p[0], p[1] - h];
  quad(ctx, [e, c, up(c), up(e)], shade(top, 0.62)); // front-left face
  quad(ctx, [c, b, up(b), up(c)], shade(top, 0.8)); // front-right face
  quad(ctx, [up(a), up(b), up(c), up(e)], top);
}

const SKIN = '#f1c9a5';
const HAIRS = ['#2b2118', '#5a3b22', '#1c1c24', '#8a5a2b', '#3d2c4e', '#b8b8c0'];

export class ClubScene {
  private ctx: CanvasRenderingContext2D;
  private figures = new Map<string, Figure>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private color: string;
  private onFrame?: (ms: number) => void;

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

  /** New activities: figures keep their position and walk to their new spot. */
  setActivities(list: ClubActivity[], clubColor: string): void {
    this.color = clubColor;
    const seen = new Set<string>();
    const used: Record<Activity, number> = { TRAIN: 0, REST: 0, IDLE: 0, TALK: 0 };
    list.forEach((a, k) => {
      seen.add(a.playerId);
      const spots = SPOTS[a.activity];
      const target = spots[used[a.activity]++ % spots.length]!;
      let f = this.figures.get(a.playerId);
      if (!f) {
        // New arrivals come in through the front door of the training room.
        f = { id: a.playerId, color: clubColor, hair: HAIRS[k % HAIRS.length]!, i: 0.5, j: CORRIDOR_J + 0.4, path: [], activity: a.activity, phase: k * 0.37, idleTimer: 0 };
        this.figures.set(a.playerId, f);
      }
      f.color = clubColor;
      if (f.activity !== a.activity || f.path.length === 0) f.path = this.route(f.i, f.j, target);
      f.activity = a.activity;
    });
    for (const id of [...this.figures.keys()]) if (!seen.has(id)) this.figures.delete(id);
  }

  /** Through the corridor in front of the rooms, unless already in the same room. */
  private route(i: number, j: number, to: [number, number]): [number, number][] {
    const roomOf = (x: number) => (x < 6 ? 0 : x < 10 ? 1 : 2);
    if (roomOf(i) === roomOf(to[0]) && j < CORRIDOR_J - 0.5) return [to];
    return [[i, CORRIDOR_J], [to[0], CORRIDOR_J], to];
  }

  /** The figure under a point in canvas pixels (scene coordinates), if any. */
  pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = 12;
    for (const f of this.figures.values()) {
      const [sx, sy] = iso(f.i, f.j);
      const d = Math.hypot(sx - x, sy - 8 - y);
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
      if (!next) {
        // Daydreamers drift a little on the spot.
        if (f.activity === 'IDLE') {
          f.idleTimer += dt;
          if (f.idleTimer > 3) { f.idleTimer = 0; f.path = [[f.i + (Math.sin(this.time + f.phase) > 0 ? 0.4 : -0.4), f.j]]; }
        }
        continue;
      }
      const di = next[0] - f.i;
      const dj = next[1] - f.j;
      const dist = Math.hypot(di, dj);
      const move = SPEED * dt;
      if (dist <= move) { f.i = next[0]; f.j = next[1]; f.path.shift(); } else { f.i += (di / dist) * move; f.j += (dj / dist) * move; }
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    // Floors, checkered per room.
    for (const r of Object.values(ROOMS)) {
      for (let i = r.i0; i < r.i1; i++) {
        for (let j = 0; j < DEPTH; j++) quad(ctx, [iso(i, j), iso(i + 1, j), iso(i + 1, j + 1), iso(i, j + 1)], (i + j) % 2 ? r.floor : r.floor2);
      }
    }
    // Back walls.
    const wallTop = (p: [number, number]): [number, number] => [p[0], p[1] - WALL];
    quad(ctx, [iso(0, 0), iso(13, 0), wallTop(iso(13, 0)), wallTop(iso(0, 0))], '#262b3a');
    quad(ctx, [iso(0, DEPTH), iso(0, 0), wallTop(iso(0, 0)), wallTop(iso(0, DEPTH))], '#1e2230');
    // Posters and windows.
    this.wallRect(1.5, 2.5, 8, 22, this.color);
    this.wallRect(7, 9, 6, 18, '#6fa8dc');
    this.wallRect(11, 12.2, 8, 16, '#a3b18a');
    // Room labels on the back wall.
    ctx.fillStyle = '#c9cede';
    ctx.font = '8px sans-serif';
    for (const r of Object.values(ROOMS)) {
      const [x, y] = iso((r.i0 + r.i1) / 2, 0);
      ctx.fillText(r.label, x - 12, y - WALL + 9);
    }
    // Everything standing on the floor, back to front.
    const items: { depth: number; draw: () => void }[] = [];
    const add = (depth: number, draw: () => void) => items.push({ depth, draw });
    // Low partitions between rooms (open at the corridor).
    for (const pi of [6, 10]) for (let j = 0; j < 4.4; j += 1) add(pi + j + 0.5, () => box(ctx, pi - 0.08, j, 0.16, Math.min(1, 4.4 - j), 14, '#4b5266'));
    // Training room: desks with monitors.
    for (const [di, dj] of [[0.7, 1.0], [2.1, 1.0], [3.5, 1.0], [0.7, 2.8], [2.1, 2.8], [3.5, 2.8]] as [number, number][]) {
      add(di + dj + 1, () => {
        box(ctx, di, dj, 1.1, 0.5, 9, '#5b4a3a');
        box(ctx, di + 0.3, dj + 0.05, 0.5, 0.12, 8, '#15171e');
        const [x, y] = iso(di + 0.55, dj + 0.1);
        ctx.fillStyle = Math.sin(this.time * 3 + di) > 0 ? '#7fd1ff' : '#4fa3ff';
        ctx.fillRect(Math.round(x) - 3, Math.round(y) - 16, 6, 4);
      });
    }
    // Lounge: sofa, beds, coffee table, plant.
    add(7.8, () => box(ctx, 6.4, 0.5, 2.6, 0.6, 7, '#8a4b4b'));
    add(10.5, () => box(ctx, 6.8, 3.3, 0.9, 1.3, 5, '#cfd6e6'));
    add(12.1, () => box(ctx, 8.4, 3.3, 0.9, 1.3, 5, '#cfd6e6'));
    add(9.6, () => box(ctx, 7.4, 1.8, 0.8, 0.5, 4, '#6b5440'));
    add(10.4, () => { box(ctx, 9.5, 0.4, 0.4, 0.4, 6, '#6b4a2b'); box(ctx, 9.5, 0.4, 0.4, 0.4, 16, '#3c8d5a'); });
    // Office: desk, shelf, plant.
    add(12.6, () => box(ctx, 10.8, 1.9, 1.3, 0.6, 9, '#6b5440'));
    add(10.9, () => box(ctx, 12.2, 0.3, 0.5, 0.5, 26, '#4a3d33'));
    add(16.4, () => { box(ctx, 12.3, 3.8, 0.4, 0.4, 6, '#6b4a2b'); box(ctx, 12.3, 3.8, 0.4, 0.4, 16, '#3c8d5a'); });
    // The manager (you) at the office desk.
    add(MANAGER[0] + MANAGER[1], () => this.person(MANAGER[0], MANAGER[1], '#2c3e50', '#1c1c24', false, true, 0));
    for (const f of this.figures.values()) add(f.i + f.j + 0.2, () => this.drawFigure(f));
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();
  }

  private wallRect(i0: number, i1: number, low: number, high: number, color: string): void {
    const a = iso(i0, 0);
    const b = iso(i1, 0);
    quad(this.ctx, [[a[0], a[1] - low], [b[0], b[1] - low], [b[0], b[1] - high], [a[0], a[1] - high]], color);
  }

  private drawFigure(f: Figure): void {
    const walking = f.path.length > 0;
    const sitting = !walking && (f.activity === 'TRAIN' || f.activity === 'TALK');
    const lying = !walking && f.activity === 'REST';
    this.person(f.i, f.j, f.color, f.hair, walking, sitting, f.phase, lying);
    if (walking) return;
    const [x, y] = iso(f.i, f.j);
    const ctx = this.ctx;
    ctx.font = '8px sans-serif';
    ctx.fillStyle = '#e6e7ec';
    const bob = Math.round(Math.sin(this.time * 2 + f.phase) * 1.5);
    if (f.activity === 'REST') ctx.fillText('z', x + 3, y - 14 + bob);
    if (f.activity === 'IDLE') ctx.fillText('…', x - 3, y - 19 + bob);
    if (f.activity === 'TALK') { ctx.fillStyle = '#f2b84b'; ctx.fillText('!', x - 1, y - 19 + bob); }
  }

  /** A 7x12 pixel person standing (or sitting/lying) on tile point (i, j). */
  private person(i: number, j: number, body: string, hair: string, walking: boolean, sitting: boolean, phase: number, lying = false): void {
    const ctx = this.ctx;
    const [sx, sy] = iso(i, j);
    const x = Math.round(sx) - 3;
    const y = Math.round(sy);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y - 1, 7, 2);
    if (lying) {
      ctx.fillStyle = body; ctx.fillRect(x - 2, y - 6, 8, 3);
      ctx.fillStyle = SKIN; ctx.fillRect(x + 6, y - 7, 3, 3);
      ctx.fillStyle = hair; ctx.fillRect(x + 6, y - 8, 3, 1);
      return;
    }
    const stride = walking ? (Math.floor((this.time * 8 + phase * 10) % 2) === 0 ? 1 : -1) : 0;
    const lift = sitting ? 3 : 0;
    if (!sitting) {
      ctx.fillStyle = '#20232c';
      ctx.fillRect(x + 1, y - 4 + Math.max(0, stride), 2, 4 - Math.max(0, stride));
      ctx.fillRect(x + 4, y - 4 + Math.max(0, -stride), 2, 4 - Math.max(0, -stride));
    }
    const bob = walking ? Math.abs(stride) : 0;
    ctx.fillStyle = body;
    ctx.fillRect(x, y - 9 + lift - bob, 7, 5);
    ctx.fillStyle = SKIN;
    ctx.fillRect(x + 1, y - 13 + lift - bob, 5, 4);
    ctx.fillStyle = hair;
    ctx.fillRect(x + 1, y - 14 + lift - bob, 5, 2);
  }
}
