// Squad advice for the player (GATE-4 feedback): which roles the roster still lacks, which
// lineup picks play out of position, and how long the money lasts at the current payroll.
// Only reads the state; the interface shows it when signing players and setting the lineup.

import { ROLES, type GameData, type PlayerId, type Role } from '../core/types';
import { expectedWeeklyIncome, weeklyMoney } from './finance';
import { rosterOf } from './game';
import { PLAYER_CLUB_ID, type GameState } from './state';

/** Roles nobody on the roster plays as their main role. */
export function missingRoles(state: GameState): Role[] {
  const have = new Set(rosterOf(state).map((p) => p.primaryRole));
  return ROLES.filter((r) => !have.has(r));
}

/** Lineup picks of players outside their main and second role. */
export function offRolePicks(state: GameState): { role: Role; playerId: PlayerId }[] {
  return (state.lineup?.picks ?? []).filter((pk) => {
    const p = state.players[pk.playerId];
    return p && p.primaryRole !== pk.role && p.secondaryRole !== pk.role;
  }).map((pk) => ({ role: pk.role, playerId: pk.playerId }));
}

/** Money in a typical week of the season (sponsor, league share, merchandise, average prizes) minus all running costs. */
export interface MoneyOutlook { weeklyNet: number; weeksLeft: number | null } // weeksLeft: null when the money does not run out

export function moneyOutlook(state: GameState, data: GameData, extraSalary = 0, funds = state.funds): MoneyOutlook {
  const m = weeklyMoney(state, data);
  const costs = m.salaries + extraSalary + m.training + m.upkeep + m.staff;
  const weeklyNet = Math.round(expectedWeeklyIncome(state, data, PLAYER_CLUB_ID) - costs);
  const weeksLeft = weeklyNet >= 0 ? null : Math.max(0, Math.floor(funds / -weeklyNet));
  return { weeklyNet, weeksLeft };
}

/**
 * Signing a player: whether it fills a role twice while another role is still empty,
 * and the money outlook afterwards (salary and signing fee included).
 */
export function signingAdvice(state: GameState, data: GameData, playerId: PlayerId): { duplicate: Role | null; missing: Role[]; after: MoneyOutlook } {
  const p = state.players[playerId]!;
  const missing = missingRoles(state);
  const duplicate = missing.length > 0 && !missing.includes(p.primaryRole) ? p.primaryRole : null;
  const extra = p.salaryPerWeek + data.economy.finance.trainingCostPerPlayer;
  return { duplicate, missing, after: moneyOutlook(state, data, extra, state.funds - p.signingFee) };
}
