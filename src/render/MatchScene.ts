// Top-down pixel view of a match. Reads snapshots only; never touches the sim state.
import Phaser from 'phaser';
import type { GameData, MatchEvent, RenderSnapshot, SnapshotUnit } from '../core/types';
import { heroPose, updateHeroAnims, type HeroAnim } from './heroAnim';
import { HERO_H, heroPalette, heroRows, type HeroFrame } from './pixel/heroArt';
import { MAP_PX, MAP_SPRITES, groundPixels, mapPalette, type MapSprite } from './pixel/mapArt';
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
const MAP_SCALE = VIEW / MAP_PX; // the ground and map sprites use the same pixel size as heroes
/** Glow colour of each objective's crystal and eyes. */
const OBJECTIVE_GLOW: Record<string, string> = { WARDEN: '#7fd3ff', CORE: '#c99bff' };
/** Map sprites stand a little below their node, so the node sits in the middle of the sprite. */
const FOOT: Partial<Record<MapSprite, number>> = { tower: 5, towerRuin: 5, base: 8, baseRuin: 8, warden: 7, core: 7, pedestal: 7, beast: 4, bigBeast: 4 };
const CREEPS_PER_WAVE = 3;

function hex(c: string): number {
  return Number.parseInt(c.replace('#', ''), 16);
}

let ground: { map: GameData['match']['map']; url: string } | null = null;

/** The painted ground as an image address, made once and reused by later matches. */
function groundUrl(data: GameData): string {
  if (ground?.map !== data.match.map) {
    const c = document.createElement('canvas');
    c.width = MAP_PX;
    c.height = MAP_PX;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(groundPixels(data.match.map)), MAP_PX, MAP_PX), 0, 0);
    ground = { map: data.match.map, url: c.toDataURL('image/png') };
  }
  return ground.url;
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
  private props = new Map<string, Phaser.GameObjects.Image>(); // towers, bases, objectives, camps
  private creeps = new Map<string, Phaser.GameObjects.Image[]>(); // one small squad per creep wave
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
    // The ground never changes, so it is the canvas's CSS background instead of something
    // redrawn every frame (a full-screen picture per frame is slow on phones without a fast GPU).
    const style = this.game.canvas.style;
    style.backgroundImage = `url(${groundUrl(data)})`;
    style.backgroundSize = '100% 100%';
    style.imageRendering = 'pixelated';
    const nodes = new Map(data.match.map.nodes.map((n) => [n.id, n]));
    for (const o of data.match.objectives) {
      const n = nodes.get(o.nodeId)!;
      this.add.text(sx(n.x), sy(n.y) + 26, o.name, { fontSize: '12px', color: OBJECTIVE_GLOW[o.id] ?? '#ffffff', fontFamily: 'sans-serif', fontStyle: 'bold', stroke: '#1d2a3a', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(0.5);
    }
  }

  /** The texture for a map sprite, made on first use. */
  private mapTexture(name: MapSprite, side: 'BLUE' | 'RED' | null, glow?: string): string {
    const key = `map:${name}:${side ?? '-'}:${glow ?? ''}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, makeSprite(MAP_SPRITES[name], mapPalette(side ? this.opts.colors[side] : null, glow)));
    return key;
  }

  /** Shows (or hides, when `name` is null) the sprite standing for one structure, objective or camp. */
  private prop(id: string, name: MapSprite | null, side: 'BLUE' | 'RED' | null, X: number, Y: number, glow?: string, lift = 0): Phaser.GameObjects.Image | null {
    let img = this.props.get(id);
    if (!name) { img?.setVisible(false); return null; }
    const key = this.mapTexture(name, side, glow);
    if (!img) {
      img = this.add.image(X, Y, key).setOrigin(0.5, 1).setScale(MAP_SCALE);
      this.props.set(id, img);
    }
    // Drawn just behind anyone standing on the same spot.
    return img.setTexture(key).setVisible(true).setPosition(X, Y + (FOOT[name] ?? 0) * MAP_SCALE - lift).setDepth(1 + (Y - 6) / 1000);
  }

  /** Height of a map sprite on screen, for placing its health bar. */
  private propTop(name: MapSprite): number {
    return (MAP_SPRITES[name].length - (FOOT[name] ?? 0)) * MAP_SCALE;
  }

  /** A creep wave as a squad of small soldiers; fewer stay standing as the wave loses health. */
  private creepSquad(u: SnapshotUnit, X: number, Y: number, now: number, seen: Set<string>): void {
    seen.add(u.id);
    let imgs = this.creeps.get(u.id);
    if (!imgs) {
      imgs = Array.from({ length: CREEPS_PER_WAVE }, () => this.add.image(X, Y, this.mapTexture('creepA', u.side)).setOrigin(0.5, 1).setScale(MAP_SCALE));
      this.creeps.set(u.id, imgs);
    }
    const standing = u.alive ? Math.max(1, Math.ceil((CREEPS_PER_WAVE * u.hp) / u.maxHp)) : 0;
    const step = Math.floor(now / 180) % 2 === 0;
    imgs.forEach((img, i) => {
      const dx = (i - 1) * 11;
      const dy = i === 1 ? -5 : 2;
      img.setVisible(i < standing)
        .setTexture(this.mapTexture(step === (i % 2 === 0) ? 'creepA' : 'creepB', u.side))
        .setFlipX(u.side === 'RED')
        .setPosition(X + dx, Y + dy)
        .setDepth(1 + (Y + dy) / 1000);
    });
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
    const seenCreeps = new Set<string>();

    for (const u of cur.units) {
      const { x, y } = this.unitXY(prev, cur, u, alpha);
      const X = sx(x);
      const Y = sy(y);
      switch (u.kind) {
        case 'TOWER':
        case 'BASE': {
          const name: MapSprite = u.kind === 'BASE' ? (u.alive ? 'base' : 'baseRuin') : u.alive ? 'tower' : 'towerRuin';
          this.prop(u.id, name, u.side, X, Y);
          if (u.alive && u.hp < u.maxHp) this.hpBar(hud, X, Y - this.propTop(name) - 4, u.kind === 'BASE' ? 40 : 26, u.hp / u.maxHp, 0x7cfc7c);
          break;
        }
        case 'CREEP':
          this.creepSquad(u, X, Y, now, seenCreeps);
          break;
        case 'OBJECTIVE': {
          const glow = OBJECTIVE_GLOW[u.id] ?? '#ffffff';
          const name: MapSprite | null = u.id === 'CORE' ? (u.alive ? 'core' : 'pedestal') : u.alive ? 'warden' : null;
          // The crystal floats up and down a little.
          const lift = name === 'core' ? Math.round((Math.sin(now / 400) + 1) * 1.5) * MAP_SCALE / 2 : 0;
          this.prop(u.id, name, null, X, Y, glow, lift);
          if (u.alive) this.hpBar(hud, X, Y - this.propTop(name ?? 'warden') - 4, 30, u.hp / u.maxHp, hex(glow));
          break;
        }
        case 'CAMP': {
          const name: MapSprite = u.id.endsWith('CORE') ? 'bigBeast' : 'beast';
          this.prop(u.id, u.alive ? name : null, null, X, Y);
          if (u.alive && u.hp < u.maxHp) this.hpBar(hud, X, Y - this.propTop(name) - 4, 20, u.hp / u.maxHp, 0xd9b3ff);
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
    for (const [id, imgs] of this.creeps) {
      if (seenCreeps.has(id)) continue;
      for (const img of imgs) img.destroy();
      this.creeps.delete(id);
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
        // Shoot from a hero's chest or a tower's window, at a hero's chest.
        const x1 = sx(from.x), y1 = sy(from.y) - (fromHero ? CHEST : from.kind === 'TOWER' ? 26 : 22), x2 = sx(to.x), y2 = sy(to.y) - (to.kind === 'HERO' ? CHEST : 0);
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
    transparent: true, // the ground shows through (see drawMap)
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    scene: [],
    banner: false,
  });
  game.scene.add('match', MatchScene, true, opts);
  return () => game.destroy(true);
}
