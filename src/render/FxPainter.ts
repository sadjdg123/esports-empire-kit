// Draws the short-lived match effects (projectiles, slashes, skills, deaths, respawns)
// on one Phaser Graphics layer. Positions are looked up every frame, so a projectile
// follows a target that keeps moving. Screen pixels of the match view.

import type Phaser from 'phaser';
import type { ShotStyle, SkillStyle } from './matchFx';

export type Pt = { x: number; y: number };
/** Current screen position of a unit's chest, or null once it is gone. */
export type Locate = (id: string) => Pt | null;

interface Active { start: number; life: number; draw: (g: Phaser.GameObjects.Graphics, t: number) => void }

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const ease = (t: number) => 1 - (1 - t) * (1 - t);

export class FxPainter {
  private list: Active[] = [];
  private now = 0;

  constructor(private readonly g: Phaser.GameObjects.Graphics, private readonly locate: Locate, private readonly scale: number) {}

  get count(): number {
    return this.list.length;
  }

  /** Follows a unit; keeps its last known spot once it is gone. */
  private follow(id: string, fallback: Pt): () => Pt {
    let last = this.locate(id) ?? fallback;
    return () => (last = this.locate(id) ?? last);
  }

  private add(life: number, draw: Active['draw'], delay = 0): void {
    this.list.push({ start: this.now + delay, life, draw });
  }

  frame(now: number): void {
    this.now = now;
    const g = this.g;
    g.clear();
    this.list = this.list.filter((e) => now < e.start + e.life);
    for (const e of this.list) if (now >= e.start) e.draw(g, (now - e.start) / e.life);
  }

  // --- basic attacks ---------------------------------------------------------

  shot(style: ShotStyle, from: string, to: string, color: number, delay = 0): void {
    const a = this.locate(from);
    const b0 = this.locate(to);
    if (!a || !b0) return;
    const b = this.follow(to, b0);
    const dist = Math.hypot(b0.x - a.x, b0.y - a.y);
    const life = Math.max(90, Math.min(260, dist * 1.1));
    this.add(life, (g, t) => {
      const end = b();
      const p = lerp(a, end, t);
      const len = Math.hypot(end.x - a.x, end.y - a.y) || 1;
      const ux = (end.x - a.x) / len;
      const uy = (end.y - a.y) / len;
      if (style === 'arrow' || style === 'bolt') {
        const l = style === 'arrow' ? 8 : 5;
        g.lineStyle(2, style === 'arrow' ? 0xe8d2a0 : 0xb07440, 1).lineBetween(p.x - ux * l, p.y - uy * l, p.x, p.y);
        g.fillStyle(0xffffff, 1).fillRect(p.x - 1, p.y - 1, 2, 2);
      } else {
        const c = style === 'fire' ? 0xffa64d : color;
        g.fillStyle(c, 0.35).fillCircle(p.x - ux * 5, p.y - uy * 5, 3);
        g.fillStyle(c, 0.5).fillCircle(p.x, p.y, 6);
        g.fillStyle(style === 'fire' ? 0xffe27a : 0xffffff, 1).fillCircle(p.x, p.y, 2.5);
      }
    }, delay);
    this.spark(b, style === 'fire' ? 0xffa64d : 0xffffff, delay + life);
  }

  private spark(at: () => Pt, color: number, delay: number): void {
    this.add(120, (g, t) => {
      const p = at();
      const r1 = 3 + t * 6;
      const r2 = r1 + 4;
      g.lineStyle(2, color, 1 - t);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        g.lineBetween(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1, p.x + Math.cos(a) * r2, p.y + Math.sin(a) * r2);
      }
    }, delay);
  }

  slash(to: string, color = 0xffffff, delay = 0, angle = -0.6): void {
    const b0 = this.locate(to);
    if (!b0) return;
    const b = this.follow(to, b0);
    this.add(150, (g, t) => {
      const p = b();
      g.lineStyle(3 - t * 2, color, 1 - t);
      const r = 11;
      const sweep = 1.6 * ease(t);
      let prev: Pt | null = null;
      for (let k = 0; k <= 5; k++) {
        const a = angle - 0.8 + (sweep * k) / 5;
        const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r * 0.8 };
        if (prev) g.lineBetween(prev.x, prev.y, q.x, q.y);
        prev = q;
      }
    }, delay);
  }

  // --- skills -------------------------------------------------------------------

  skill(style: SkillStyle, from: string, to: string, color: number, radiusWorld: number, fromXY: Pt): void {
    const a0 = this.locate(from);
    const b0 = this.locate(to) ?? a0;
    if (!a0 || !b0) return;
    const a = this.follow(from, a0);
    const b = this.follow(to, b0);
    const R = Math.max(18, radiusWorld * this.scale);
    switch (style) {
      case 'quake': {
        this.ring(a, 0xe8c27a, R, 520, 4);
        this.debris(a, 0xb8863b, R * 0.8, 520);
        break;
      }
      case 'thorns':
        this.add(650, (g, t) => {
          const p = a();
          const spin = t * 2;
          g.lineStyle(2, color, 1 - t * 0.7);
          g.strokeEllipse(p.x, p.y, 40, 30);
          for (let i = 0; i < 10; i++) {
            const ang = spin + (i * Math.PI * 2) / 10;
            g.lineBetween(p.x + Math.cos(ang) * 18, p.y + Math.sin(ang) * 13, p.x + Math.cos(ang) * 26, p.y + Math.sin(ang) * 19);
          }
        });
        break;
      case 'dash':
        this.add(380, (g, t) => {
          const end = b();
          for (let i = 0; i < 4; i++) {
            const p = lerp(fromXY, end, (i + 1) / 5);
            g.fillStyle(color, (1 - t) * (0.2 + i * 0.12)).fillCircle(p.x, p.y, 7);
          }
          g.lineStyle(2, color, 1 - t).lineBetween(fromXY.x, fromXY.y, end.x, end.y);
        });
        this.slash(to, color, 120, 0.4);
        break;
      case 'multi':
        for (let i = 0; i < 3; i++) this.slash(to, color, i * 90, -0.6 + i * 1.1);
        break;
      case 'meteor': {
        const fall = 260;
        this.add(fall, (g, t) => {
          const end = b();
          const p = lerp({ x: end.x + 60, y: end.y - 140 }, end, t * t);
          g.lineStyle(3, color, 0.6).lineBetween(p.x + 12, p.y - 28, p.x, p.y);
          g.fillStyle(0xffffff, 1).fillRect(p.x - 3, p.y - 3, 6, 6);
          g.fillStyle(color, 1).fillRect(p.x - 2, p.y - 2, 4, 4);
        });
        this.ring(b, color, R, 450, 4, fall);
        this.flash(b, color, R, 300, fall);
        break;
      }
      case 'frost':
        this.ring(b, color, R, 600, 3);
        this.add(600, (g, t) => {
          const p = b();
          g.lineStyle(2, 0xffffff, 1 - t);
          for (let i = 0; i < 8; i++) {
            const ang = (i * Math.PI * 2) / 8;
            const q = { x: p.x + Math.cos(ang) * R * 0.6 * ease(t), y: p.y + Math.sin(ang) * R * 0.45 * ease(t) - t * 10 };
            g.lineBetween(q.x - 3, q.y, q.x + 3, q.y);
            g.lineBetween(q.x, q.y - 3, q.x, q.y + 3);
          }
        });
        break;
      case 'pierce':
        this.add(320, (g, t) => {
          const s = a();
          const e = b();
          g.lineStyle(6 * (1 - t), color, 0.7).lineBetween(s.x, s.y, e.x, e.y);
          g.lineStyle(2 * (1 - t), 0xffffff, 1).lineBetween(s.x, s.y, e.x, e.y);
        });
        this.spark(b, color, 120);
        break;
      case 'volley':
        for (let i = 0; i < 3; i++) this.shot('bolt', from, to, color, i * 90);
        break;
      case 'bloom':
        this.ring(a, color, R, 800, 3);
        this.add(800, (g, t) => {
          const p = a();
          for (let i = 0; i < 10; i++) {
            const ang = (i * Math.PI * 2) / 10;
            const q = { x: p.x + Math.cos(ang) * R * 0.7, y: p.y + Math.sin(ang) * R * 0.5 - t * 26 };
            g.fillStyle(i % 2 ? 0x5fae4e : 0xff9ec4, 1 - t);
            g.fillTriangle(q.x, q.y - 3, q.x + 2.5, q.y, q.x, q.y + 3);
            g.fillTriangle(q.x, q.y - 3, q.x - 2.5, q.y, q.x, q.y + 3);
          }
        });
        break;
      case 'bell':
        this.add(700, (g, t) => {
          const p = b();
          const swing = Math.sin(t * Math.PI * 4) * 4 * (1 - t);
          const x = p.x + swing;
          const y = p.y - 30;
          g.fillStyle(0xf2c14e, 1 - t * 0.6);
          g.fillTriangle(x - 7, y + 6, x + 7, y + 6, x, y - 6);
          g.fillCircle(x, y - 4, 4);
          g.fillStyle(0x8a6e34, 1 - t * 0.6).fillRect(x - 1, y + 6, 2, 2);
        });
        this.ring(b, color, 26, 600, 2);
        this.ring(b, color, 40, 600, 2, 200);
        break;
      default:
        this.ring(b, color, R, 500, 3);
        this.flash(b, color, R, 300);
    }
  }

  private ring(at: () => Pt, color: number, R: number, life: number, width: number, delay = 0): void {
    this.add(life, (g, t) => {
      const p = at();
      const r = R * ease(t);
      g.lineStyle(width, color, 1 - t).strokeEllipse(p.x, p.y + 6, r * 2, r * 1.4);
    }, delay);
  }

  private flash(at: () => Pt, color: number, R: number, life: number, delay = 0): void {
    this.add(life, (g, t) => {
      const p = at();
      g.fillStyle(color, 0.35 * (1 - t)).fillEllipse(p.x, p.y + 6, R * 1.6, R * 1.1);
    }, delay);
  }

  private debris(at: () => Pt, color: number, R: number, life: number): void {
    this.add(life, (g, t) => {
      const p = at();
      g.fillStyle(color, 1 - t);
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI * 2) / 8 + 0.3;
        const d = R * ease(t);
        g.fillRect(p.x + Math.cos(ang) * d - 2, p.y + 6 + Math.sin(ang) * d * 0.7 - Math.sin(t * Math.PI) * 14 - 2, 4, 4);
      }
    });
  }

  // --- deaths and respawns -------------------------------------------------------

  death(at: Pt): void {
    this.add(900, (g, t) => {
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI * 2) / 6;
        g.fillStyle(0xd8d4cc, 0.6 * (1 - t)).fillCircle(at.x + Math.cos(ang) * 12 * ease(t), at.y + 8 + Math.sin(ang) * 5 * ease(t), 3 + t * 4);
      }
      // A little ghost floats up.
      const y = at.y - 6 - t * 34;
      g.fillStyle(0xffffff, 0.85 * (1 - t));
      g.fillCircle(at.x, y, 5);
      g.fillTriangle(at.x - 5, y, at.x + 5, y, at.x + Math.sin(t * 12) * 3, y + 10);
      g.fillStyle(0x2a1a14, 0.85 * (1 - t)).fillRect(at.x - 3, y - 1, 2, 2).fillRect(at.x + 1, y - 1, 2, 2);
    });
  }

  respawn(at: Pt, color: number): void {
    this.add(750, (g, t) => {
      const w = 22 * (1 - t * 0.6);
      g.fillStyle(color, 0.45 * (1 - t)).fillRect(at.x - w / 2, at.y - 70, w, 76);
      g.fillStyle(0xffffff, 0.5 * (1 - t)).fillRect(at.x - w / 6, at.y - 70, w / 3, 76);
      g.lineStyle(2, color, 1 - t).strokeEllipse(at.x, at.y + 6, 30 + t * 20, 10 + t * 6);
    });
  }
}
