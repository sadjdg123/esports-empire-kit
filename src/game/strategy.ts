// Simple automatic management used for economy calibration and tests:
// sign the best-value player of each role, then use the recommended lineup.

import type { GameData, Player, Role } from '../core/types';
import { ROLES } from '../core/types';
import { marketPlayers, playerOverall, recommendLineup, setLineup, signPlayer, type Result } from './game';
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
