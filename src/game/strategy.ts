// Simple automatic management used for economy calibration and tests:
// sign the best-value player of each role, then use the recommended lineup.

import type { GameData, Player, Role } from '../core/types';
import { ROLES } from '../core/types';
import { acceptRenewal, expiringPlayers, negotiationFor, renewalAsk } from './contracts';
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
  const lineup = recommendLineup(state, data);
  if (!lineup.ok) return lineup;
  return setLineup(state, data, lineup.value);
}

/**
 * Keeps the player's club playable season after season: renews expiring
 * contracts it can afford, fills missing roles with value signings and sets
 * the recommended lineup.
 */
export function autoManage(state: GameState, data: GameData): Result {
  if (state.calendar.phase !== 'FINISHED') {
    for (const p of expiringPlayers(state)) {
      if (negotiationFor(state, p.id)) continue;
      if (renewalAsk(data, p) * 4 <= state.funds) acceptRenewal(state, data, p.id, data.economy.contracts.defaultYears);
    }
  }
  const has = (role: Role) => rosterOf(state).some((p) => p.primaryRole === role);
  for (const role of ROLES as readonly Role[]) {
    if (has(role) || state.club.roster.length >= data.economy.maxRoster) continue;
    const pick = marketPlayers(state).filter((p) => p.primaryRole === role && p.signingFee <= state.funds).sort((a, b) => valueScore(b) - valueScore(a) || a.id.localeCompare(b.id))[0];
    if (pick) signPlayer(state, data, pick.id);
  }
  while (state.club.roster.length < data.economy.minRoster) {
    const pick = marketPlayers(state).filter((p) => p.signingFee <= state.funds).sort((a, b) => valueScore(b) - valueScore(a) || a.id.localeCompare(b.id))[0];
    if (!pick) return { ok: false, error: '签不起任何人' };
    const r = signPlayer(state, data, pick.id);
    if (!r.ok) return r;
  }
  const lineup = recommendLineup(state, data);
  if (!lineup.ok) return lineup;
  return setLineup(state, data, lineup.value);
}
