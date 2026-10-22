// Hero decision making. A brain picks an action; planFor() turns the action
// into concrete movement and targeting rules for the current tick.

import type { Lane, Role, Side } from '../core/types';
import { atNode, type Loc } from './map';
import { dist2, nodeXY, structureAttackable } from './combat';
import type { MatchState } from './state';
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
}

export function emptyPlan(dest: Loc | null): ActionPlan {
  return { dest, flee: false, channel: false, chase: false, focus: -1, siege: false, dive: false, objective: -1, camp: -1 };
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
  return s.structures.filter((st) => st.kind === 'TOWER' && st.side === side && st.lane === lane).sort((a, b) => a.tier - b.tier);
}

/** The next enemy structure a team must destroy on a lane (towers, then base). */
export function nextEnemyStructure(s: MatchState, side: Side, lane: Lane): Structure | null {
  const enemy = side === 'BLUE' ? 'RED' : 'BLUE';
  for (const st of ownTowers(s, enemy, lane)) if (st.alive) return st;
  return s.structures.find((st) => st.kind === 'BASE' && st.side === enemy && st.alive) ?? null;
}

/** Location of the team's most advanced creep wave on a lane, or its outermost standing tower. */
export function laneFront(s: MatchState, side: Side, lane: Lane): Loc {
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
  const [bx, by] = nodeXY(s, s.map.bases[h.side]);
  return dist2(bx, by, s.hx[h.idx]!, s.hy[h.idx]!) <= 60 * 60;
}

export function structureLoc(st: Structure): Loc {
  return atNode(st.node);
}

export function structureIsAttackable(s: MatchState, st: Structure): boolean {
  return structureAttackable(s, st);
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
