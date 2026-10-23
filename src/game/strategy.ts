// Simple automatic management used for economy calibration and tests:
// sign the best-value player of each role, then use the recommended lineup.

import type { GameData, Player, Role } from '../core/types';
import { ROLES } from '../core/types';
import { acceptRenewal, expiringPlayers, negotiationFor, renewalAsk } from './contracts';
import { activeSponsor, bestSponsorFor, signSponsor } from './finance';
import { marketPlayers, playerOverall, recommendLineup, rosterOf, setLineup, signPlayer, type Result } from './game';
import type { GameState } from './state';

/** Ability per unit of salary, with diminishing returns on cost. */
export function valueScore(p: Player): number {
  return playerOverall(p) / Math.sqrt(Math.max(1, p.salaryPerWeek));
}

export function signValueSquad(state: GameState, data: GameData): Result {
  for (const role of ROLES as readonly Role[]) {
    const candidates = marketPlayers(state).filter((p) => p.primaryRole === role).sort((a, b) => valueScore(b) - valueScore(a) || a.id.localeCompare(b.id));
    const pick = candidates.find((p) => p.signingFee <= state.funds);
    if (!pick) return { ok: false, error: `签不起任何${role}` };
    const r = signPlayer(state, data, pick.id);
    if (!r.ok) return r;
  }
  if (!activeSponsor(state) && state.calendar.phase !== 'FINISHED') signSponsor(state, data, bestSponsorFor(data, state.club.reputation).id, 1);
  const lineup = recommendLineup(state, data);
  if (!lineup.ok) return lineup;
  return setLineup(state, data, lineup.value);
}

/**
 * Keeps the player's club playable season after season: renews expiring
 * contracts it can afford, fills missing roles (best value, or the best
 * player it can afford for 'star'), signs a sponsor and sets the lineup.
 */
export type ManageStyle = 'value' | 'balanced' | 'star';

/** Weekly salary a 'balanced' manager allows per player: a fifth of what the club earns in a typical week. */
export function balancedSalaryCap(state: GameState, data: GameData): number {
  const f = data.economy.finance;
  const weeks = data.season.preseasonWeeks + state.totalRounds + 2;
  const prizes = (state.totalRounds * (data.economy.prizeWin + data.economy.prizeLoss)) / 2 / weeks;
  const income = bestSponsorFor(data, state.club.reputation).weekly + f.leagueShareWeekly * ((state.totalRounds + 2) / weeks)
    + f.merchBase + state.club.reputation * f.merchPerReputation + prizes;
  return income / data.economy.minRoster;
}

export function autoManage(state: GameState, data: GameData, style: ManageStyle = 'value'): Result {
  const cap = style === 'balanced' ? balancedSalaryCap(state, data) : Infinity;
  const score = style === 'value' ? valueScore : (p: Player) => (p.salaryPerWeek <= cap ? playerOverall(p) : playerOverall(p) - 1000);
  const emergencyCap = data.economy.finance.emergencySigningMaxSalary;
  const canSign = (p: Player) => p.signingFee <= state.funds || (state.club.roster.length < data.economy.minRoster && p.salaryPerWeek <= emergencyCap);
  if (state.calendar.phase !== 'FINISHED') {
    for (const p of expiringPlayers(state)) {
      if (negotiationFor(state, p.id)) continue;
      if (renewalAsk(data, p) * 4 <= state.funds) acceptRenewal(state, data, p.id, data.economy.contracts.defaultYears);
    }
  }
  const has = (role: Role) => rosterOf(state).some((p) => p.primaryRole === role);
  for (const role of ROLES as readonly Role[]) {
    if (has(role) || state.club.roster.length >= data.economy.maxRoster) continue;
    const pick = marketPlayers(state).filter((p) => p.primaryRole === role && canSign(p)).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
    if (pick) signPlayer(state, data, pick.id);
  }
  while (state.club.roster.length < data.economy.minRoster) {
    const pick = marketPlayers(state).filter(canSign).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
    if (!pick) return { ok: false, error: '签不起任何人' };
    const r = signPlayer(state, data, pick.id);
    if (!r.ok) return r;
  }
  if (!activeSponsor(state) && state.calendar.phase !== 'FINISHED') signSponsor(state, data, bestSponsorFor(data, state.club.reputation).id, 1);
  const lineup = recommendLineup(state, data);
  if (!lineup.ok) return lineup;
  return setLineup(state, data, lineup.value);
}

/** Training plan of the calibration manager: rest every third week. */
export function autoTraining(state: GameState): void {
  state.training = Math.floor(state.calendar.day / 7) % 3 === 2 ? 'REST' : 'MECHANICS';
}
