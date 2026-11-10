// Top-down pixel view of a match. Reads snapshots only; never touches the sim state.
// Everything here is picture: where heroes are drawn (spread out, teams on their own
// side in a fight), effects, numbers and the camera never feed back into the match.
import Phaser from 'phaser';
import type { GameData, MatchEvent, RenderSnapshot, SnapshotUnit } from '../core/types';
import { approachCam, cameraTarget, groundBox, type Cam } from './camera';
import { approach, formationOffsets, labelOffsets, type FormUnit, type LabelBox, type Offset } from './formation';
import { FxPainter, type Pt } from './FxPainter';
import { heroPose, updateHeroAnims, type HeroAnim } from './heroAnim';
import { NumberBatcher, RANGED_FROM, matchFx } from './matchFx';
import { DIGIT_CHARS, DIGIT_H, DIGIT_W, digitStrip } from './pixel/digits';
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
  /** Changed by the page: follow teamfights with the camera, or always show the whole map. */
  view?: { follow: boolean };
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
const FLASH_MS = 70;
const FLASH_GAP = 350; // a hero hit many times a second flashes now and then, not all the time
const FLASH_HIT = 0.02; // only hits worth this share of a hero's health flash
const HEAL_SHOWN = 0.05; // smaller heals (slow regeneration) get no number
const NUMBER_MS = 700;
const JUMP = 120; // world units: a respawn or a dash, not walking

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
  glow: number; // the hero's effect colour
  offset: Offset; // where it is drawn relative to where the match has it (world units)
  labelOffset: Offset; // screen-pixel nudge so nearby hero labels do not overlap
  flashUntil: number;
  maxHp: number;
}

interface FloatNumber { text: Phaser.GameObjects.BitmapText; start: number; x: number; y: number }

export class MatchScene extends Phaser.Scene {
  private opts!: SceneOptions;
  private dyn!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private painter!: FxPainter;
  private heroes = new Map<string, HeroView>();
  private props = new Map<string, Phaser.GameObjects.Image>(); // towers, bases, objectives, camps
  private creeps = new Map<string, Phaser.GameObjects.Image[]>(); // one small squad per creep wave
  private heroAnims = new Map<string, HeroAnim>();
  private where = new Map<string, Pt>(); // chest height of every unit on screen, for effects
  private numbers: FloatNumber[] = [];
  private batcher = new NumberBatcher();
  private lastSnap!: RenderSnapshot;
  private nodeXY = new Map<string, { x: number; y: number }>();
  private popupSlots = new Map<string, { until: number; count: number }>();
  private fight: Set<string> | null = null; // player ids in the current teamfight
  private cam: Cam = { zoom: 1, x: VIEW / 2, y: VIEW / 2 };
  private groundKey = '';
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
    this.painter = new FxPainter(this.add.graphics().setDepth(5), (id) => this.where.get(id) ?? null, S);
    this.hud = this.add.graphics().setDepth(10);
    this.lastSnap = this.opts.player.cur;
    for (const n of data.match.map.nodes) this.nodeXY.set(n.id, { x: n.x, y: n.y });
    // Pixel digits for damage numbers, as a fixed-width bitmap font.
    if (!this.textures.exists('digits')) this.textures.addCanvas('digits', makeSprite(digitStrip(), { w: '#ffffff', o: '#1b1220' }));
    if (!this.cache.bitmapFont.exists('digits')) {
      this.cache.bitmapFont.add('digits', Phaser.GameObjects.RetroFont.Parse(this, {
        image: 'digits', width: DIGIT_W, height: DIGIT_H, chars: DIGIT_CHARS, charsPerRow: DIGIT_CHARS.length,
        'offset.x': 0, 'offset.y': 0, 'spacing.x': 0, 'spacing.y': 0, lineSpacing: 0,
      }));
    }
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
  private prop(id: string, name: MapSprite | null, side: 'BLUE' | 'RED' | null, X: number, Y: number, glow?: string, lift = 0): void {
    let img = this.props.get(id);
    if (!name) { img?.setVisible(false); return; }
    const key = this.mapTexture(name, side, glow);
    if (!img) {
      img = this.add.image(X, Y, key).setOrigin(0.5, 1).setScale(MAP_SCALE);
      this.props.set(id, img);
    }
    // Drawn just behind anyone standing on the same spot.
    img.setTexture(key).setVisible(true).setPosition(X, Y + (FOOT[name] ?? 0) * MAP_SCALE - lift).setDepth(1 + (Y - 6) / 1000);
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
    const now = this.time.now;
    const snaps = p.advance(deltaMs / 1000);
    if (snaps.length > 0) {
      for (const s of snaps) {
        updateHeroAnims(this.heroAnims, this.lastSnap, s, now);
        this.effects(this.lastSnap, s, now);
        this.lastSnap = s;
      }
      this.opts.onTick(snaps);
    }
    if (p.over) this.fight = null;
    this.render(p.prev, p.cur, p.alpha, Math.min(0.1, deltaMs / 1000));
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

  /** Where every living hero should be drawn this frame (world units), easing towards its formation spot. */
  private placeHeroes(prev: RenderSnapshot, cur: RenderSnapshot, alpha: number, dt: number): Map<string, { x: number; y: number }> {
    const live: FormUnit[] = [];
    const pos = new Map<string, { x: number; y: number }>();
    const before = new Map(prev.units.map((u) => [u.id, u]));
    for (const u of cur.units) {
      if (u.kind !== 'HERO') continue;
      const p = lerpUnit(prev, cur, u.id, alpha) ?? u;
      pos.set(u.id, p);
      const range = this.opts.data.heroById[u.heroId ?? '']?.base.attackRange ?? 100;
      if (u.alive) live.push({ id: u.id, side: u.side ?? 'BLUE', x: p.x, y: p.y, melee: range < RANGED_FROM });
    }
    const targets = formationOffsets(live);
    const out = new Map<string, { x: number; y: number }>();
    for (const u of cur.units) {
      if (u.kind !== 'HERO') continue;
      const view = this.heroes.get(u.id);
      const p = pos.get(u.id)!;
      if (view && u.alive) {
        const t = targets.get(u.id) ?? { dx: 0, dy: 0 };
        const b = before.get(u.id);
        const jumped = !b || !b.alive || Math.hypot(b.x - u.x, b.y - u.y) > JUMP;
        view.offset = jumped ? t : approach(view.offset, t, dt);
      }
      const o = view?.offset ?? { dx: 0, dy: 0 };
      out.set(u.id, { x: p.x + o.dx, y: p.y + o.dy });
    }
    return out;
  }

  private render(prev: RenderSnapshot, cur: RenderSnapshot, alpha: number, dt: number): void {
    const g = this.dyn;
    g.clear();
    const hud = this.hud;
    hud.clear();
    const now = this.time.now;
    const { colors } = this.opts;
    const teamColor = (side: 'BLUE' | 'RED' | null) => (side ? hex(colors[side]) : 0xcccccc);
    const seenCreeps = new Set<string>();
    const heroAt = this.placeHeroes(prev, cur, alpha, dt);
    const boxes: LabelBox[] = [];
    for (const u of cur.units) {
      if (u.kind !== 'HERO' || !u.alive) continue;
      const p = heroAt.get(u.id)!;
      const v = this.heroes.get(u.id);
      const text = `${u.level ?? 1} ${this.opts.names[u.playerId ?? ''] ?? ''}`;
      boxes.push({ id: u.id, x: sx(p.x), y: sy(p.y) - HERO_TOP - 8, w: v?.label.width || Math.max(36, text.length * 7) });
    }
    const labelTargets = labelOffsets(boxes);

    for (const u of cur.units) {
      const { x, y } = u.kind === 'HERO' ? heroAt.get(u.id)! : this.unitXY(prev, cur, u, alpha);
      const X = sx(x);
      const Y = sy(y);
      switch (u.kind) {
        case 'TOWER':
        case 'BASE': {
          const name: MapSprite = u.kind === 'BASE' ? (u.alive ? 'base' : 'baseRuin') : u.alive ? 'tower' : 'towerRuin';
          this.prop(u.id, name, u.side, X, Y);
          this.where.set(u.id, { x: X, y: Y - (u.kind === 'TOWER' ? 26 : 22) });
          if (u.alive && u.hp < u.maxHp) this.hpBar(hud, X, Y - this.propTop(name) - 4, u.kind === 'BASE' ? 40 : 26, u.hp / u.maxHp, 0x7cfc7c);
          break;
        }
        case 'CREEP':
          this.creepSquad(u, X, Y, now, seenCreeps);
          this.where.set(u.id, { x: X, y: Y - 6 });
          break;
        case 'OBJECTIVE': {
          const glow = OBJECTIVE_GLOW[u.id] ?? '#ffffff';
          const name: MapSprite | null = u.id === 'CORE' ? (u.alive ? 'core' : 'pedestal') : u.alive ? 'warden' : null;
          // The crystal floats up and down a little.
          const lift = name === 'core' ? Math.round((Math.sin(now / 400) + 1) * 1.5) * MAP_SCALE / 2 : 0;
          this.prop(u.id, name, null, X, Y, glow, lift);
          this.where.set(u.id, { x: X, y: Y - 14 });
          if (u.alive) this.hpBar(hud, X, Y - this.propTop(name ?? 'warden') - 4, 30, u.hp / u.maxHp, hex(glow));
          break;
        }
        case 'CAMP': {
          const name: MapSprite = u.id.endsWith('CORE') ? 'bigBeast' : 'beast';
          this.prop(u.id, u.alive ? name : null, null, X, Y);
          this.where.set(u.id, { x: X, y: Y - 6 });
          if (u.alive && u.hp < u.maxHp) this.hpBar(hud, X, Y - this.propTop(name) - 4, 20, u.hp / u.maxHp, 0xd9b3ff);
          break;
        }
        case 'HERO':
          this.drawHero(u, X, Y, now, dt, g, teamColor(u.side ?? 'BLUE'), labelTargets.get(u.id) ?? { dx: 0, dy: 0 });
          break;
      }
    }
    for (const [id, imgs] of this.creeps) {
      if (seenCreeps.has(id)) continue;
      for (const img of imgs) img.destroy();
      this.creeps.delete(id);
      this.where.delete(id);
    }
    this.painter.frame(now);
    this.floatNumbers(now);
    this.moveCamera(cur, heroAt, dt);
  }

  private drawHero(u: SnapshotUnit, X: number, Y: number, now: number, dt: number, g: Phaser.GameObjects.Graphics, team: number, labelTarget: Offset): void {
    const side = u.side ?? 'BLUE';
    let view = this.heroes.get(u.id);
    if (!view) {
      const heroId = u.heroId ?? '';
      const archetype = this.opts.data.heroById[heroId]?.archetype;
      view = {
        sprite: this.add.image(X, Y, this.heroTexture(heroId, side, 'stand')).setOrigin(0.5, 1).setScale(HERO_SCALE),
        label: this.add.text(X, Y, '', { fontSize: '11px', color: '#ffffff', fontFamily: 'sans-serif', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(11),
        level: -1,
        heroId,
        side,
        glow: hex(heroPalette(heroId, '#000000', archetype).x ?? '#ffffff'),
        offset: { dx: 0, dy: 0 },
        labelOffset: labelTarget,
        flashUntil: 0,
        maxHp: u.maxHp,
      };
      this.heroes.set(u.id, view);
    }
    view.maxHp = u.maxHp; // grows with level
    if (view.level !== u.level) {
      view.level = u.level ?? 1;
      view.label.setText(`${view.level} ${this.opts.names[u.playerId ?? ''] ?? ''}`);
    }
    view.labelOffset = u.alive ? approach(view.labelOffset, labelTarget, dt, 10) : { dx: 0, dy: 0 };
    const anim = this.heroAnims.get(u.id);
    const pose = anim ? heroPose(anim, now) : { frame: 'stand' as const, flip: side === 'RED', alpha: u.alive ? 1 : 0, bob: 0 };
    const flash = now < view.flashUntil && u.alive;
    view.sprite
      .setTexture(this.heroTexture(view.heroId, side, pose.frame))
      .setPosition(X, Y - pose.bob * HERO_SCALE)
      .setFlipX(pose.flip)
      .setAlpha(pose.alpha)
      .setVisible(pose.alpha > 0)
      .setDepth(1 + Y / 1000)
      .setTint(flash ? 0xffffff : u.stunned ? 0xaaaaff : 0xffffff)
      .setTintMode(flash ? Phaser.TintModes.FILL : Phaser.TintModes.MULTIPLY);
    view.label.setPosition(X + view.labelOffset.dx, Y - HERO_TOP - 8 + view.labelOffset.dy).setAlpha(u.alive ? 1 : 0);
    this.where.set(u.id, { x: X, y: Y - CHEST });
    if (u.alive) {
      // Team-coloured ring under the feet, so the sides stay easy to tell apart.
      g.lineStyle(2, team, 0.9).strokeEllipse(X, Y, 26, 9);
      this.hpBar(this.hud, X, Y - HERO_TOP - 5, 24, u.hp / u.maxHp, side === 'BLUE' ? 0x6fb3ff : 0xff7b7b);
      if (u.shield && u.shield > 0) this.hud.lineStyle(2, 0xffe27a, 0.9).strokeEllipse(X, Y - HERO_TOP / 2, 34, HERO_TOP + 8);
      if (u.stunned) this.stunStars(this.hud, X, Y - HERO_TOP - 12, now);
    }
  }

  /** Little stars circling over a stunned hero. */
  private stunStars(g: Phaser.GameObjects.Graphics, x: number, y: number, now: number): void {
    for (let i = 0; i < 3; i++) {
      const a = now / 220 + (i * Math.PI * 2) / 3;
      g.fillStyle(0xffe27a, 1).fillRect(Math.round(x + Math.cos(a) * 10) - 2, Math.round(y + Math.sin(a) * 3) - 2, 4, 4);
    }
  }

  /** Turns one new snapshot into effects, numbers and popups. */
  private effects(prev: RenderSnapshot, snap: RenderSnapshot, now: number): void {
    const team = (id: string) => hex(this.opts.colors[this.heroes.get(id)?.side ?? 'BLUE']);
    for (const f of matchFx(prev, snap, this.opts.data)) {
      switch (f.kind) {
        case 'shot': this.painter.shot(f.style, f.from, f.to, this.heroes.get(f.from)?.glow ?? 0xffffff); break;
        case 'slash': this.painter.slash(f.to); break;
        case 'skill': this.painter.skill(f.style, f.from, f.to, this.heroes.get(f.from)?.glow ?? 0xffffff, f.radius, { x: sx(f.fromX), y: sy(f.fromY) - CHEST }); break;
        case 'hurt': {
          this.batcher.add(f.id, f.amount, 0, now);
          const v = this.heroes.get(f.id);
          if (v && f.amount >= v.maxHp * FLASH_HIT && now > v.flashUntil - FLASH_MS + FLASH_GAP) v.flashUntil = now + FLASH_MS;
          break;
        }
        case 'heal': this.batcher.add(f.id, 0, f.amount, now); break;
        case 'death': { const at = this.where.get(f.id); if (at) this.painter.death(at); break; }
        case 'respawn': {
          const u = snap.units.find((x) => x.id === f.id);
          if (u) this.painter.respawn({ x: sx(u.x), y: sy(u.y) - CHEST }, team(f.id));
          break;
        }
      }
    }
    for (const ev of snap.newEvents) {
      if (ev.type === 'TEAMFIGHT_START') this.fight = new Set(ev.actors);
      if (ev.type === 'TEAMFIGHT_END') this.fight = null;
      this.popup(ev);
    }
  }

  /** Damage (white, yellow for big hits) and healing (green) numbers rising over heroes. */
  private floatNumbers(now: number): void {
    for (const n of this.batcher.flush(now)) {
      const at = this.where.get(n.id);
      const u = this.lastSnap.units.find((x) => x.id === n.id);
      if (!at || !u || (n.heal && n.value < u.maxHp * HEAL_SHOWN)) continue;
      const big = !n.heal && n.value >= u.maxHp * 0.2;
      let slot = this.numbers.find((x) => !x.text.visible);
      if (!slot) {
        slot = { text: this.add.bitmapText(0, 0, 'digits', '').setOrigin(0.5, 1).setDepth(12), start: 0, x: 0, y: 0 };
        this.numbers.push(slot);
      }
      const jitter = ((n.value * 7) % 13) - 6;
      slot.start = now;
      slot.x = at.x + jitter;
      slot.y = at.y - HERO_TOP + CHEST - 6;
      slot.text.setText(`${n.heal ? '+' : '-'}${n.value}`).setScale(big ? 3 : 2).setTint(n.heal ? 0x7cfc7c : big ? 0xffd34d : 0xffffff).setVisible(true);
    }
    for (const n of this.numbers) {
      if (!n.text.visible) continue;
      const t = (now - n.start) / NUMBER_MS;
      if (t >= 1) { n.text.setVisible(false); continue; }
      n.text.setPosition(n.x, n.y - 22 * (1 - (1 - t) * (1 - t))).setAlpha(t < 0.6 ? 1 : (1 - t) / 0.4);
    }
  }

  /** Follows a teamfight when that is switched on; the painted ground moves along with the camera. */
  private moveCamera(cur: RenderSnapshot, heroAt: Map<string, { x: number; y: number }>, dt: number): void {
    let centre: { x: number; y: number } | null = null;
    if (this.fight) {
      const inFight = cur.units.filter((u) => u.kind === 'HERO' && u.alive && this.fight!.has(u.playerId ?? ''));
      if (inFight.length > 0) {
        const xs = inFight.map((u) => heroAt.get(u.id)!);
        centre = { x: sx(xs.reduce((a, p) => a + p.x, 0) / xs.length), y: sy(xs.reduce((a, p) => a + p.y, 0) / xs.length) };
      }
    }
    this.cam = approachCam(this.cam, cameraTarget(VIEW, centre, this.opts.view?.follow ?? true), dt, VIEW);
    const main = this.cameras.main;
    main.setZoom(this.cam.zoom);
    main.centerOn(this.cam.x, this.cam.y);
    const canvas = this.game.canvas;
    const box = groundBox(this.cam, VIEW, canvas.clientWidth || VIEW);
    const key = `${box.size.toFixed(1)}|${box.x.toFixed(1)}|${box.y.toFixed(1)}`;
    if (key !== this.groundKey) {
      this.groundKey = key;
      canvas.style.backgroundSize = `${box.size}px ${box.size}px`;
      canvas.style.backgroundPosition = `${box.x}px ${box.y}px`;
    }
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
    const now = this.time.now;
    const prev = this.popupSlots.get(ev.nodeId!);
    const slot = prev && now < prev.until ? prev.count + 1 : 0;
    this.popupSlots.set(ev.nodeId!, { until: now + 900, count: slot });
    const color = ev.side ? this.opts.colors[ev.side] : '#ffe27a';
    const y0 = sy(pos.y) - 34 - (slot % 3) * 18;
    const t = this.add.text(sx(pos.x), y0, text, { fontSize: ev.type === 'KILL' ? '13px' : '16px', color, fontFamily: 'sans-serif', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5).setDepth(13);
    this.tweens.add({ targets: t, y: y0 - 26, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
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
