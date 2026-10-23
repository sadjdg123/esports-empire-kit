// Chemistry (P2, T25): how well two players play together, 0-100. It grows when they start
// a match together and in weeks their club trains teamwork, and fades once they are on
// different clubs. The starting five's average makes a small difference in matches
// (match.json coefficients.chemistry, applied in src/sim/units.ts).

import type { GameData, MatchInput, PlayerId, TrainingFocus } from '../core/types';
import { pairKey, type ClubState, type GameState } from './state';

const MAX = 100;

export function chemistryOf(state: GameState, a: PlayerId, b: PlayerId): number {
  return a === b ? MAX : state.chemistry[pairKey(a, b)] ?? 0;
}

/** Average chemistry over every pair of the given players (0 for fewer than two). */
export function groupChemistry(state: GameState, ids: readonly PlayerId[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { sum += chemistryOf(state, ids[i]!, ids[j]!); n++; }
  return n ? sum / n : 0;
}

/** A player's average chemistry with the rest of a group. */
export function chemistryWith(state: GameState, id: PlayerId, others: readonly PlayerId[]): number {
  const rest = others.filter((o) => o !== id);
  return rest.length ? rest.reduce((a, o) => a + chemistryOf(state, id, o), 0) / rest.length : 0;
}

function addPairs(state: GameState, ids: readonly PlayerId[], amount: number): void {
  if (amount <= 0) return;
  const sorted = [...ids].sort();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const k = pairKey(sorted[i]!, sorted[j]!);
      state.chemistry[k] = Math.min(MAX, (state.chemistry[k] ?? 0) + amount);
    }
  }
}

/** After a match: the starters of each side know each other a little better. */
export function chemistryFromMatch(state: GameState, data: GameData, input: MatchInput): void {
  for (const team of [input.blue, input.red]) addPairs(state, team.lineup.picks.map((pk) => pk.playerId).filter((id) => state.players[id]), data.growth.chemistry.perMatch);
}

/** Weekly training: a club that trained teamwork grows chemistry between all its players. */
export function chemistryFromTraining(state: GameState, data: GameData, club: ClubState, focus: TrainingFocus): void {
  if (focus === 'TEAMWORK') addPairs(state, club.roster, data.growth.chemistry.perTeamworkWeek);
}

/** New season: pairs no longer on the same club drift apart; forgotten pairs are dropped. */
export function chemistryNewSeason(state: GameState, data: GameData): void {
  const clubOf = new Map<PlayerId, string>();
  for (const club of [state.club, ...state.aiClubs]) for (const id of club.roster) clubOf.set(id, club.id);
  for (const key of Object.keys(state.chemistry).sort()) {
    const [a, b] = key.split('|') as [string, string];
    if (clubOf.get(a) !== undefined && clubOf.get(a) === clubOf.get(b)) continue;
    const v = state.chemistry[key]! - data.growth.chemistry.decayApart;
    if (v > 0) state.chemistry[key] = v;
    else delete state.chemistry[key];
  }
}
