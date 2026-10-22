// How a team's tactic scales the utility of each AI action.

import type { MatchConfig, Role, Tactic } from '../core/types';

/** Actions affected by a rule whose action list is ['*']. */
export const AGGRESSIVE_ACTIONS: readonly string[] = ['GANK', 'CONTEST_OBJECTIVE', 'PUSH', 'GROUP', 'SPLIT'];

function ruleMatches(actions: readonly string[], action: string): boolean {
  return actions.includes(action) || (actions.includes('*') && AGGRESSIVE_ACTIONS.includes(action));
}

/** Product of all tactic rules that apply to this action, role and time. */
export function tacticFactor(cfg: MatchConfig, tactic: Tactic, action: string, role: Role, t: number): number {
  let f = 1;
  for (const r of cfg.tactics[tactic].rules) {
    if (!ruleMatches(r.actions, action)) continue;
    if (r.fromSec !== undefined && t < r.fromSec) continue;
    if (r.toSec !== undefined && t >= r.toSec) continue;
    if (r.roles && !r.roles.includes(role)) continue;
    f *= r.factor;
  }
  return f;
}

/** Reason tag for an event caused by this action: the tactic if it boosted it. */
export function actionReason(cfg: MatchConfig, tactic: Tactic, action: string, role: Role, t: number): string {
  return tacticFactor(cfg, tactic, action, role, t) > 1.001 ? `tactic:${tactic}` : `role:${role}`;
}

/** Team damage multiplier from the tactic's power curve at time t. */
export function tempoFactor(cfg: MatchConfig, tactic: Tactic, t: number): number {
  let f = 1;
  for (const w of cfg.tactics[tactic].powerCurve) {
    if (w.fromSec !== undefined && t < w.fromSec) continue;
    if (w.toSec !== undefined && t >= w.toSec) continue;
    f *= w.damage;
  }
  return f;
}
