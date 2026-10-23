// Simple automatic management used for economy calibration and tests:
// sign the best-value player of each role, then use the recommended lineup.

import type { FacilityId, GameData, Player, Role } from '../core/types';
import { ROLES } from '../core/types';
import { acceptRenewal, expiringPlayers, negotiationFor, renewalAsk } from './contracts';
import { facilityValue, nextFacilityLevel, sponsorStanding, upgradeFacility } from './facilities';
import { activeSponsor, bestSponsorFor, expectedWeeklyIncome, signSponsor } from './finance';
import { emergencySalaryCap, marketPlayers, playerOverall, recommendLineup, rosterOf, setLineup, signPlayer, type Result } from './game';
import { PLAYER_CLUB_ID, type GameState } from './state';

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
  if (!activeSponsor(state) && state.calendar.phase !== 'FINISHED') signSponsor(state, data, bestSponsorFor(data, sponsorStanding(state, data)).id, 1);
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
  return expectedWeeklyIncome(state, data) / data.economy.minRoster;
}

export function autoManage(state: GameState, data: GameData, style: ManageStyle = 'value'): Result {
  const cap = style === 'balanced' ? balancedSalaryCap(state, data) : Infinity;
  const score = style === 'value' ? valueScore : (p: Player) => (p.salaryPerWeek <= cap ? playerOverall(p) : playerOverall(p) - 1000);
  const canSign = (p: Player) => p.signingFee <= state.funds || (state.club.roster.length < data.economy.minRoster && p.salaryPerWeek <= emergencySalaryCap(state, data));
  if (state.calendar.phase !== 'FINISHED') {
    for (const p of expiringPlayers(state)) {
      if (negotiationFor(state, p.id)) continue;
      if (renewalAsk(data, p, facilityValue(state, data, PLAYER_CLUB_ID, 'OFFICE')) * 4 <= state.funds) acceptRenewal(state, data, p.id, data.economy.contracts.defaultYears);
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
  if (!activeSponsor(state) && state.calendar.phase !== 'FINISHED') signSponsor(state, data, bestSponsorFor(data, sponsorStanding(state, data)).id, 1);
  if (style !== 'value' && state.calendar.phase === 'PRESEASON') autoFacilities(state, data);
  const lineup = recommendLineup(state, data);
  if (!lineup.ok) return lineup;
  return setLineup(state, data, lineup.value);
}

/** Room order of the automatic manager: what helps on the pitch first, then money. */
const AUTO_FACILITIES: FacilityId[] = ['TRAINING', 'LOUNGE', 'ANALYSIS', 'STREAM', 'OFFICE'];
/** Weeks of wages the automatic manager keeps in hand before spending on rooms. */
const AUTO_RESERVE_WEEKS = 12;

/** In the pre-season, spend half of the money beyond a wage reserve on room upgrades, in AUTO_FACILITIES order. */
export function autoFacilities(state: GameState, data: GameData): void {
  const wages = rosterOf(state).reduce((a, p) => a + p.salaryPerWeek, 0);
  let budget = Math.max(0, state.funds - wages * AUTO_RESERVE_WEEKS) * 0.5;
  for (const id of AUTO_FACILITIES) {
    const next = nextFacilityLevel(data, state.club, id);
    if (!next || next.cost > budget) continue;
    if (upgradeFacility(state, data, id).ok) budget -= next.cost;
  }
}

/** Training plan of the calibration manager: rest every third week. */
export function autoTraining(state: GameState): void {
  state.training = Math.floor(state.calendar.day / 7) % 3 === 2 ? 'REST' : 'MECHANICS';
}
