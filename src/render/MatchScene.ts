// Top-down pixel view of a match. Reads snapshots only; never touches the sim state.
import Phaser from 'phaser';
import type { GameData, MatchEvent, RenderSnapshot, SnapshotUnit } from '../core/types';
import { heroPose, updateHeroAnims, type HeroAnim } from './heroAnim';
import { HERO_H, heroPalette, heroRows, type HeroFrame } from './pixel/heroArt';
import { makeSprite } from './pixel/raster';
import { lerpUnit, type MatchPlayer } from './player';

export const VIEW = 720; // canvas size in pixels
const MARGIN = 20;
const S = (VIEW - MARGIN * 2) / 1000; // world -> screen scale
const sx = (x: number) => MARGIN + x * S;
const sy = (y: number) => MARGIN + y * S;

export interface SceneOptions {
  player: MatchPlayer;
  data: GameData;
  colors: { BLUE: string; RED: string };
  names: Record<string, string>; // playerId -> display name
  onTick: (snaps: RenderSnapshot[]) => void;
  onFps?: (fps: number) => void;
}

const HERO_SCALE = 2; // screen pixels per sprite pixel
const HERO_TOP = (HERO_H - 3) * HERO_SCALE; // roughly the top of a hero's head above its feet
const CHEST = 6 * HERO_SCALE;

function hex(c: string): number {
  return Number.parseInt(c.replace('#', ''), 16);
}

interface HeroView {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  level: number;
  heroId: string;
  side: 'BLUE' | 'RED';
}

interface Fx {
  until: number;
  draw: (g: Phaser.GameObjects.Graphics, life: number) => void;
  life: number;
}

export class MatchScene extends Phaser.Scene {
  private opts!: SceneOptions;
  private dyn!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private fxLayer!: Phaser.GameObjects.Graphics;
  private heroes = new Map<string, HeroView>();
  private heroAnims = new Map<string, HeroAnim>();
  private lastSnap!: RenderSnapshot;
  private fx: Fx[] = [];
  private nodeXY = new Map<string, { x: number; y: number }>();
  private frames = 0;
  private fpsT = 0;

  constructor() {
    super('match');
  }

  init(opts: SceneOptions): void {
    this.opts = opts;
  }

  create(): void {
    const { data } = this.opts;
    this.drawMap(data);
    this.dyn = this.add.graphics();
    this.fxLayer = this.add.graphics().setDepth(5);
    this.hud = this.add.graphics().setDepth(10);
    this.lastSnap = this.opts.player.cur;
    for (const n of data.match.map.nodes) this.nodeXY.set(n.id, { x: n.x, y: n.y });
  }

  private drawMap(data: GameData): void {
    const g = this.add.graphics();
    g.fillStyle(0x1d3324, 1).fillRect(0, 0, VIEW, VIEW);
    // river along y = x
    g.lineStyle(46 * S * 2, 0x24506b, 1).lineBetween(sx(0), sy(0), sx(1000), sy(1000));
    const nodes = new Map(data.match.map.nodes.map((n) => [n.id, n]));
    // jungle paths
    g.lineStyle(10 * S * 2, 0x2b4632, 1);
    for (const [a, b] of data.match.map.edges) {
      const na = nodes.get(a)!;
      const nb = nodes.get(b)!;
      g.lineBetween(sx(na.x), sy(na.y), sx(nb.x), sy(nb.y));
    }
    // lanes
    g.lineStyle(30 * S * 2, 0x6b5a3c, 1);
    for (const lane of Object.values(data.match.map.lanes)) {
      for (let i = 1; i < lane.length; i++) {
        const na = nodes.get(lane[i - 1]!)!;
        const nb = nodes.get(lane[i]!)!;
        g.lineBetween(sx(na.x), sy(na.y), sx(nb.x), sy(nb.y));
      }
    }
    for (const n of data.match.map.nodes) {
      if (n.type === 'JUNGLE') g.fillStyle(0x15261a, 1).fillCircle(sx(n.x), sy(n.y), 9);
      if (n.type === 'OBJECTIVE') g.lineStyle(2, 0x9fd6ff, 0.8).strokeCircle(sx(n.x), sy(n.y), 14);
    }
    for (const o of data.match.objectives) {
      const n = nodes.get(o.nodeId)!;
      this.add.text(sx(n.x), sy(n.y) + 18, o.name, { fontSize: '11px', color: '#9fd6ff', fontFamily: 'sans-serif' }).setOrigin(0.5, 0);
    }
  }

  update(_time: number, deltaMs: number): void {
    const p = this.opts.player;
    const snaps = p.advance(deltaMs / 1000);
    if (snaps.length > 0) {
      for (const s of snaps) {
        updateHeroAnims(this.heroAnims, this.lastSnap, s, this.time.now);
        this.lastSnap = s;
        this.spawnFx(s);
      }
      this.opts.onTick(snaps);
    }
    this.render(p.prev, p.cur, p.alpha);
    this.frames++;
    this.fpsT += deltaMs;
    if (this.fpsT >= 1000) {
      this.opts.onFps?.(Math.round((this.frames * 1000) / this.fpsT));
      this.frames = 0;
      this.fpsT = 0;
    }
  }

  private unitXY(prev: RenderSnapshot, cur: RenderSnapshot, u: SnapshotUnit, alpha: number) {
    return u.kind === 'HERO' || u.kind === 'CREEP' ? lerpUnit(prev, cur, u.id, alpha) ?? u : u;
  }

  private hpBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, frac: number, color: number): void {
    g.fillStyle(0x000000, 0.7).fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    g.fillStyle(color, 1).fillRect(x - w / 2, y, Math.max(0, w * frac), 3);
  }

  /** The texture for one hero frame in one team colour, made on first use. */
  private heroTexture(heroId: string, side: 'BLUE' | 'RED', frame: HeroFrame): string {
    const key = `hero:${heroId}:${side}:${frame}`;
    if (!this.textures.exists(key)) {
      const archetype = this.opts.data.heroById[heroId]?.archetype;
      this.textures.addCanvas(key, makeSprite(heroRows(heroId, frame, archetype), heroPalette(heroId, this.opts.colors[side], archetype)));
    }
    return key;
  }

  private render(prev: RenderSnapshot, cur: RenderSnapshot, alpha: number): void {
    const g = this.dyn;
    g.clear();
    const hud = this.hud;
    hud.clear();
    const now = this.time.now;
    const { colors } = this.opts;
    const teamColor = (side: 'BLUE' | 'RED' | null) => (side ? hex(colors[side]) : 0xcccccc);

    for (const u of cur.units) {
      const { x, y } = this.unitXY(prev, cur, u, alpha);
      const X = sx(x);
      const Y = sy(y);
      switch (u.kind) {
        case 'TOWER':
        case 'BASE': {
          const size = u.kind === 'BASE' ? 26 : 16;
          if (!u.alive) {
            g.fillStyle(0x444444, 1).fillRect(X - size / 2, Y - size / 4, size, size / 2);
            break;
          }
          g.fillStyle(0x111111, 1).fillRect(X - size / 2 - 2, Y - size / 2 - 2, size + 4, size + 4);
          g.fillStyle(teamColor(u.side), 1).fillRect(X - size / 2, Y - size / 2, size, size);
          g.fillStyle(0xffffff, 0.25).fillRect(X - size / 2 + 3, Y - size / 2 + 3, size - 6, 3);
          this.hpBar(g, X, Y - size / 2 - 8, size + 8, u.hp / u.maxHp, 0x7cfc7c);
          break;
        }
        case 'CREEP': {
          if (!u.alive) break;
          const c = teamColor(u.side);
          g.fillStyle(c, 0.9);
          g.fillRect(X - 6, Y - 3, 4, 4);
          g.fillRect(X - 1, Y - 5, 4, 4);
          g.fillRect(X + 3, Y - 1, 4, 4);
          g.fillStyle(0x000000, 0.6).fillRect(X - 6, Y + 4, 12, 2);
          g.fillStyle(c, 1).fillRect(X - 6, Y + 4, 12 * (u.hp / u.maxHp), 2);
          break;
        }
        case 'OBJECTIVE': {
          if (!u.alive) break;
          g.fillStyle(0x9fd6ff, 1).fillCircle(X, Y, 8);
          g.fillStyle(0x1d3324, 1).fillCircle(X, Y, 4);
          this.hpBar(g, X, Y - 16, 26, u.hp / u.maxHp, 0x9fd6ff);
          break;
        }
        case 'HERO': {
          const side = u.side ?? 'BLUE';
          let view = this.heroes.get(u.id);
          if (!view) {
            const heroId = u.heroId ?? '';
            view = {
              sprite: this.add.image(X, Y, this.heroTexture(heroId, side, 'stand')).setOrigin(0.5, 1).setScale(HERO_SCALE),
              label: this.add.text(X, Y, '', { fontSize: '11px', color: '#ffffff', fontFamily: 'sans-serif', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(11),
              level: -1,
              heroId,
              side,
            };
            this.heroes.set(u.id, view);
          }
          if (view.level !== u.level) {
            view.level = u.level ?? 1;
            view.label.setText(`${view.level} ${this.opts.names[u.playerId ?? ''] ?? ''}`);
          }
          const anim = this.heroAnims.get(u.id);
          const pose = anim ? heroPose(anim, now) : { frame: 'stand' as const, flip: side === 'RED', alpha: u.alive ? 1 : 0, bob: 0 };
          view.sprite
            .setTexture(this.heroTexture(view.heroId, side, pose.frame))
            .setPosition(X, Y - pose.bob * HERO_SCALE)
            .setFlipX(pose.flip)
            .setAlpha(pose.alpha)
            .setVisible(pose.alpha > 0)
            .setDepth(1 + Y / 1000)
            .setTint(u.stunned ? 0xaaaaff : 0xffffff);
          view.label.setPosition(X, Y - HERO_TOP - 8).setAlpha(u.alive ? 1 : 0);
          if (u.alive) {
            // Team-coloured ring under the feet, so the sides stay easy to tell apart.
            g.lineStyle(2, teamColor(side), 0.9).strokeEllipse(X, Y, 26, 9);
            this.hpBar(hud, X, Y - HERO_TOP - 5, 24, u.hp / u.maxHp, side === 'BLUE' ? 0x6fb3ff : 0xff7b7b);
            if (u.shield && u.shield > 0) hud.lineStyle(2, 0xffe27a, 0.9).strokeEllipse(X, Y - HERO_TOP / 2, 34, HERO_TOP + 8);
            if (u.stunned) this.stunStars(hud, X, Y - HERO_TOP - 12, now);
          }
          break;
        }
      }
    }
    // attack lines / skill flashes
    const f = this.fxLayer;
    f.clear();
    this.fx = this.fx.filter((e) => e.until > now);
    for (const e of this.fx) e.draw(f, (e.until - now) / e.life);
  }

  /** Little stars circling over a stunned hero. */
  private stunStars(g: Phaser.GameObjects.Graphics, x: number, y: number, now: number): void {
    for (let i = 0; i < 3; i++) {
      const a = now / 220 + (i * Math.PI * 2) / 3;
      g.fillStyle(0xffe27a, 1).fillRect(Math.round(x + Math.cos(a) * 10) - 2, Math.round(y + Math.sin(a) * 3) - 2, 4, 4);
    }
  }

  private spawnFx(snap: RenderSnapshot): void {
    const byId = new Map(snap.units.map((u) => [u.id, u]));
    const now = this.time.now;
    for (const a of snap.attacks) {
      const from = byId.get(a.from);
      const to = byId.get(a.to);
      if (!from || !to) continue;
      const fromHero = from.kind === 'HERO';
      if (a.kind === 'SKILL') {
        const life = 450;
        const tx = sx(to.x);
        const ty = sy(to.y) - (to.kind === 'HERO' ? CHEST : 0);
        this.fx.push({ until: now + life, life, draw: (g, k) => { g.lineStyle(3, 0xfff07a, k).strokeCircle(tx, ty, 10 + (1 - k) * 26); g.fillStyle(0xfff07a, 0.25 * k).fillCircle(tx, ty, 18); } });
      } else if (fromHero || from.kind === 'TOWER' || from.kind === 'BASE') {
        const life = 160;
        // Heroes now stand taller than a dot: shoot from and at the chest.
        const x1 = sx(from.x), y1 = sy(from.y) - (fromHero ? CHEST : 0), x2 = sx(to.x), y2 = sy(to.y) - (to.kind === 'HERO' ? CHEST : 0);
        const color = from.kind === 'HERO' ? 0xffffff : 0xffa64d;
        this.fx.push({ until: now + life, life, draw: (g, k) => { g.lineStyle(fromHero ? 1.5 : 2.5, color, 0.8 * k).lineBetween(x1, y1, x2, y2); } });
      }
    }
    for (const ev of snap.newEvents) this.popup(ev);
  }

  private popup(ev: MatchEvent): void {
    const pos = ev.nodeId ? this.nodeXY.get(ev.nodeId) : undefined;
    if (!pos) return;
    let text: string;
    if (ev.type === 'KILL') text = `击杀 ${this.opts.names[ev.targets?.[0] ?? ''] ?? ''}`;
    else if (ev.type === 'TOWER_DESTROYED') text = '推塔！';
    else if (ev.type === 'OBJECTIVE_TAKEN') text = `拿下${String(ev.detail?.objectiveName ?? '')}`;
    else if (ev.type === 'TEAMFIGHT_START') text = '团战！';
    else return;
    const color = ev.side ? this.opts.colors[ev.side] : '#ffe27a';
    const t = this.add.text(sx(pos.x), sy(pos.y) - 24, text, { fontSize: ev.type === 'KILL' ? '13px' : '16px', color, fontFamily: 'sans-serif', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }
}

/** Mounts the Phaser game into `parent`. Returns a cleanup function. */
export function mountMatch(parent: HTMLElement, opts: SceneOptions): () => void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW,
    height: VIEW,
    backgroundColor: '#12141a',
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    scene: [],
    banner: false,
  });
  game.scene.add('match', MatchScene, true, opts);
  return () => game.destroy(true);
}
