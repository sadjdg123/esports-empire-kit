// Hero decision making. A brain picks an action; planFor() turns the action
// into concrete movement and targeting rules for the current tick.

import type { Lane, Role, Side } from '../core/types';
import { atNode, type Loc } from './map';
import { dist2 } from './combat';
import { emit } from './events';
import { FORCE_RADIUS, type LocalForces, type MatchState, type TeamState } from './state';
import { actionReason, tacticFactor } from './tactics';
import { waveAdvance, type HeroUnit, type Structure } from './units';

export interface ActionPlan {
  dest: Loc | null;
  flee: boolean; // move only, never attack
  channel: boolean; // stand still (recall)
  chase: boolean; // may chase enemy heroes inside the engage radius
  focus: number; // hero to focus, -1 for none
  siege: boolean; // may attack structures without creep cover
  dive: boolean; // may attack heroes standing under enemy structures
  objective: number; // objective index to attack, -1 for none
  camp: number; // camp index to attack, -1 for none
  /** Farming: only hit heroes that are weak, attacking us, or that we chose to chase. */
  opportunistic: boolean;
}

export function emptyPlan(dest: Loc | null): ActionPlan {
  return { dest, flee: false, channel: false, chase: false, focus: -1, siege: false, dive: false, objective: -1, camp: -1, opportunistic: false };
}

export function laneOfRole(role: Role): Lane {
  if (role === 'TOP') return 'TOP';
  if (role === 'ADC' || role === 'SUPPORT') return 'BOT';
  return 'MID';
}

export function setAction(s: MatchState, h: HeroUnit, action: string, target = -1): void {
  if (h.action !== action || h.actionTarget !== target) {
    h.action = action;
    h.actionTarget = target;
    h.actionSince = s.t;
    h.gankHit = false;
    h.gankTarget = action === 'GANK' ? target : -1;
    if (action !== 'RECALL') h.recallDoneAt = 0;
  }
}

/** Own structures of `side` on `lane`, outermost first (tier 1, tier 2). */
export function ownTowers(s: MatchState, side: Side, lane: Lane): Structure[] {
  return s.laneTowers[side][lane];
}

/** The next enemy structure a team must destroy on a lane (towers, then base). */
export function nextEnemyStructure(s: MatchState, side: Side, lane: Lane): Structure | null {
  const enemy = side === 'BLUE' ? 'RED' : 'BLUE';
  for (const st of ownTowers(s, enemy, lane)) if (st.alive) return st;
  const b = s.bases[enemy];
  return b.alive ? b : null;
}

/** Location of the team's most advanced creep wave on a lane, or its outermost standing tower. */
export function laneFront(s: MatchState, side: Side, lane: Lane): Loc {
  const key = `${side}:${lane}`;
  const cached = s.tickCache.t === s.t ? s.tickCache.front.get(key) : undefined;
  if (cached) return cached;
  const loc = computeLaneFront(s, side, lane);
  if (s.tickCache.t === s.t) s.tickCache.front.set(key, loc);
  return loc;
}

function computeLaneFront(s: MatchState, side: Side, lane: Lane): Loc {
  let best: Loc | null = null;
  let bestAdv = -1;
  for (const c of s.creeps) {
    if (!c.alive || c.side !== side || c.lane !== lane) continue;
    const adv = waveAdvance(s.map, c);
    if (adv > bestAdv) { bestAdv = adv; best = c.loc; }
  }
  if (best) return best;
  return atNode(fallbackNode(s, side, lane));
}

function fallbackNode(s: MatchState, side: Side, lane: Lane): number {
  for (const st of ownTowers(s, side, lane)) if (st.alive) return st.node;
  return s.map.bases[side];
}

export function atOwnBase(s: MatchState, h: HeroUnit): boolean {
  const b = s.map.bases[h.side];
  return dist2(s.map.xs[b]!, s.map.ys[b]!, s.hx[h.idx]!, s.hy[h.idx]!) <= 60 * 60;
}

export function structureLoc(st: Structure): Loc {
  return atNode(st.node);
}

function structureThreat(s: MatchState, si: number, side: Side): number {
  const tc = s.tickCache;
  const cached = tc.threat[si]!;
  if (cached >= 0) return cached;
  const st = s.structures[si]!;
  const sx = s.map.xs[st.node]!;
  const sy = s.map.ys[st.node]!;
  const r2 = (st.range + 150) ** 2;
  let threat = 0;
  for (const e of s.heroes) if (e.alive && e.side !== side && dist2(sx, sy, s.hx[e.idx]!, s.hy[e.idx]!) <= r2) threat += 1;
  s.creeps.forEach((c, ci) => { if (c.alive && c.side !== side && dist2(sx, sy, s.cx[ci]!, s.cy[ci]!) <= r2) threat += 0.35; });
  tc.threat[si] = threat;
  return threat;
}

// ---------------------------------------------------------------------------
// Simple brain: walk to the lane, fight whatever is in range, retreat when low.

export function decideSimple(s: MatchState, h: HeroUnit): void {
  const hpF = h.hp / h.maxHp;
  if (h.action === 'RETREAT') {
    if (atOwnBase(s, h) && hpF >= 0.9) setAction(s, h, 'LANE');
    return;
  }
  if (hpF < 0.25) setAction(s, h, 'RETREAT');
  else setAction(s, h, 'LANE');
}

export function planSimple(s: MatchState, h: HeroUnit): ActionPlan {
  if (h.action === 'RETREAT') return { ...emptyPlan(atNode(s.map.bases[h.side])), flee: true };
  const plan = emptyPlan(laneFront(s, h.side, laneOfRole(h.role)));
  plan.chase = true;
  return plan;
}

// ---------------------------------------------------------------------------
// Utility brain (spec 5.7): each hero periodically scores every action and
// picks the best one. Tactics scale the scores; awareness controls how often
// and how accurately a hero re-evaluates.

const LANE_LIST: readonly Lane[] = ['TOP', 'MID', 'BOT'];

/** Forces within FORCE_RADIUS of a hero, cached for the tick. */
function forcesAround(s: MatchState, h: HeroUnit): LocalForces {
  const tc = s.tickCache;
  const cached = tc.forces[h.idx];
  if (cached) return cached;
  const f = localForces(s, h, FORCE_RADIUS);
  tc.forces[h.idx] = f;
  return f;
}

function localForces(s: MatchState, h: HeroUnit, radius: number): LocalForces {
  const r2 = radius * radius;
  const x = s.hx[h.idx]!;
  const y = s.hy[h.idx]!;
  const out: LocalForces = { ally: 0, enemy: 0, enemies: [], allies: [] };
  for (const o of s.heroes) {
    if (!o.alive) continue;
    if (dist2(x, y, s.hx[o.idx]!, s.hy[o.idx]!) > r2) continue;
    if (o.side === h.side) {
      out.ally += s.tickCache.power[o.idx]!;
      if (o.idx !== h.idx) out.allies.push(o.idx);
    } else {
      out.enemy += s.tickCache.power[o.idx]!;
      out.enemies.push(o.idx);
    }
  }
  return out;
}

function base(s: MatchState, action: string, role: Role): number {
  return s.cfg.ai.baseUtility[action]?.[role] ?? 0;
}

function tf(s: MatchState, h: HeroUnit, action: string): number {
  return tacticFactor(s.cfg, s.teams[h.side].tactic, action, h.role, s.t);
}

function euclidTo(s: MatchState, h: HeroUnit, node: number): number {
  return Math.sqrt(dist2(s.hx[h.idx]!, s.hy[h.idx]!, s.map.xs[node]!, s.map.ys[node]!));
}

function hpFrac(h: HeroUnit): number {
  return (h.hp + h.shield) / h.maxHp;
}

/** Awareness roll: does the hero notice an enemy coming to gank it? */
function checkGankAwareness(s: MatchState, h: HeroUnit): void {
  const r2 = s.cfg.ai.awarenessRadius ** 2;
  for (const e of s.heroes) {
    if (!e.alive || e.side === h.side || e.gankTarget !== h.idx) continue;
    if (h.gankSeen[e.idx] === e.actionSince) continue;
    if (dist2(s.hx[h.idx]!, s.hy[h.idx]!, s.hx[e.idx]!, s.hy[e.idx]!) > r2) continue;
    h.gankSeen[e.idx] = e.actionSince;
    if (s.rng.chance(h.coef.gankDetect)) h.alertUntil = s.t + 6;
  }
}

function actionValid(s: MatchState, h: HeroUnit): boolean {
  switch (h.action) {
    case 'IDLE': return false;
    case 'GANK': {
      const t = s.heroes[h.actionTarget];
      if (!t || !t.alive || s.t - h.actionSince >= 30 || euclidTo(s, t, s.map.bases[t.side]) <= 250) return false;
      // Abort when the target escaped under its tower healthy, or we walked into a bad fight.
      if (s.tickCache.underOwnStructure[t.idx] && hpFrac(t) > 0.35) return false;
      const f = forcesAround(s, h);
      return f.enemy === 0 || f.ally / f.enemy >= 0.75;
    }
    case 'CONTEST_OBJECTIVE': {
      const ob = s.objectives[h.actionTarget];
      return !!ob && (ob.alive || ob.nextSpawnAt - s.t <= 25);
    }
    case 'RETREAT': return !(atOwnBase(s, h) && hpFrac(h) >= 0.9);
    case 'RECALL': return true;
    default: return true;
  }
}

interface Choice {
  action: string;
  target: number;
  u: number;
}

function scoreActions(s: MatchState, h: HeroUnit): Choice | null {
  const cfg = s.cfg;
  const t = s.t;
  const team = s.teams[h.side];
  const tac = cfg.tactics[team.tactic];
  const hpF = hpFrac(h);
  const near = forcesAround(s, h);
  const ratio = near.enemy === 0 ? 9 : near.ally / near.enemy;
  const best: Choice = { action: '', target: -1, u: -Infinity };
  const noise = h.coef.decisionNoise;
  const hyst = cfg.ai.hysteresis;
  // Noise (lower awareness = noisier judgement) and commitment to the current action.
  const add = (action: string, target: number, u: number): void => {
    if (u <= 0) return;
    let v = u + (s.rng.next() * 2 - 1) * noise;
    if (action === h.action && (target === h.actionTarget || action === 'GROUP')) v += hyst;
    if (v > best.u) { best.action = action; best.target = target; best.u = v; }
  };

  // RETREAT
  const thr = h.coef.retreatThreshold + tac.retreatThresholdDelta;
  let retreat = 0;
  if (hpF < thr) retreat = base(s, 'RETREAT', h.role);
  else if (h.alertUntil > t && ratio < 1.2) retreat = 1.4;
  else if (near.enemies.length >= 2 && ratio < 0.55 && hpF < 0.7) retreat = 1.1 * (h.player.attrs.awareness / 100 + 0.3);
  add('RETREAT', -1, retreat);

  // RECALL
  if (hpF < cfg.ai.recallHpFraction && !atOwnBase(s, h)) {
    const safe = near.enemies.length === 0;
    if (safe) add('RECALL', -1, base(s, 'RECALL', h.role) * (1 + (cfg.ai.recallHpFraction - hpF) * 2));
  }

  // FARM_LANE / FARM_JUNGLE (less attractive as the game goes on)
  const ai = cfg.ai;
  const decay = 1 - (1 - ai.farmDecayMin) * Math.max(0, Math.min(1, (t - ai.farmDecayStartSec) / (ai.farmDecayEndSec - ai.farmDecayStartSec)));
  add('FARM_LANE', LANE_LIST.indexOf(laneOfRole(h.role)), base(s, 'FARM_LANE', h.role) * tf(s, h, 'FARM_LANE') * decay);
  const jg = base(s, 'FARM_JUNGLE', h.role);
  if (jg > 0) {
    const camp = pickCamp(s, h);
    const anyAlive = s.camps.some((c) => c.side === h.side && c.alive);
    add('FARM_JUNGLE', camp, jg * tf(s, h, 'FARM_JUNGLE') * (anyAlive ? 1 : 0.4) * decay);
  }

  // GANK
  const gk = base(s, 'GANK', h.role);
  if (gk > 0 && t >= cfg.ai.gankMinSec) {
    let best = -1;
    let bestScore = 0;
    for (const e of s.heroes) {
      if (!e.alive || e.side === h.side) continue;
      const eBase = euclidTo(s, e, s.map.bases[e.side]);
      if (eBase < 300) continue;
      const d = Math.sqrt(dist2(s.hx[h.idx]!, s.hy[h.idx]!, s.hx[e.idx]!, s.hy[e.idx]!));
      let score = 0.35 * (1 - hpFrac(e)) + 0.35 * Math.max(0, 1 - d / 1400) + (eBase > 700 ? 0.3 : 0);
      if (s.tickCache.underOwnStructure[e.idx]) score *= 0.4;
      // Prefer isolated targets: count the target's teammates around it.
      const guards = forcesAround(s, e).allies.length;
      score *= guards === 0 ? 1.2 : guards === 1 ? 0.8 : 0.4;
      if (score > bestScore) { bestScore = score; best = e.idx; }
    }
    if (best >= 0) {
      let u = gk * tf(s, h, 'GANK') * (0.4 + bestScore);
      if (h.action === 'GANK' && h.actionTarget !== best) u *= 0.9;
      add('GANK', best, u);
    }
  }

  // CONTEST_OBJECTIVE
  const co = base(s, 'CONTEST_OBJECTIVE', h.role);
  if (co > 0) {
    s.objectives.forEach((ob, oi) => {
      const wait = ob.alive ? 0 : ob.nextSpawnAt - t;
      if (wait > 20) return;
      const d = euclidTo(s, h, ob.node);
      const mates = s.tickCache.contesting[h.side][oi]! - (h.action === 'CONTEST_OBJECTIVE' && h.actionTarget === oi ? 1 : 0);
      add('CONTEST_OBJECTIVE', oi, co * tf(s, h, 'CONTEST_OBJECTIVE') * (0.7 + 0.3 * Math.max(0, 1 - d / 1500)) + 0.2 * mates);
    });
  }

  // PUSH
  const pu = base(s, 'PUSH', h.role);
  if (pu > 0) {
    const lane = h.role === 'JUNGLE' ? team.siegeLane : laneOfRole(h.role);
    const target = nextEnemyStructure(s, h.side, lane);
    if (target) {
      const covered = s.creeps.some((c, ci) => c.alive && c.side === h.side && c.lane === lane
        && dist2(s.cx[ci]!, s.cy[ci]!, s.map.xs[target.node]!, s.map.ys[target.node]!) <= 350 * 350);
      const lead = Math.max(-0.3, Math.min(0.5, team.goldDiff / 6000));
      add('PUSH', LANE_LIST.indexOf(lane), pu * tf(s, h, 'PUSH') * (covered ? 1 + lead : 0.3));
    }
  }

  // GROUP
  const gr = base(s, 'GROUP', h.role);
  if (gr > 0 && t >= cfg.ai.groupStartSec) {
    const ramp = Math.min(0.6, (cfg.ai.groupRampPerMin * (t - cfg.ai.groupStartSec)) / 60);
    const joined = s.tickCache.grouping[h.side] - (h.action === 'GROUP' ? 1 : 0);
    let u = (gr + ramp) * tf(s, h, 'GROUP') * (1 + 0.15 * joined);
    if (team.groupCallAt >= 0 && t < h.groupJoinAt) u *= 0.4;
    add('GROUP', LANE_LIST.indexOf(team.siegeLane), u);
  }

  // DEFEND
  const df = base(s, 'DEFEND', h.role);
  if (df > 0) {
    s.structures.forEach((st, si) => {
      if (!st.alive || st.side !== h.side || !s.tickCache.attackable[si]) return;
      const threat = structureThreat(s, si, h.side);
      if (threat <= 0) return;
      const d = euclidTo(s, h, st.node);
      const importance = st.kind === 'BASE' ? 1.8 : st.tier === 2 ? 1.3 : 1;
      add('DEFEND', si, df * tf(s, h, 'DEFEND') * importance * Math.min(1.8, 0.4 + 0.35 * threat) * Math.max(0.35, 1 - d / 3000));
    });
  }

  // SPLIT
  const sp = base(s, 'SPLIT', h.role);
  if (sp > 0 && t >= 600) {
    const lane = splitLane(s, h);
    let u = sp * tf(s, h, 'SPLIT');
    if (near.enemies.length >= 2) u *= 0.3;
    add('SPLIT', LANE_LIST.indexOf(lane), u);
  }

  return best.action ? best : null;
}

function pickCamp(s: MatchState, h: HeroUnit): number {
  let best = -1;
  let bestScore = Infinity;
  s.camps.forEach((c, ci) => {
    if (c.side !== h.side) return;
    const wait = c.alive ? 0 : Math.max(0, c.nextSpawnAt - s.t);
    const score = euclidTo(s, h, c.node) / h.hero.base.moveSpeed + wait;
    if (score < bestScore) { bestScore = score; best = ci; }
  });
  return best;
}

function splitLane(s: MatchState, h: HeroUnit): Lane {
  if (h.role === 'TOP' || h.role === 'ADC') {
    const own = laneOfRole(h.role);
    if (nextEnemyStructure(s, h.side, own)) return own;
  }
  // The side lane farthest from the enemy team's centre.
  let ex = 0, ey = 0, n = 0;
  for (const e of s.heroes) if (e.alive && e.side !== h.side) { ex += s.hx[e.idx]!; ey += s.hy[e.idx]!; n++; }
  if (n === 0) return 'TOP';
  ex /= n; ey /= n;
  const topNode = s.map.lanes.TOP[3]!;
  const botNode = s.map.lanes.BOT[3]!;
  const dTop = dist2(ex, ey, s.map.xs[topNode]!, s.map.ys[topNode]!);
  const dBot = dist2(ex, ey, s.map.xs[botNode]!, s.map.ys[botNode]!);
  return dTop >= dBot ? 'TOP' : 'BOT';
}

export function decideUtility(s: MatchState, h: HeroUnit): void {
  checkGankAwareness(s, h);
  const valid = actionValid(s, h);
  if (valid && h.action === 'RETREAT' && hpFrac(h) < 0.9) return; // keep running home
  if (valid && h.action === 'RECALL' && h.recallDoneAt > 0) {
    if (forcesAround(s, h).enemies.length === 0) return;
  }
  if (valid && !s.rng.chance(h.coef.decisionChance)) return;
  const best = scoreActions(s, h);
  if (!best) return;
  const prev = h.action;
  setAction(s, h, best.action, best.target);
  const team = s.teams[h.side];
  if (best.action === 'GROUP' && team.groupCallAt < 0) {
    team.groupCallAt = s.t;
    for (const i of team.heroIdx) {
      const o = s.heroes[i]!;
      o.groupJoinAt = s.t + o.coef.groupDelay * (0.5 + s.rng.next());
    }
  }
  if (best.action === 'SPLIT' && prev !== 'SPLIT' && s.t - h.lastSplitEventAt >= 60) {
    h.lastSplitEventAt = s.t;
    const lane = LANE_LIST[best.target] ?? 'TOP';
    emit(s, {
      t: s.t, type: 'SPLIT_PUSH', side: h.side, actors: [h.player.id],
      detail: { lane, laneName: lane === 'TOP' ? '上路' : lane === 'MID' ? '中路' : '下路' },
      reason: actionReason(s.cfg, team.tactic, 'SPLIT', h.role, s.t),
    });
  }
}

function engageOk(s: MatchState, h: HeroUnit): boolean {
  const f = forcesAround(s, h);
  if (f.enemy === 0) return true;
  return f.ally / f.enemy >= s.cfg.tactics[s.teams[h.side].tactic].engageRatio;
}

export function planUtility(s: MatchState, h: HeroUnit): ActionPlan {
  const team = s.teams[h.side];
  switch (h.action) {
    case 'RETREAT':
      return { ...emptyPlan(atNode(s.map.bases[h.side])), flee: true };
    case 'RECALL':
      return { ...emptyPlan(null), channel: true };
    case 'FARM_JUNGLE': {
      let ci = h.actionTarget;
      if (ci < 0 || (!s.camps[ci]!.alive && s.camps.some((c) => c.side === h.side && c.alive))) {
        ci = pickCamp(s, h);
        h.actionTarget = ci;
      }
      const camp = s.camps[ci]!;
      const plan = emptyPlan(atNode(camp.node));
      plan.camp = ci;
      plan.chase = engageOk(s, h);
      plan.opportunistic = true;
      return plan;
    }
    case 'GANK': {
      const target = s.heroes[h.actionTarget]!;
      const plan = emptyPlan(s.hloc[target.idx]!);
      plan.focus = target.idx;
      plan.chase = true;
      const helpers = forcesAround(s, target).enemies.length; // our heroes around the target
      plan.dive = hpFrac(target) < 0.35 || helpers >= 2;
      return plan;
    }
    case 'CONTEST_OBJECTIVE': {
      const ob = s.objectives[h.actionTarget]!;
      const plan = emptyPlan(atNode(ob.node));
      plan.objective = h.actionTarget;
      plan.chase = engageOk(s, h);
      return plan;
    }
    case 'PUSH': {
      const lane = LANE_LIST[h.actionTarget] ?? 'MID';
      const plan = emptyPlan(laneFront(s, h.side, lane));
      const target = nextEnemyStructure(s, h.side, lane);
      plan.siege = !!target && (forcesAround(s, h).allies.length >= 1 || target.hp / target.maxHp < 0.3);
      plan.chase = engageOk(s, h);
      return plan;
    }
    case 'GROUP': {
      const lane = team.siegeLane;
      const front = laneFront(s, h.side, lane);
      const target = nextEnemyStructure(s, h.side, lane);
      const grouped = s.heroes.filter((o) => o.alive && o.side === h.side && o.action === 'GROUP'
        && Math.sqrt(dist2(s.hx[o.idx]!, s.hy[o.idx]!, s.hx[h.idx]!, s.hy[h.idx]!)) <= 600).length;
      const plan = emptyPlan(grouped >= 3 && target ? structureLoc(target) : front);
      plan.siege = grouped >= 3;
      plan.dive = grouped >= 4;
      plan.chase = engageOk(s, h);
      return plan;
    }
    case 'DEFEND': {
      const st = s.structures[h.actionTarget]!;
      const plan = emptyPlan(structureLoc(st));
      plan.chase = engageOk(s, h);
      return plan;
    }
    case 'SPLIT': {
      const lane = LANE_LIST[h.actionTarget] ?? 'TOP';
      const plan = emptyPlan(laneFront(s, h.side, lane));
      const target = nextEnemyStructure(s, h.side, lane);
      plan.siege = !!target && target.hp / target.maxHp < 0.4;
      plan.chase = engageOk(s, h) && forcesAround(s, h).enemies.length <= 1;
      return plan;
    }
    case 'FARM_LANE':
    default: {
      const lane = h.action === 'FARM_LANE' ? (LANE_LIST[h.actionTarget] ?? laneOfRole(h.role)) : laneOfRole(h.role);
      const plan = emptyPlan(laneFront(s, h.side, lane));
      plan.chase = engageOk(s, h);
      plan.opportunistic = true;
      return plan;
    }
  }
}

/** Team-level plan: which lane to siege when grouping; expire stale group calls. */
export function teamPlanUtility(s: MatchState, team: TeamState): void {
  let bestLane: Lane = 'MID';
  let bestScore = -Infinity;
  for (const lane of LANE_LIST) {
    const st = nextEnemyStructure(s, team.side, lane);
    if (!st) continue;
    const progress = st.kind === 'BASE' ? 2 : st.tier - 1;
    const score = progress + (1 - st.hp / st.maxHp) * 0.8 + (lane === 'MID' ? 0.3 : 0);
    if (score > bestScore) { bestScore = score; bestLane = lane; }
  }
  team.siegeLane = bestLane;
  const grouping = team.heroIdx.filter((i) => s.heroes[i]!.alive && s.heroes[i]!.action === 'GROUP').length;
  if (team.groupCallAt >= 0 && grouping < 2 && s.t - team.groupCallAt > 20) team.groupCallAt = -1;
}

export function onGankUtility(s: MatchState, h: HeroUnit, target: number): void {
  const victim = s.heroes[target]!;
  emit(s, {
    t: s.t, type: 'GANK', side: h.side, actors: [h.player.id], targets: [victim.player.id],
    nodeId: s.map.nodes[nearestNodeIdx(s, s.hx[target]!, s.hy[target]!)]!.id,
    detail: { victimRole: victim.role },
    reason: actionReason(s.cfg, s.teams[h.side].tactic, 'GANK', h.role, s.t),
  });
}

function nearestNodeIdx(s: MatchState, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < s.map.n; i++) {
    const d = dist2(x, y, s.map.xs[i]!, s.map.ys[i]!);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
