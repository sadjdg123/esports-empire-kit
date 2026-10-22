// Damage, skills, structures, deaths and rewards. Attacks are queued as
// PendingOp entries during the decision phase and applied together, so the
// order in which units act inside a tick does not favour either side.

import type { Side } from '../core/types';
import { atNode } from './map';
import { emit } from './events';
import { enemyOf, type MatchState, type PendingOp } from './state';
import { grantGold, grantXp, type HeroUnit, type Structure } from './units';

export const STRUCTURE_RADIUS = 40;
const AREA_CREEP_FACTOR = 0.5; // area skills hurt creep waves at half strength
const SHIELD_DURATION = 4;

export type TargetKind = PendingOp['targetKind'];
export interface TargetRef {
  kind: TargetKind;
  idx: number;
}

// ---------------------------------------------------------------------------
// Positions

export function heroXY(s: MatchState, i: number): [number, number] {
  return [s.hx[i]!, s.hy[i]!];
}

export function nodeXY(s: MatchState, node: number): [number, number] {
  return [s.map.xs[node]!, s.map.ys[node]!];
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function heroDist(s: MatchState, a: number, b: number): number {
  return Math.sqrt(dist2(s.hx[a]!, s.hy[a]!, s.hx[b]!, s.hy[b]!));
}

// ---------------------------------------------------------------------------
// Multipliers

export function buffValue(s: MatchState, side: Side, kind: 'ATTACK' | 'SIEGE'): number {
  let v = 0;
  for (const b of s.teams[side].buffs) if (b.kind === kind && b.until > s.t) v += b.value;
  return v;
}

export function heroDamageMult(s: MatchState, h: HeroUnit): number {
  const team = s.teams[h.side];
  let m = h.coef.damage * (1 + buffValue(s, h.side, 'ATTACK')) * team.tempo;
  if (s.teams[h.side].goldDiff < -s.cfg.coefficients.mentalDeficitGold) m *= h.coef.mentalPenalty;
  return m;
}

export function armorFactor(s: MatchState, armor: number): number {
  const c = s.cfg.hero.armorConstant;
  return c / (c + Math.max(0, armor));
}

/** Rough combat power of a hero, used by the AI to judge fights. */
export function heroPower(s: MatchState, h: HeroUnit): number {
  if (!h.alive) return 0;
  const dps = (h.attack / h.hero.base.attackInterval) * heroDamageMult(s, h);
  return (h.hp + h.shield) * dps * (h.stunnedUntil > s.t ? 0.5 : 1);
}

// ---------------------------------------------------------------------------
// Structures

export function structureAttackable(s: MatchState, st: Structure): boolean {
  if (!st.alive) return false;
  if (st.kind === 'TOWER') {
    if (st.tier === 1) return true;
    return !s.structures.some((o) => o.alive && o.kind === 'TOWER' && o.side === st.side && o.lane === st.lane && o.tier === 1);
  }
  return s.structures.some((o) => !o.alive && o.kind === 'TOWER' && o.side === st.side && o.tier === 2);
}

export function inStructureRange(s: MatchState, st: Structure, x: number, y: number, extra = 0): boolean {
  const r = st.range + extra;
  return dist2(s.map.xs[st.node]!, s.map.ys[st.node]!, x, y) <= r * r;
}

/** True when (x, y) is covered by a living enemy structure of `side`'s opponent. */
export function underEnemyStructure(s: MatchState, side: Side, x: number, y: number, extra = 0): boolean {
  for (const st of s.structures) {
    if (st.alive && st.side !== side && inStructureRange(s, st, x, y, extra)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Queueing ops

function queue(s: MatchState, op: PendingOp): void {
  s.pending.push(op);
}

export function queueHeroAttack(s: MatchState, h: HeroUnit, target: TargetRef): void {
  const dt = s.cfg.time.tickSec;
  let amount = h.attack * (dt / h.hero.base.attackInterval) * heroDamageMult(s, h);
  if (target.kind === 'STRUCTURE') {
    amount *= s.cfg.hero.structureDamage * s.cfg.tactics[s.teams[h.side].tactic].siegeDamage * (1 + buffValue(s, h.side, 'SIEGE'));
  }
  queue(s, { op: 'DAMAGE', targetKind: target.kind, target: target.idx, amount, sourceHero: h.idx, sourceSide: h.side, skill: false });
  const toId = target.kind === 'HERO' ? s.heroes[target.idx]!.id
    : target.kind === 'CREEP' ? s.creeps[target.idx]!.id
      : target.kind === 'STRUCTURE' ? s.structures[target.idx]!.id
        : target.kind === 'OBJECTIVE' ? s.objectives[target.idx]!.id : s.camps[target.idx]!.id;
  s.attacks.push({ from: h.id, to: toId, kind: 'BASIC' });
}

// ---------------------------------------------------------------------------
// Skills

interface SkillContext {
  enemies: number[]; // living enemy hero indices, any distance
  allies: number[]; // living allied hero indices including self
}

function inRange(s: MatchState, a: number, b: number, r: number): boolean {
  return dist2(s.hx[a]!, s.hy[a]!, s.hx[b]!, s.hy[b]!) <= r * r;
}

function lowestHp(s: MatchState, list: number[]): number {
  let best = -1;
  let bestF = Infinity;
  for (const i of list) {
    const h = s.heroes[i]!;
    const f = (h.hp + h.shield) / h.maxHp;
    if (f < bestF) { bestF = f; best = i; }
  }
  return best;
}

/**
 * Casts the hero's skill if it is ready and useful. `preferred` is the hero
 * the AI wants to focus. Returns true if the skill was cast.
 */
export function tryCastSkill(s: MatchState, h: HeroUnit, ctx: SkillContext, preferred: number): boolean {
  if (h.skillReadyAt > s.t) return false;
  const sk = h.hero.skill;
  const radius = sk.areaRadius ?? 0;
  const enemyInRange = ctx.enemies.filter((e) => inRange(s, h.idx, e, sk.range + 20));
  let primary = -1; // primary target hero
  let center = h.idx; // hero whose position is the area centre
  let allyTargets: number[] = [];

  switch (sk.target) {
    case 'ENEMY_SINGLE': {
      if (enemyInRange.length === 0) return false;
      primary = enemyInRange.includes(preferred) ? preferred : lowestHp(s, enemyInRange);
      center = primary;
      break;
    }
    case 'ENEMY_AREA': {
      if (sk.range <= 0) {
        if (!ctx.enemies.some((e) => inRange(s, h.idx, e, radius))) return false;
      } else {
        if (enemyInRange.length === 0) return false;
        // Aim at the enemy with the most other enemies around it.
        let best = -1;
        let bestCount = -1;
        for (const e of enemyInRange) {
          const n = ctx.enemies.filter((o) => inRange(s, e, o, radius)).length + (e === preferred ? 0.5 : 0);
          if (n > bestCount) { bestCount = n; best = e; }
        }
        primary = best;
        center = best;
      }
      break;
    }
    case 'ALLY_SINGLE': {
      const hurt = ctx.allies.filter((a) => inRange(s, h.idx, a, sk.range) && s.heroes[a]!.hp / s.heroes[a]!.maxHp < 0.6);
      const threatened = hurt.filter((a) => s.t - s.heroes[a]!.lastDamagedAt <= 2);
      if (threatened.length === 0) return false;
      const pick = lowestHp(s, threatened);
      allyTargets = [pick];
      break;
    }
    case 'ALLY_AREA': {
      const near = ctx.allies.filter((a) => inRange(s, h.idx, a, radius));
      const needy = near.filter((a) => s.heroes[a]!.hp / s.heroes[a]!.maxHp < 0.65 && s.t - s.heroes[a]!.lastDamagedAt <= 3);
      if (needy.length === 0) return false;
      allyTargets = near;
      break;
    }
    case 'SELF': {
      const threatened = s.t - h.lastDamagedAt <= 2 && ctx.enemies.some((e) => inRange(s, h.idx, e, Math.max(radius, 200)));
      if (!threatened) return false;
      allyTargets = [h.idx];
      break;
    }
  }

  h.skillReadyAt = s.t + sk.cooldown * h.coef.cooldownMult;
  const offensive = sk.target === 'ENEMY_SINGLE' || sk.target === 'ENEMY_AREA';
  if (offensive && !s.rng.chance(h.coef.skillHit)) {
    s.attacks.push({ from: h.id, to: primary >= 0 ? s.heroes[primary]!.id : h.id, kind: 'SKILL' });
    return true; // missed: cooldown spent, no effect
  }

  // Enemy heroes affected by damage/control effects.
  let enemyTargets: number[];
  if (sk.target === 'ENEMY_SINGLE') enemyTargets = [primary];
  else if (sk.target === 'ENEMY_AREA') enemyTargets = ctx.enemies.filter((e) => inRange(s, center, e, radius));
  else enemyTargets = radius > 0 ? ctx.enemies.filter((e) => inRange(s, h.idx, e, radius)) : [];

  const fx = h.coef.masteryEffect;
  const dmgMult = heroDamageMult(s, h) * fx;
  let stuns = 0;
  for (const eff of sk.effects) {
    switch (eff.type) {
      case 'DAMAGE': {
        const amount = eff.value * h.attack * dmgMult;
        for (const e of enemyTargets) queue(s, { op: 'DAMAGE', targetKind: 'HERO', target: e, amount, sourceHero: h.idx, sourceSide: h.side, skill: true });
        if (sk.target === 'ENEMY_AREA') {
          const [cx, cy] = heroXY(s, center);
          s.creeps.forEach((c, ci) => {
            if (c.alive && c.side !== h.side && dist2(s.cx[ci]!, s.cy[ci]!, cx, cy) <= radius * radius) {
              queue(s, { op: 'DAMAGE', targetKind: 'CREEP', target: ci, amount: amount * AREA_CREEP_FACTOR, sourceHero: h.idx, sourceSide: h.side, skill: true });
            }
          });
        }
        break;
      }
      case 'STUN':
        for (const e of enemyTargets) queue(s, { op: 'STUN', targetKind: 'HERO', target: e, amount: eff.value * Math.min(1.3, fx), sourceHero: h.idx, sourceSide: h.side, skill: true });
        stuns += enemyTargets.length;
        break;
      case 'SLOW':
        for (const e of enemyTargets) queue(s, { op: 'SLOW', targetKind: 'HERO', target: e, amount: eff.value * Math.min(1.3, fx), sourceHero: h.idx, sourceSide: h.side, skill: true });
        break;
      case 'HEAL': {
        const amount = eff.value * h.attack * fx * h.coef.performance;
        for (const a of allyTargets) queue(s, { op: 'HEAL', targetKind: 'HERO', target: a, amount, sourceHero: h.idx, sourceSide: h.side, skill: true });
        break;
      }
      case 'SHIELD': {
        const amount = eff.value * h.attack * fx * h.coef.performance;
        for (const a of allyTargets) queue(s, { op: 'SHIELD', targetKind: 'HERO', target: a, amount, sourceHero: h.idx, sourceSide: h.side, skill: true });
        break;
      }
      case 'DASH': {
        if (primary >= 0) {
          // Leap onto the target's start-of-tick location.
          h.loc = { ...s.hloc[primary]! };
        }
        break;
      }
    }
  }
  h.skillHits += enemyTargets.length;
  if (enemyTargets.length > 0 && sk.effects.some((e) => e.type === 'DAMAGE')) {
    s.skillCasts.push({ caster: h.idx, targets: enemyTargets });
  }
  s.attacks.push({ from: h.id, to: primary >= 0 ? s.heroes[primary]!.id : (allyTargets[0] !== undefined ? s.heroes[allyTargets[0]]!.id : h.id), kind: 'SKILL' });
  if (enemyTargets.length >= 3 || stuns >= 2) {
    emitSkillKey(s, h, enemyTargets, 0);
  }
  return true;
}

function emitSkillKey(s: MatchState, h: HeroUnit, targets: number[], kills: number): void {
  const m = h.coef.mastery;
  emit(s, {
    t: s.t,
    type: 'SKILL_KEY',
    side: h.side,
    actors: [h.player.id],
    targets: targets.map((e) => s.heroes[e]!.player.id),
    detail: { heroId: h.hero.id, skillName: h.hero.skill.name, hits: targets.length, kills, mastery: m },
    reason: m >= 75 ? 'mastery_high' : m <= 40 ? 'mastery_low' : undefined,
  });
}

// ---------------------------------------------------------------------------
// Non-hero attackers

export function creepAndStructurePhase(s: MatchState): void {
  const dt = s.cfg.time.tickSec;
  const cr = s.cfg.creeps;
  // Creep waves
  s.creeps.forEach((c, ci) => {
    c.engaged = false;
    if (!c.alive) return;
    const x = s.cx[ci]!;
    const y = s.cy[ci]!;
    const r2 = cr.range * cr.range;
    // 1. enemy creeps
    let best = -1;
    let bestD = Infinity;
    s.creeps.forEach((o, oi) => {
      if (!o.alive || o.side === c.side) return;
      const d = dist2(x, y, s.cx[oi]!, s.cy[oi]!);
      if (d <= r2 && d < bestD) { bestD = d; best = oi; }
    });
    if (best >= 0) {
      queue(s, { op: 'DAMAGE', targetKind: 'CREEP', target: best, amount: c.attack * dt, sourceHero: -1, sourceSide: c.side, skill: false });
      c.engaged = true;
      return;
    }
    // 2. attackable enemy structures
    const sr = cr.range + STRUCTURE_RADIUS;
    for (let si = 0; si < s.structures.length; si++) {
      const st = s.structures[si]!;
      if (st.side === c.side || !st.alive) continue;
      if (dist2(x, y, s.map.xs[st.node]!, s.map.ys[st.node]!) <= sr * sr) {
        if (s.tickCache.attackable[si]) {
          queue(s, { op: 'DAMAGE', targetKind: 'STRUCTURE', target: si, amount: c.structureAttack * dt, sourceHero: -1, sourceSide: c.side, skill: false });
        }
        c.engaged = true;
        return; // blocked by a structure either way
      }
    }
    // 3. enemy heroes
    let hb = -1;
    bestD = Infinity;
    for (const h of s.heroes) {
      if (!h.alive || h.side === c.side) continue;
      const d = dist2(x, y, s.hx[h.idx]!, s.hy[h.idx]!);
      if (d <= r2 && d < bestD) { bestD = d; hb = h.idx; }
    }
    if (hb >= 0) {
      queue(s, { op: 'DAMAGE', targetKind: 'HERO', target: hb, amount: c.attack * 0.6 * dt, sourceHero: -1, sourceSide: c.side, skill: false });
      c.engaged = true;
    }
  });

  // Structures
  const late = s.t >= s.cfg.time.suddenDeathSec;
  s.structures.forEach((st) => {
    if (!st.alive) return;
    const sx = s.map.xs[st.node]!;
    const sy = s.map.ys[st.node]!;
    const r2 = st.range * st.range;
    const dmgMult = late ? 0.5 : 1;
    // 1. hero that attacked an allied hero inside range
    if (st.aggroUntil >= s.t && st.aggroHero >= 0) {
      const h = s.heroes[st.aggroHero]!;
      if (h.alive && dist2(sx, sy, s.hx[h.idx]!, s.hy[h.idx]!) <= r2) {
        queueStructureHit(s, st, h.idx, st.attack * dmgMult * dt);
        return;
      }
    }
    // 2. nearest enemy creep
    let best = -1;
    let bestD = Infinity;
    s.creeps.forEach((c, ci) => {
      if (!c.alive || c.side === st.side) return;
      const d = dist2(sx, sy, s.cx[ci]!, s.cy[ci]!);
      if (d <= r2 && d < bestD) { bestD = d; best = ci; }
    });
    if (best >= 0) {
      queue(s, { op: 'DAMAGE', targetKind: 'CREEP', target: best, amount: st.creepAttack * dmgMult * dt, sourceHero: -1, sourceSide: st.side, skill: false });
      s.attacks.push({ from: st.id, to: s.creeps[best]!.id, kind: 'BASIC' });
      return;
    }
    // 3. nearest enemy hero
    let hb = -1;
    bestD = Infinity;
    for (const h of s.heroes) {
      if (!h.alive || h.side === st.side) continue;
      const d = dist2(sx, sy, s.hx[h.idx]!, s.hy[h.idx]!);
      if (d <= r2 && d < bestD) { bestD = d; hb = h.idx; }
    }
    if (hb >= 0) queueStructureHit(s, st, hb, st.attack * dmgMult * dt);
  });

  // Neutral objectives hit back at whoever attacks them.
  s.objectives.forEach((ob) => {
    if (!ob.alive) return;
    ob.attackers = ob.attackers.filter((a) => s.t - a.t <= 5 && s.heroes[a.hero]!.alive);
    const oc = s.cfg.objectives[ob.cfgIdx]!;
    const [ox, oy] = nodeXY(s, ob.node);
    let hb = -1;
    let bestD = Infinity;
    for (const a of ob.attackers) {
      const d = dist2(ox, oy, s.hx[a.hero]!, s.hy[a.hero]!);
      if (d <= (oc.range + 50) ** 2 && d < bestD) { bestD = d; hb = a.hero; }
    }
    if (hb >= 0) {
      const minutes = s.t / 60;
      queue(s, { op: 'DAMAGE', targetKind: 'HERO', target: hb, amount: oc.attack * (1 + minutes * 0.04) * dt, sourceHero: -1, sourceSide: null, skill: false });
    }
  });
}

function queueStructureHit(s: MatchState, st: Structure, hero: number, amount: number): void {
  queue(s, { op: 'DAMAGE', targetKind: 'HERO', target: hero, amount, sourceHero: -1, sourceSide: st.side, skill: false });
  s.attacks.push({ from: st.id, to: s.heroes[hero]!.id, kind: 'BASIC' });
}

// ---------------------------------------------------------------------------
// Applying ops

export function applyPending(s: MatchState): void {
  const t = s.t;
  for (const op of s.pending) {
    if (op.targetKind === 'HERO') {
      const h = s.heroes[op.target]!;
      if (!h.alive) continue;
      switch (op.op) {
        case 'DAMAGE': {
          let dmg = op.amount * armorFactor(s, h.armor);
          if (h.shield > 0) {
            const absorbed = Math.min(h.shield, dmg);
            h.shield -= absorbed;
            dmg -= absorbed;
          }
          h.hp -= dmg;
          h.lastDamagedAt = t;
          if (h.recallDoneAt > 0) h.recallDoneAt = 0; // damage interrupts recall
          if (op.sourceHero >= 0) {
            const src = s.heroes[op.sourceHero]!;
            src.damageDealt += op.amount;
            src.heroDamage += op.amount;
            src.lastHeroDamageAt = t;
            h.damagers.push({ hero: op.sourceHero, t });
            if (h.damagers.length > 40) {
              const keepAfter = t - s.cfg.hero.assistWindowSec;
              h.damagers = h.damagers.filter((d) => d.t >= keepAfter);
            }
            // Structures defend heroes being attacked inside their range.
            for (const st of s.structures) {
              if (st.alive && st.side === h.side && inStructureRange(s, st, s.hx[h.idx]!, s.hy[h.idx]!)) {
                st.aggroHero = op.sourceHero;
                st.aggroUntil = t + 2;
              }
            }
          }
          break;
        }
        case 'HEAL':
          h.hp = Math.min(h.maxHp, h.hp + op.amount);
          break;
        case 'SHIELD':
          h.shield = Math.max(h.shield, op.amount);
          h.shieldUntil = t + SHIELD_DURATION;
          break;
        case 'STUN':
          h.stunnedUntil = Math.max(h.stunnedUntil, t + op.amount);
          if (h.recallDoneAt > 0) h.recallDoneAt = 0;
          break;
        case 'SLOW':
          h.slowedUntil = Math.max(h.slowedUntil, t + op.amount);
          break;
      }
      continue;
    }
    if (op.op !== 'DAMAGE') continue;
    const src = op.sourceHero >= 0 ? s.heroes[op.sourceHero]! : null;
    if (src) src.damageDealt += op.amount;
    switch (op.targetKind) {
      case 'CREEP': {
        const c = s.creeps[op.target]!;
        if (c.alive) c.hp -= op.amount * armorFactor(s, c.armor);
        break;
      }
      case 'STRUCTURE': {
        const st = s.structures[op.target]!;
        if (!st.alive) break;
        const armor = st.kind === 'BASE' && t >= s.cfg.time.suddenDeathSec ? s.cfg.base.suddenDeathArmor : st.armor;
        st.hp -= op.amount * armorFactor(s, armor);
        st.lastHitSide = op.sourceSide ?? enemyOf(st.side);
        break;
      }
      case 'OBJECTIVE': {
        const ob = s.objectives[op.target]!;
        if (!ob.alive) break;
        ob.hp -= op.amount;
        if (src) {
          ob.attackers.push({ hero: src.idx, t });
          ob.lastHitSide = src.side;
        }
        break;
      }
      case 'CAMP': {
        const camp = s.camps[op.target]!;
        if (!camp.alive) break;
        camp.hp -= op.amount;
        if (src) camp.lastHitHero = src.idx;
        break;
      }
    }
  }
  s.pending.length = 0;
}

// ---------------------------------------------------------------------------
// Deaths and rewards

function aliveHeroesOf(s: MatchState, side: Side): HeroUnit[] {
  return s.heroes.filter((h) => h.alive && h.side === side);
}

export function resolveDeaths(s: MatchState): void {
  const cfg = s.cfg;
  const t = s.t;
  const casts = s.skillCasts;
  const skillKills = new Map<number, number[]>(); // caster -> victims

  // Heroes
  for (const h of s.heroes) {
    if (!h.alive || h.hp > 0) continue;
    h.alive = false;
    h.hp = 0;
    h.shield = 0;
    h.deaths++;
    h.respawnAt = t + cfg.hero.respawnBase + cfg.hero.respawnPerLevel * h.level;
    h.recallDoneAt = 0;
    h.gankTarget = -1;
    const recent = h.damagers.filter((d) => t - d.t <= cfg.hero.assistWindowSec);
    let killer = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (s.heroes[recent[i]!.hero]!.side !== h.side) { killer = recent[i]!.hero; break; }
    }
    const assisters = [...new Set(recent.map((d) => d.hero))].filter((i) => i !== killer && s.heroes[i]!.side !== h.side).sort((a, b) => a - b);
    const enemy = enemyOf(h.side);
    if (killer >= 0) {
      const k = s.heroes[killer]!;
      k.kills++;
      s.teams[enemy].kills++;
      grantGold(cfg, k, cfg.hero.killGold + cfg.hero.killGoldPerVictimLevel * h.level);
      const xp = cfg.hero.killXp + cfg.hero.killXpPerVictimLevel * h.level;
      grantXp(cfg, k, xp * (assisters.length > 0 ? 0.6 : 1));
      for (const a of assisters) {
        const ah = s.heroes[a]!;
        ah.assists++;
        grantGold(cfg, ah, cfg.hero.assistGold / assisters.length);
        grantXp(cfg, ah, (xp * 0.6) / assisters.length);
      }
      for (const c of casts) if (c.caster === killer && c.targets.includes(h.idx)) {
        const list = skillKills.get(killer) ?? [];
        list.push(h.idx);
        skillKills.set(killer, list);
      }
    }
    if (s.teamfight) s.teamfight.kills[enemy]++;
    const reasons: string[] = [];
    if (killer >= 0) {
      const k = s.heroes[killer]!;
      if (k.gankTarget === h.idx || (k.action === 'GANK' && k.actionTarget === h.idx)) reasons.push('gank');
      if (s.teamfight) reasons.push('teamfight');
      if (h.coef.roleFit === 'off') reasons.push('offrole');
      if (k.coef.mastery >= 75) reasons.push('mastery_high');
    } else {
      reasons.push('executed');
    }
    const [vx, vy] = heroXY(s, h.idx);
    emit(s, {
      t,
      type: 'KILL',
      side: enemy,
      actors: killer >= 0 ? [s.heroes[killer]!.player.id] : [],
      targets: [h.player.id],
      nodeId: nearestNodeId(s, vx, vy),
      detail: {
        assists: assisters.length,
        assistNames: assisters.map((a) => s.heroes[a]!.player.name).join('、'),
        assistIds: assisters.map((a) => s.heroes[a]!.player.id).join(','),
        killerHero: killer >= 0 ? s.heroes[killer]!.hero.id : '',
        victimHero: h.hero.id,
        victimRoleFit: h.coef.roleFit,
        killerMastery: killer >= 0 ? s.heroes[killer]!.coef.mastery : 0,
      },
      reason: reasons.join('|') || undefined,
    });
    h.damagers = [];
  }
  for (const [caster, victims] of skillKills) {
    emitSkillKey(s, s.heroes[caster]!, victims, victims.length);
  }

  // Creep waves
  s.creeps.forEach((c, ci) => {
    if (!c.alive || c.hp > 0) return;
    c.alive = false;
    const enemy = enemyOf(c.side);
    const x = s.cx[ci]!;
    const y = s.cy[ci]!;
    const r2 = cfg.creeps.shareRadius ** 2;
    const near = aliveHeroesOf(s, enemy).filter((h) => dist2(x, y, s.hx[h.idx]!, s.hy[h.idx]!) <= r2);
    if (near.length === 0) return;
    const weights = near.map((h) => (h.role === 'SUPPORT' ? 0.3 : 1));
    const wsum = weights.reduce((a, b) => a + b, 0);
    near.forEach((h, i) => {
      grantGold(cfg, h, cfg.creeps.gold * h.coef.farm * cfg.tactics[s.teams[h.side].tactic].farmGold * (weights[i]! / wsum));
      grantXp(cfg, h, Math.min(cfg.creeps.xp, (cfg.creeps.xp * 1.3) / near.length));
    });
  });
  if (s.creeps.length > 64) s.creeps = s.creeps.filter((c) => c.alive);

  // Structures
  for (const st of s.structures) {
    if (!st.alive || st.hp > 0) continue;
    st.alive = false;
    st.hp = 0;
    const winnerSide = st.lastHitSide ?? enemyOf(st.side);
    const [sx, sy] = nodeXY(s, st.node);
    const actors = aliveHeroesOf(s, winnerSide).filter((h) => dist2(sx, sy, s.hx[h.idx]!, s.hy[h.idx]!) <= 450 * 450);
    if (st.kind === 'TOWER') {
      s.teams[winnerSide].towersDestroyed++;
      for (const h of s.heroes) if (h.side === winnerSide) grantGold(cfg, h, cfg.hero.towerGoldPerMember);
      const splitters = actors.filter((h) => h.action === 'SPLIT');
      emit(s, {
        t,
        type: 'TOWER_DESTROYED',
        side: winnerSide,
        actors: actors.map((h) => h.player.id),
        nodeId: s.map.nodes[st.node]!.id,
        detail: { towerName: towerName(st), lane: st.lane ?? '', tier: st.tier, attackers: actors.length },
        reason: splitters.length > 0 && actors.length <= 2 ? `tactic:${s.teams[winnerSide].tactic}|split` : actors.length >= 3 ? 'group' : undefined,
      });
    } else {
      emit(s, { t, type: 'BASE_DESTROYED', side: winnerSide, actors: actors.map((h) => h.player.id), nodeId: s.map.nodes[st.node]!.id });
      s.over = true;
      s.winner = winnerSide;
      s.endReason = 'base';
    }
  }

  // Base damage announcements
  for (const st of s.structures) {
    if (st.kind !== 'BASE' || !st.alive) continue;
    const quarter = Math.ceil((st.hp / st.maxHp) * 4); // 4 = untouched
    const mark = s.baseDamageMarks[st.side];
    if (st.hp < st.maxHp && quarter < mark) {
      s.baseDamageMarks[st.side] = quarter;
      const attacker = enemyOf(st.side);
      emit(s, {
        t,
        type: 'BASE_DAMAGED',
        side: attacker,
        actors: aliveHeroesOf(s, attacker).filter((h) => inStructureRange(s, st, s.hx[h.idx]!, s.hy[h.idx]!, 300)).map((h) => h.player.id),
        nodeId: s.map.nodes[st.node]!.id,
        detail: { hpPercent: Math.round((st.hp / st.maxHp) * 100) },
      });
    }
  }

  // Objectives
  for (const ob of s.objectives) {
    if (!ob.alive || ob.hp > 0) continue;
    ob.alive = false;
    const oc = cfg.objectives[ob.cfgIdx]!;
    ob.nextSpawnAt = t + oc.respawnSec;
    const side = ob.lastHitSide;
    ob.lastHitSide = null;
    ob.attackers = [];
    if (!side) continue;
    const team = s.teams[side];
    team.objectivesTaken++;
    team.buffs = team.buffs.filter((b) => b.until > t && b.source !== ob.id);
    team.buffs.push({ kind: oc.buff.kind, value: oc.buff.value, until: t + oc.buff.durationSec, source: ob.id });
    for (const h of s.heroes) if (h.side === side) grantGold(cfg, h, oc.goldPerMember);
    const [ox, oy] = nodeXY(s, ob.node);
    emit(s, {
      t,
      type: 'OBJECTIVE_TAKEN',
      side,
      actors: aliveHeroesOf(s, side).filter((h) => dist2(ox, oy, s.hx[h.idx]!, s.hy[h.idx]!) <= 500 * 500).map((h) => h.player.id),
      nodeId: s.map.nodes[ob.node]!.id,
      detail: { objectiveId: ob.id, objectiveName: ob.name, buff: oc.buff.kind },
      reason: `tactic:${team.tactic}`,
    });
  }

  // Jungle camps
  for (const camp of s.camps) {
    if (!camp.alive || camp.hp > 0) continue;
    camp.alive = false;
    camp.nextSpawnAt = t + cfg.jungle.respawnSec;
    const hi = camp.lastHitHero;
    camp.lastHitHero = -1;
    if (hi < 0) continue;
    const h = s.heroes[hi]!;
    if (!h.alive) continue;
    grantGold(cfg, h, cfg.jungle.campGold * h.coef.farm * cfg.tactics[s.teams[h.side].tactic].farmGold);
    grantXp(cfg, h, cfg.jungle.campXp);
  }
}

export function towerName(st: Structure): string {
  const side = st.side === 'BLUE' ? '蓝方' : '红方';
  const lane = st.lane === 'TOP' ? '上路' : st.lane === 'MID' ? '中路' : '下路';
  return st.kind === 'BASE' ? `${side}基地` : `${side}${lane}${st.tier === 1 ? '一塔' : '二塔'}`;
}

export function nearestNodeId(s: MatchState, x: number, y: number): string {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < s.map.n; i++) {
    const d = dist2(x, y, s.map.xs[i]!, s.map.ys[i]!);
    if (d < bestD) { bestD = d; best = i; }
  }
  return s.map.nodes[best]!.id;
}

/** Respawns dead heroes whose timer has elapsed. */
export function respawnHeroes(s: MatchState): void {
  for (const h of s.heroes) {
    if (h.alive || h.respawnAt > s.t) continue;
    h.alive = true;
    h.hp = h.maxHp;
    h.shield = 0;
    h.stunnedUntil = 0;
    h.slowedUntil = 0;
    h.loc = atNode(s.map.bases[h.side]);
    h.action = 'IDLE';
    h.actionSince = s.t;
    h.damagers = [];
  }
}
