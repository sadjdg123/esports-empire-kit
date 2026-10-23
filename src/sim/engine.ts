// Match engine: createMatch / step / isOver / getSnapshot / finalize / runMatch.
// Watching and skipping a match both call the same step(), so results match.

import { createRng, hashString } from '../core/rng';
import {
  ROLES, SIDES, type GameData, type MatchInput, type MatchResult, type PlayerMatchStats, type RenderSnapshot, type Side, type SnapshotUnit,
} from '../core/types';
import { decideSimple, decideUtility, onGankUtility, planSimple, planUtility, teamPlanUtility, type ActionPlan } from './ai';
import {
  applyPending, creepAndStructurePhase, dist2, heroDist, heroPower, nodeXY, queueHeroAttack, resolveDeaths, respawnHeroes,
  tryCastSkill, STRUCTURE_RADIUS, type TargetRef,
} from './combat';
import { emit } from './events';
import { atNode, buildMap, coordOf, type GameMap } from './map';
import { tempoFactor } from './tactics';
import { enemyOf, type BrainKind, type MatchState, type TeamState } from './state';
import { createHero, grantGold, grantXp, moveHero, moveWave, heroMoveSpeed, spawnWave, type Camp, type HeroUnit, type Objective, type Structure } from './units';

export type { MatchState } from './state';

export interface MatchOptions {
  brain?: BrainKind;
}

export interface Brain {
  decide(s: MatchState, h: HeroUnit): void;
  plan(s: MatchState, h: HeroUnit): ActionPlan;
  teamPlan?(s: MatchState, team: TeamState): void;
  onGank?(s: MatchState, h: HeroUnit, target: number): void;
}

const simpleBrain: Brain = { decide: decideSimple, plan: planSimple };
const utilityBrain: Brain = { decide: decideUtility, plan: planUtility, teamPlan: teamPlanUtility, onGank: onGankUtility };
const brains: Partial<Record<BrainKind, Brain>> = { simple: simpleBrain, utility: utilityBrain };

/** Lets ai modules register additional brains without a circular import. */
export function registerBrain(kind: BrainKind, brain: Brain): void {
  brains[kind] = brain;
}

const mapCache = new WeakMap<object, GameMap>();
function mapFor(data: GameData): GameMap {
  let m = mapCache.get(data.match.map);
  if (!m) {
    m = buildMap(data.match.map);
    mapCache.set(data.match.map, m);
  }
  return m;
}

export function createMatch(input: MatchInput, data: GameData, opts: MatchOptions = {}): MatchState {
  const cfg = data.match;
  const map = mapFor(data);
  const heroes: HeroUnit[] = [];
  const teams = {} as Record<Side, TeamState>;
  for (const side of SIDES) {
    const team = side === 'BLUE' ? input.blue : input.red;
    const heroIdx: number[] = [];
    for (const role of ROLES) {
      const pick = team.lineup.picks.find((p) => p.role === role);
      if (!pick) throw new Error(`createMatch: ${side} lineup has no ${role}`);
      const player = team.players.find((p) => p.id === pick.playerId);
      if (!player) throw new Error(`createMatch: ${side} player ${pick.playerId} missing`);
      const hero = data.heroById[pick.heroId];
      if (!hero) throw new Error(`createMatch: unknown hero ${pick.heroId}`);
      const idx = heroes.length;
      heroes.push(createHero(cfg, idx, side, role, player, hero, map.bases[side]));
      heroIdx.push(idx);
    }
    teams[side] = {
      side, tactic: team.lineup.tactic, clubId: team.lineup.clubId, heroIdx, kills: 0, buffs: [],
      siegeLane: 'MID', groupCallAt: -1, objectivesTaken: 0, towersDestroyed: 0, goldDiff: 0, tempo: 1, tfTable: null, tfSig: -1, tfCheckedAt: -1,
    };
  }

  const structures: Structure[] = [];
  map.nodes.forEach((node, i) => {
    if (node.type !== 'TOWER' && node.type !== 'BASE') return;
    const st = node.type === 'BASE' ? cfg.base : node.tier === 2 ? cfg.towers.T2 : cfg.towers.T1;
    structures.push({
      id: node.id, kind: node.type, side: node.side!, node: i, lane: node.lane ?? null,
      tier: node.type === 'BASE' ? 0 : (node.tier ?? 1), hp: st.hp, maxHp: st.hp, armor: st.armor, attack: st.attack,
      creepAttack: st.creepAttack, range: st.range, alive: true, aggroHero: -1, aggroUntil: -1, lastHitSide: null,
    });
  });
  const objectives: Objective[] = cfg.objectives.map((o, i) => ({
    cfgIdx: i, id: o.id, name: o.name, node: map.index.get(o.nodeId)!, alive: false, hp: 0, maxHp: o.hp,
    nextSpawnAt: o.firstSpawnSec, attackers: [], lastHitSide: null, tickDamage: { BLUE: 0, RED: 0 },
  }));
  const camps: Camp[] = [];
  map.nodes.forEach((node, i) => {
    if (node.type === 'JUNGLE' && node.side) {
      camps.push({ id: `CAMP:${node.id}`, node: i, side: node.side, alive: false, hp: 0, nextSpawnAt: cfg.jungle.firstSpawnSec, lastHitHero: -1, tickHit: { BLUE: -1, RED: -1, dmgBLUE: 0, dmgRED: 0 } });
    }
  });

  const s: MatchState = {
    input, data, cfg, map, rng: createRng(input.seed), brain: opts.brain ?? 'utility',
    t: 0, over: false, winner: null, endReason: '',
    heroes, creeps: [], structures, objectives, camps, teams,
    events: [], tickEventStart: 0, attacks: [], pending: [], skillCasts: [],
    goldTimeline: [{ t: 0, diff: 0 }],
    nextWaveAt: cfg.creeps.firstSpawnSec, waveSeq: 0,
    overtimeAnnounced: false, suddenDeathAnnounced: false, teamfight: null,
    baseDamageMarks: { BLUE: 4, RED: 4 },
    hx: new Float64Array(heroes.length), hy: new Float64Array(heroes.length), hloc: [], cx: [], cy: [],
    tickCache: {
      t: -1, power: new Float64Array(heroes.length), attackable: [], threat: new Float64Array(structures.length), front: [null, null, null, null, null, null],
      forces: [], underOwnStructure: [], gankTarget: [], actionSince: [], grouping: { BLUE: 0, RED: 0 }, contesting: { BLUE: [], RED: [] },
    },
    laneTowers: laneTowersOf(structures),
    bases: { BLUE: structures.find((st) => st.kind === 'BASE' && st.side === 'BLUE')!, RED: structures.find((st) => st.kind === 'BASE' && st.side === 'RED')! },
  };
  if (!brains[s.brain]) throw new Error(`createMatch: brain "${s.brain}" is not registered (import src/sim/index.ts)`);
  emit(s, { t: 0, type: 'MATCH_START', actors: [], detail: { blueTactic: teams.BLUE.tactic, redTactic: teams.RED.tactic } });
  cachePositions(s);
  return s;
}

function laneTowersOf(structures: Structure[]): Record<Side, Record<'TOP' | 'MID' | 'BOT', Structure[]>> {
  const out = { BLUE: { TOP: [], MID: [], BOT: [] }, RED: { TOP: [], MID: [], BOT: [] } } as Record<Side, Record<'TOP' | 'MID' | 'BOT', Structure[]>>;
  for (const st of structures) if (st.kind === 'TOWER' && st.lane) out[st.side][st.lane].push(st);
  for (const side of SIDES) for (const lane of ['TOP', 'MID', 'BOT'] as const) out[side][lane].sort((a, b) => a.tier - b.tier);
  return out;
}

function cachePositions(s: MatchState): void {
  const map = s.map;
  for (const h of s.heroes) {
    const l = h.loc;
    const x0 = map.xs[l.from]!;
    const y0 = map.ys[l.from]!;
    s.hx[h.idx] = l.from === l.to ? x0 : x0 + (map.xs[l.to]! - x0) * l.progress;
    s.hy[h.idx] = l.from === l.to ? y0 : y0 + (map.ys[l.to]! - y0) * l.progress;
    s.hloc[h.idx] = l;
  }
  const tc = s.tickCache;
  tc.t = s.t;
  for (const h of s.heroes) tc.power[h.idx] = heroPower(s, h);
  // Attackable: tier 1 always; tier 2 once that lane's tier 1 fell; base once any tier 2 fell.
  tc.attackable.length = 0;
  const t2Down = { BLUE: false, RED: false };
  for (const st of s.structures) if (st.kind === 'TOWER' && st.tier === 2 && !st.alive) t2Down[st.side] = true;
  for (const st of s.structures) {
    let ok = st.alive;
    if (ok && st.kind === 'BASE') ok = t2Down[st.side];
    else if (ok && st.tier === 2) ok = !s.laneTowers[st.side][st.lane!][0]!.alive;
    tc.attackable.push(ok);
  }
  tc.threat.fill(-1);
  tc.front.fill(null);
  tc.forces.length = 0;
  tc.grouping.BLUE = 0;
  tc.grouping.RED = 0;
  tc.contesting.BLUE.length = s.objectives.length;
  tc.contesting.RED.length = s.objectives.length;
  tc.contesting.BLUE.fill(0);
  tc.contesting.RED.fill(0);
  for (const h of s.heroes) {
    if (!h.alive) continue;
    if (h.action === 'GROUP') tc.grouping[h.side]++;
    else if (h.action === 'CONTEST_OBJECTIVE' && h.actionTarget >= 0) tc.contesting[h.side][h.actionTarget]!++;
  }
  s.cx.length = s.creeps.length;
  s.cy.length = s.creeps.length;
  for (let i = 0; i < s.creeps.length; i++) {
    const l = s.creeps[i]!.loc;
    const x0 = map.xs[l.from]!;
    const y0 = map.ys[l.from]!;
    s.cx[i] = l.from === l.to ? x0 : x0 + (map.xs[l.to]! - x0) * l.progress;
    s.cy[i] = l.from === l.to ? y0 : y0 + (map.ys[l.to]! - y0) * l.progress;
  }
  tc.gankTarget.length = 0;
  tc.actionSince.length = 0;
  for (const h of s.heroes) {
    tc.gankTarget.push(h.alive ? h.gankTarget : -1);
    tc.actionSince.push(h.actionSince);
  }
  tc.underOwnStructure.length = 0;
  for (const h of s.heroes) {
    let under = false;
    if (h.alive) {
      for (const st of s.structures) {
        if (!st.alive || st.side !== h.side) continue;
        const dx = map.xs[st.node]! - s.hx[h.idx]!;
        const dy = map.ys[st.node]! - s.hy[h.idx]!;
        if (dx * dx + dy * dy <= st.range * st.range) { under = true; break; }
      }
    }
    tc.underOwnStructure.push(under);
  }
}

function teamGold(s: MatchState, side: Side): number {
  let g = 0;
  for (const h of s.heroes) if (h.side === side) g += h.gold;
  return g;
}

function spawnPhase(s: MatchState): void {
  const cfg = s.cfg;
  const t = s.t;
  respawnHeroes(s);
  if (t >= s.nextWaveAt) {
    const minutes = t / 60;
    const over = t >= cfg.time.overtimeStartSec ? 1 + cfg.time.overtimeCreepBonusPerMin * Math.floor((t - cfg.time.overtimeStartSec) / 60 + 1) : 1;
    const stats = {
      hp: (cfg.creeps.hp + cfg.creeps.hpPerMinute * minutes) * over,
      armor: cfg.creeps.armor,
      attack: (cfg.creeps.attack + cfg.creeps.attackPerMinute * minutes) * over,
      structureAttack: (cfg.creeps.structureAttack + cfg.creeps.attackPerMinute * minutes) * over,
    };
    for (const side of SIDES) {
      for (const lane of ['TOP', 'MID', 'BOT'] as const) {
        s.creeps.push(spawnWave(s.map, `W${s.waveSeq++}:${side}:${lane}`, side, lane, stats));
      }
    }
    s.nextWaveAt += cfg.creeps.intervalSec;
  }
  for (const camp of s.camps) {
    if (!camp.alive && t >= camp.nextSpawnAt) {
      camp.alive = true;
      camp.hp = cfg.jungle.campHp * (1 + t / 900);
    }
  }
  for (const ob of s.objectives) {
    if (!ob.alive && t >= ob.nextSpawnAt) {
      const oc = cfg.objectives[ob.cfgIdx]!;
      ob.alive = true;
      ob.maxHp = oc.hp + oc.hpPerMinute * (t / 60);
      ob.hp = ob.maxHp;
      ob.attackers = [];
    }
  }
  for (const side of SIDES) s.teams[side].buffs = s.teams[side].buffs.filter((b) => b.until > t);
  for (const h of s.heroes) if (h.shield > 0 && h.shieldUntil <= t) h.shield = 0;
}

// ---------------------------------------------------------------------------
// Hero phase

function enemyHeroesInRange(s: MatchState, h: HeroUnit, range: number): number[] {
  const out: number[] = [];
  const r2 = range * range;
  for (const o of s.heroes) {
    if (!o.alive || o.side === h.side) continue;
    if (dist2(s.hx[h.idx]!, s.hy[h.idx]!, s.hx[o.idx]!, s.hy[o.idx]!) <= r2) out.push(o.idx);
  }
  return out;
}

/** Enemy hero that the most allies are currently hitting, preferring low hp. */
function teamFocus(s: MatchState, h: HeroUnit, candidates: number[]): number {
  let best = -1;
  let bestScore = -Infinity;
  for (const e of candidates) {
    const eh = s.heroes[e]!;
    let score = 1 - eh.hp / eh.maxHp;
    for (const d of eh.damagers) if (s.t - d.t <= 2 && s.heroes[d.hero]!.side === h.side) score += 0.3;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}

function heroTargetAllowed(s: MatchState, e: number, plan: ActionPlan): boolean {
  if (plan.dive || e === plan.focus) return true;
  const eh = s.heroes[e]!;
  if (eh.hp / eh.maxHp < 0.2) return true;
  return !s.tickCache.underOwnStructure[e];
}

/** While farming, a hero only trades with enemies it is clearly beating. */
export function worthTrading(s: MatchState, h: HeroUnit, e: number): boolean {
  const eh = s.heroes[e]!;
  const theirs = (eh.hp + eh.shield) / eh.maxHp;
  if (theirs < 0.4 || eh.stunnedUntil > s.t) return true;
  const mine = (h.hp + h.shield) / h.maxHp;
  if (theirs + 0.2 < mine) return true;
  // Join in when a nearby teammate is already fighting this enemy (e.g. a gank).
  for (const d of eh.damagers) {
    if (s.t - d.t > 2 || d.hero === h.idx || s.heroes[d.hero]!.side !== h.side) continue;
    if (dist2(s.hx[d.hero]!, s.hy[d.hero]!, s.hx[h.idx]!, s.hy[h.idx]!) <= 500 * 500) return true;
  }
  // Hit back at someone who is hitting us, unless we are losing the trade.
  const hitMe = h.damagers.some((d) => d.hero === e && s.t - d.t <= 2);
  return hitMe && mine >= theirs - 0.1;
}

function chooseTarget(s: MatchState, h: HeroUnit, plan: ActionPlan): TargetRef | null {
  const range = h.hero.base.attackRange;
  const x = s.hx[h.idx]!;
  const y = s.hy[h.idx]!;
  // 1-2. enemy heroes
  let inRange = enemyHeroesInRange(s, h, range).filter((e) => heroTargetAllowed(s, e, plan));
  if (plan.opportunistic && inRange.length > 0) inRange = inRange.filter((e) => worthTrading(s, h, e));
  if (inRange.length > 0) {
    if (plan.focus >= 0 && inRange.includes(plan.focus)) return { kind: 'HERO', idx: plan.focus };
    if (inRange.length === 1) return { kind: 'HERO', idx: inRange[0]! };
    if (s.rng.chance(h.coef.focusChance)) return { kind: 'HERO', idx: teamFocus(s, h, inRange) };
    let best = inRange[0]!;
    let bestD = Infinity;
    for (const e of inRange) {
      const d = dist2(x, y, s.hx[e]!, s.hy[e]!);
      if (d < bestD) { bestD = d; best = e; }
    }
    return { kind: 'HERO', idx: best };
  }
  // 3. objective
  if (plan.objective >= 0) {
    const ob = s.objectives[plan.objective]!;
    if (ob.alive && dist2(x, y, s.map.xs[ob.node]!, s.map.ys[ob.node]!) <= (range + STRUCTURE_RADIUS) ** 2) return { kind: 'OBJECTIVE', idx: plan.objective };
  }
  // 4. enemy creeps
  let best = -1;
  let bestD = Infinity;
  const r2 = range * range;
  for (let ci = 0; ci < s.creeps.length; ci++) {
    const c = s.creeps[ci]!;
    if (!c.alive || c.side === h.side) continue;
    const d = dist2(x, y, s.cx[ci]!, s.cy[ci]!);
    if (d <= r2 && d < bestD) { bestD = d; best = ci; }
  }
  if (best >= 0) return { kind: 'CREEP', idx: best };
  // 5. jungle camp
  if (plan.camp >= 0) {
    const camp = s.camps[plan.camp]!;
    if (camp.alive && dist2(x, y, s.map.xs[camp.node]!, s.map.ys[camp.node]!) <= (range + STRUCTURE_RADIUS) ** 2) return { kind: 'CAMP', idx: plan.camp };
  }
  // 6. structures
  const sr = range + STRUCTURE_RADIUS;
  for (let si = 0; si < s.structures.length; si++) {
    const st = s.structures[si]!;
    if (!st.alive || st.side === h.side) continue;
    if (dist2(x, y, s.map.xs[st.node]!, s.map.ys[st.node]!) > sr * sr || !s.tickCache.attackable[si]) continue;
    if (plan.siege || creepCovered(s, h.side, st)) return { kind: 'STRUCTURE', idx: si };
  }
  return null;
}

function creepCovered(s: MatchState, side: Side, st: Structure): boolean {
  const sx = s.map.xs[st.node]!;
  const sy = s.map.ys[st.node]!;
  const r2 = (st.range + 20) ** 2;
  for (let ci = 0; ci < s.creeps.length; ci++) {
    const c = s.creeps[ci]!;
    if (c.alive && c.side === side && dist2(sx, sy, s.cx[ci]!, s.cy[ci]!) <= r2) return true;
  }
  return false;
}

function chaseTarget(s: MatchState, h: HeroUnit, plan: ActionPlan): number {
  if (plan.focus >= 0 && s.heroes[plan.focus]!.alive) return plan.focus;
  const radius = s.cfg.ai.engageRadius + h.hero.base.attackRange;
  let near = enemyHeroesInRange(s, h, radius).filter((e) => heroTargetAllowed(s, e, plan));
  if (plan.opportunistic) near = near.filter((e) => worthTrading(s, h, e));
  if (near.length === 0) return -1;
  let best = -1;
  let bestF = Infinity;
  for (const e of near) {
    const eh = s.heroes[e]!;
    const f = eh.hp / eh.maxHp + heroDist(s, h.idx, e) / 1000;
    if (f < bestF) { bestF = f; best = e; }
  }
  return best;
}

function heroPhase(s: MatchState, brain: Brain): void {
  const dt = s.cfg.time.tickSec;
  const enemiesOf: Record<Side, number[]> = { BLUE: [], RED: [] };
  const alliesOf: Record<Side, number[]> = { BLUE: [], RED: [] };
  for (const h of s.heroes) {
    if (!h.alive) continue;
    alliesOf[h.side].push(h.idx);
    enemiesOf[enemyOf(h.side)].push(h.idx);
  }
  for (const h of s.heroes) {
    if (!h.alive || h.stunnedUntil > s.t) continue;
    brain.decide(s, h);
    const plan = brain.plan(s, h);
    if (plan.channel) {
      if (h.recallDoneAt === 0) h.recallDoneAt = s.t + s.cfg.hero.recallSec;
      else if (s.t >= h.recallDoneAt) {
        h.loc = atNode(s.map.bases[h.side]);
        h.recallDoneAt = 0;
        emit(s, { t: s.t, type: 'RECALL', side: h.side, actors: [h.player.id] });
        h.action = 'IDLE';
      }
      continue;
    }
    if (!plan.flee) {
      const foes = plan.opportunistic ? enemiesOf[h.side].filter((e) => worthTrading(s, h, e)) : enemiesOf[h.side];
      tryCastSkill(s, h, { enemies: foes, allies: alliesOf[h.side] }, plan.focus);
    }
    const target = plan.flee ? null : chooseTarget(s, h, plan);
    if (target) {
      queueHeroAttack(s, h, target);
      if (target.kind === 'HERO' && h.gankTarget === target.idx && !h.gankHit) {
        h.gankHit = true;
        brain.onGank?.(s, h, target.idx);
      }
      continue;
    }
    const speed = heroMoveSpeed(s.cfg, h, s.t) * dt;
    const chase = plan.chase || plan.focus >= 0 ? chaseTarget(s, h, plan) : -1;
    if (chase >= 0) moveHero(s.map, h, s.hloc[chase]!, speed);
    else if (plan.dest) moveHero(s.map, h, plan.dest, speed);
  }
}

// ---------------------------------------------------------------------------
// Passive income, regen, teamfights, timeline, overtime

function passivePhase(s: MatchState): void {
  const cfg = s.cfg;
  const dt = cfg.time.tickSec;
  for (const h of s.heroes) {
    if (!h.alive) continue;
    grantGold(cfg, h, cfg.hero.passiveGoldPerSec * dt);
    grantXp(cfg, h, cfg.hero.passiveXpPerSec * dt);
    const b = s.map.bases[h.side];
    if (dist2(s.map.xs[b]!, s.map.ys[b]!, s.hx[h.idx]!, s.hy[h.idx]!) <= 120 * 120) h.hp = Math.min(h.maxHp, h.hp + cfg.hero.baseRegenPerSec * h.maxHp * dt);
    else if (s.t - h.lastDamagedAt > 5) h.hp = Math.min(h.maxHp, h.hp + cfg.hero.idleRegenPerSec * h.maxHp * dt);
  }
}

function inCombat(s: MatchState, h: HeroUnit): boolean {
  if (!h.alive) return false;
  if (s.t - h.lastHeroDamageAt <= 3) return true;
  const last = h.damagers[h.damagers.length - 1];
  return last !== undefined && s.t - last.t <= 3;
}

function teamfightPhase(s: MatchState): void {
  const ai = s.cfg.ai;
  const r2 = ai.teamfightRadius ** 2;
  const fighters = s.heroes.filter((h) => inCombat(s, h));
  const tf = s.teamfight;
  if (!tf) {
    for (const c of fighters) {
      const near = fighters.filter((o) => dist2(s.hx[c.idx]!, s.hy[c.idx]!, s.hx[o.idx]!, s.hy[o.idx]!) <= r2);
      const blue = near.filter((o) => o.side === 'BLUE').length;
      const red = near.length - blue;
      if (blue >= ai.teamfightMinPerSide && red >= ai.teamfightMinPerSide) {
        const x = near.reduce((a, o) => a + s.hx[o.idx]!, 0) / near.length;
        const y = near.reduce((a, o) => a + s.hy[o.idx]!, 0) / near.length;
        const idx = emit(s, {
          t: s.t, type: 'TEAMFIGHT_START', actors: near.map((o) => o.player.id),
          nodeId: nearestNode(s, x, y), detail: { blue, red },
        });
        s.teamfight = { startT: s.t, startEvent: idx, x, y, kills: { BLUE: 0, RED: 0 }, lastActionT: s.t, participants: near.map((o) => o.idx) };
        return;
      }
    }
    return;
  }
  const near = fighters.filter((o) => dist2(tf.x, tf.y, s.hx[o.idx]!, s.hy[o.idx]!) <= r2 * 1.5);
  if (near.length > 0) {
    tf.lastActionT = s.t;
    tf.x = near.reduce((a, o) => a + s.hx[o.idx]!, 0) / near.length;
    tf.y = near.reduce((a, o) => a + s.hy[o.idx]!, 0) / near.length;
    for (const o of near) if (!tf.participants.includes(o.idx)) tf.participants.push(o.idx);
  }
  if (s.t - tf.lastActionT >= ai.teamfightEndQuietSec || s.over) endTeamfight(s);
}

function endTeamfight(s: MatchState): void {
  const tf = s.teamfight;
  if (!tf) return;
  const winner = tf.kills.BLUE > tf.kills.RED ? 'BLUE' : tf.kills.RED > tf.kills.BLUE ? 'RED' : '';
  emit(s, {
    t: s.t, type: 'TEAMFIGHT_END', side: winner || undefined, actors: tf.participants.map((i) => s.heroes[i]!.player.id),
    nodeId: nearestNode(s, tf.x, tf.y),
    detail: { blueKills: tf.kills.BLUE, redKills: tf.kills.RED, winner, startEvent: tf.startEvent, durationSec: s.t - tf.startT },
    reason: winner ? `tactic:${s.teams[winner].tactic}` : undefined,
  });
  s.teamfight = null;
}

function nearestNode(s: MatchState, x: number, y: number): string {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < s.map.n; i++) {
    const d = dist2(x, y, s.map.xs[i]!, s.map.ys[i]!);
    if (d < bestD) { bestD = d; best = i; }
  }
  return s.map.nodes[best]!.id;
}

function clockPhase(s: MatchState): void {
  const tm = s.cfg.time;
  if (s.t % tm.goldTimelineIntervalSec === 0) {
    s.goldTimeline.push({ t: s.t, diff: Math.round(teamGold(s, 'BLUE') - teamGold(s, 'RED')) || 0 }); // || 0 turns -0 into 0
  }
  if (!s.overtimeAnnounced && s.t >= tm.overtimeStartSec) {
    s.overtimeAnnounced = true;
    emit(s, { t: s.t, type: 'OVERTIME', actors: [], detail: { message: '比赛进入 30 分钟后的加时阶段：兵线逐分钟增强' }, reason: 'overtime' });
  }
  if (!s.suddenDeathAnnounced && s.t >= tm.suddenDeathSec) {
    s.suddenDeathAnnounced = true;
    emit(s, { t: s.t, type: 'OVERTIME', actors: [], detail: { message: '比赛进入决胜阶段：基地失去护甲，防御塔伤害减半' }, reason: 'sudden_death' });
  }
  if (!s.over && s.t >= tm.maxDurationSec) {
    const towers = towersStanding(s);
    const baseHp = (side: Side) => s.structures.find((st) => st.kind === 'BASE' && st.side === side)!.hp;
    let winner: Side;
    if (towers.BLUE !== towers.RED) winner = towers.BLUE > towers.RED ? 'BLUE' : 'RED';
    else if (baseHp('BLUE') !== baseHp('RED')) winner = baseHp('BLUE') > baseHp('RED') ? 'BLUE' : 'RED';
    else winner = teamGold(s, 'BLUE') >= teamGold(s, 'RED') ? 'BLUE' : 'RED';
    s.over = true;
    s.winner = winner;
    s.endReason = 'timeout';
    emit(s, { t: s.t, type: 'OVERTIME', actors: [], side: winner, detail: { message: '比赛超时，按剩余防御塔和经济判定胜负' }, reason: 'timeout' });
  }
}

export function towersStanding(s: MatchState): { BLUE: number; RED: number } {
  const out = { BLUE: 0, RED: 0 };
  for (const st of s.structures) if (st.kind === 'TOWER' && st.alive) out[st.side]++;
  return out;
}

// ---------------------------------------------------------------------------
// Public API

export function step(s: MatchState): void {
  if (s.over) return;
  const brain = brains[s.brain]!;
  s.t += s.cfg.time.tickSec;
  s.tickEventStart = s.events.length;
  s.attacks = [];
  s.skillCasts = [];
  spawnPhase(s);
  for (const side of SIDES) s.teams[side].tempo = tempoFactor(s.cfg, s.teams[side].tactic, s.t);
  cachePositions(s);
  const gb = teamGold(s, 'BLUE');
  const gr = teamGold(s, 'RED');
  s.teams.BLUE.goldDiff = gb - gr;
  s.teams.RED.goldDiff = gr - gb;
  if (brain.teamPlan && s.t % s.cfg.ai.teamPlanIntervalSec === 0) {
    for (const side of SIDES) brain.teamPlan(s, s.teams[side]);
  }
  heroPhase(s, brain);
  creepAndStructurePhase(s);
  for (const c of s.creeps) {
    if (c.alive && !c.engaged) moveWave(s.map, c, s.cfg.creeps.moveSpeed * s.cfg.time.tickSec);
  }
  applyPending(s);
  resolveDeaths(s);
  passivePhase(s);
  teamfightPhase(s);
  clockPhase(s);
  if (s.creeps.some((c) => !c.alive)) s.creeps = s.creeps.filter((c) => c.alive);
  if (s.over) {
    if (s.teamfight) endTeamfight(s);
    emit(s, { t: s.t, type: 'MATCH_END', side: s.winner!, actors: [], detail: { reason: s.endReason }, reason: s.endReason === 'timeout' ? 'timeout' : undefined });
  }
}

export function isOver(s: MatchState): boolean {
  return s.over;
}

export function getSnapshot(s: MatchState): RenderSnapshot {
  const units: SnapshotUnit[] = [];
  for (const h of s.heroes) {
    const p = coordOf(s.map, h.loc);
    units.push({
      id: h.id, kind: 'HERO', side: h.side, x: p.x, y: p.y, hp: h.hp, maxHp: h.maxHp, alive: h.alive,
      playerId: h.player.id, heroId: h.hero.id, level: h.level, action: h.action, stunned: h.stunnedUntil > s.t, shield: h.shield,
    });
  }
  for (const c of s.creeps) {
    const p = coordOf(s.map, c.loc);
    units.push({ id: c.id, kind: 'CREEP', side: c.side, x: p.x, y: p.y, hp: c.hp, maxHp: c.maxHp, alive: c.alive });
  }
  for (const st of s.structures) {
    const [x, y] = nodeXY(s, st.node);
    units.push({ id: st.id, kind: st.kind, side: st.side, x, y, hp: st.hp, maxHp: st.maxHp, alive: st.alive });
  }
  for (const ob of s.objectives) {
    const [x, y] = nodeXY(s, ob.node);
    units.push({ id: ob.id, kind: 'OBJECTIVE', side: null, x, y, hp: ob.hp, maxHp: ob.maxHp, alive: ob.alive });
  }
  return {
    t: s.t,
    over: s.over,
    winner: s.winner,
    units,
    attacks: [...s.attacks],
    kills: { BLUE: s.teams.BLUE.kills, RED: s.teams.RED.kills },
    gold: { BLUE: Math.round(teamGold(s, 'BLUE')), RED: Math.round(teamGold(s, 'RED')) },
    towersStanding: towersStanding(s),
    newEvents: s.events.slice(s.tickEventStart),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function finalize(s: MatchState): MatchResult {
  if (!s.over) throw new Error('finalize: match is not over');
  const winner = s.winner!;
  const players: PlayerMatchStats[] = [];
  const totalKills = s.heroes.reduce((a, h) => a + h.kills, 0);
  for (const side of SIDES) {
    const team = s.heroes.filter((h) => h.side === side);
    const avgGold = team.reduce((a, h) => a + h.gold, 0) / team.length || 1;
    const avgDmg = team.reduce((a, h) => a + h.heroDamage, 0) / team.length || 1;
    for (const h of team) {
      // Kill involvement is scaled by how bloody the match was, and every term saturates,
      // so ratings spread over 3-9 instead of piling up at 10.
      const perf = (h.kills + 0.6 * h.assists - 0.8 * h.deaths) / Math.max(3, totalKills / 10);
      const raw = 5.6 + (side === winner ? 0.7 : -0.7)
        + 1.6 * Math.tanh(perf / 2)
        + 0.8 * Math.tanh(h.heroDamage / avgDmg - 1)
        + 0.6 * Math.tanh(h.gold / avgGold - 1);
      players.push({
        playerId: h.player.id, heroId: h.hero.id, side, kills: h.kills, deaths: h.deaths, assists: h.assists,
        gold: Math.round(h.gold), damageDealt: Math.round(h.damageDealt), rating: Math.round(clamp(raw, 1, 10) * 10) / 10,
      });
    }
  }
  const winners = players.filter((p) => p.side === winner);
  const mvp = winners.reduce((best, p) => (p.rating > best.rating ? p : best), winners[0]!).playerId;
  const towers = towersStanding(s);
  const body = { winner, durationSec: s.t, players, towers, events: s.events, goldDiffTimeline: s.goldTimeline };
  const checksum = hashString(JSON.stringify(body)).toString(16).padStart(8, '0');
  return { winner, durationSec: s.t, players, goldDiffTimeline: [...s.goldTimeline], towers, events: [...s.events], mvp, checksum };
}

export function runMatch(input: MatchInput, data: GameData, opts: MatchOptions = {}): MatchResult {
  const s = createMatch(input, data, opts);
  while (!s.over) step(s);
  return finalize(s);
}
