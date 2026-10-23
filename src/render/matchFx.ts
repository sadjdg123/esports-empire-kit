// What to show between two snapshots: projectiles, sword slashes, skill effects,
// damage and heal numbers, deaths and respawns. Pure: reads snapshots and hero data,
// never the match itself, so the result of a match cannot change.

import type { GameData, HeroDef, RenderSnapshot, SnapshotUnit } from '../core/types';

export type ShotStyle = 'arrow' | 'bolt' | 'orb' | 'fire';
export type SkillStyle = 'quake' | 'thorns' | 'dash' | 'multi' | 'meteor' | 'frost' | 'pierce' | 'volley' | 'bloom' | 'bell' | 'burst'
  | 'charge' | 'feathers' | 'brand' | 'thunder' | 'ripple' | 'bulwark';

export type MatchFx =
  | { kind: 'shot'; style: ShotStyle; from: string; to: string; heroId?: string }
  | { kind: 'slash'; from: string; to: string; heroId: string }
  | { kind: 'skill'; style: SkillStyle; from: string; to: string; heroId: string; radius: number; fromX: number; fromY: number }
  | { kind: 'hurt'; id: string; amount: number }
  | { kind: 'heal'; id: string; amount: number }
  | { kind: 'death'; id: string }
  | { kind: 'respawn'; id: string };

/** How each hero's skill looks. Heroes added later get a look from their skill's kind. */
const SKILL_STYLE: Record<string, SkillStyle> = {
  zhenshanyin: 'quake', jijiafanzhen: 'thorns', yingxi: 'dash', duanzui: 'multi', zhuixing: 'meteor',
  hanchaoqu: 'frost', chuanyunjian: 'pierce', yingyan: 'volley', chuntengyu: 'bloom', chenzhong: 'bell',
  // T26
  xijiao: 'charge', yuxuan: 'feathers', fenwen: 'brand', jinglei: 'thunder', qingquan: 'ripple', tiebi: 'bulwark',
};
const SHOT_STYLE: Record<string, ShotStyle> = { zhufeng: 'arrow', chisun: 'bolt', yanwen: 'fire' };
/** Basic attacks from at least this far are thrown or shot; closer ones are swings. */
export const RANGED_FROM = 180;

export function skillStyle(h: HeroDef): SkillStyle {
  const s = SKILL_STYLE[h.skill.id];
  if (s) return s;
  const types = h.skill.effects.map((e) => e.type);
  if (types.includes('HEAL')) return 'bloom';
  if (types.includes('DASH')) return 'dash';
  if (types.includes('SHIELD')) return h.skill.target === 'SELF' ? 'thorns' : 'bell';
  return h.skill.target === 'ENEMY_AREA' ? 'burst' : 'pierce';
}

export function shotStyle(h: HeroDef): ShotStyle | null {
  if (h.base.attackRange < RANGED_FROM) return null;
  return SHOT_STYLE[h.id] ?? (h.archetype === 'MARKSMAN' ? 'arrow' : 'orb');
}

/** Effects for one new snapshot. */
export function matchFx(prev: RenderSnapshot, cur: RenderSnapshot, data: GameData): MatchFx[] {
  const out: MatchFx[] = [];
  const before = new Map<string, SnapshotUnit>(prev.units.map((u) => [u.id, u]));
  const byId = new Map<string, SnapshotUnit>(cur.units.map((u) => [u.id, u]));
  for (const u of cur.units) {
    if (u.kind !== 'HERO') continue;
    const p = before.get(u.id);
    if (!p) continue;
    if (p.alive && !u.alive) { if (p.hp > 0.5) out.push({ kind: 'hurt', id: u.id, amount: p.hp }); out.push({ kind: 'death', id: u.id }); }
    else if (!p.alive && u.alive) out.push({ kind: 'respawn', id: u.id });
    else if (u.alive) {
      const d = u.hp - p.hp;
      if (d <= -0.5) out.push({ kind: 'hurt', id: u.id, amount: -d });
      else if (d >= 0.5) out.push({ kind: 'heal', id: u.id, amount: d });
    }
  }
  for (const a of cur.attacks) {
    const from = byId.get(a.from);
    if (!from) continue;
    if (from.kind === 'TOWER' || from.kind === 'BASE') { out.push({ kind: 'shot', style: 'fire', from: a.from, to: a.to }); continue; }
    if (from.kind !== 'HERO' || !from.heroId) continue;
    const hero = data.heroById[from.heroId];
    if (!hero) continue;
    if (a.kind === 'SKILL') {
      const p = before.get(a.from) ?? from;
      out.push({ kind: 'skill', style: skillStyle(hero), from: a.from, to: a.to, heroId: hero.id, radius: hero.skill.areaRadius ?? 0, fromX: p.x, fromY: p.y });
    } else {
      const style = shotStyle(hero);
      out.push(style ? { kind: 'shot', style, from: a.from, to: a.to, heroId: hero.id } : { kind: 'slash', from: a.from, to: a.to, heroId: hero.id });
    }
  }
  return out;
}

/**
 * Collects damage and healing per hero and lets a number out at most every `everyMs`,
 * so a fast fight shows readable totals instead of a cloud of tiny numbers.
 */
export class NumberBatcher {
  private acc = new Map<string, { hurt: number; heal: number; since: number }>();
  constructor(private readonly everyMs = 300) {}

  add(id: string, hurt: number, heal: number, now: number): void {
    const a = this.acc.get(id);
    if (a) { a.hurt += hurt; a.heal += heal; } else this.acc.set(id, { hurt, heal, since: now });
  }

  /** Numbers ready to show now (rounded; at least 1). */
  flush(now: number): { id: string; value: number; heal: boolean }[] {
    const out: { id: string; value: number; heal: boolean }[] = [];
    for (const [id, a] of this.acc) {
      if (now - a.since < this.everyMs) continue;
      if (a.hurt >= 1) out.push({ id, value: Math.round(a.hurt), heal: false });
      if (a.heal >= 1) out.push({ id, value: Math.round(a.heal), heal: true });
      this.acc.delete(id);
    }
    return out;
  }
}
