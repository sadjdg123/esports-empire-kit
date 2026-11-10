// Long-term milestones (P4, T41): first win, first title, a second division... Each pays a
// one-off reward when reached. Progress is read from the game state, so nothing can drift.

import type { GameData, GoalDef } from '../core/types';
import { STAFF_ROLES } from '../core/types';
import { openBranches } from './branches';
import { addLedger, playerOverall, rosterOf, weekOfSeason } from './game';
import { postMessage } from './messages';
import { hiredStaff } from './staff';
import { PLAYER_CLUB_ID, type GameState } from './state';

/** How far the player is on a goal, in the goal's own unit (wins, titles, reputation...). */
export function goalProgress(state: GameState, g: GoalDef): number {
  switch (g.kind) {
    case 'WINS': return state.counters.wins;
    case 'MOBA_PLAYOFFS': return state.history.filter((h) => h.playerPlayoff !== 'NONE').length;
    case 'MOBA_TITLES': return state.history.filter((h) => h.playerPlayoff === 'CHAMPION').length;
    case 'PROFIT_SEASONS': return state.counters.profitSeasons;
    case 'STAR_OVR': return Math.floor(Math.max(0, ...rosterOf(state).map(playerOverall)));
    case 'MVPS': return state.awards.filter((a) => a.clubId === PLAYER_CLUB_ID).length;
    case 'STAFF_HIRED': return STAFF_ROLES.filter((r) => hiredStaff(state, r)).length;
    case 'BRANCHES': return openBranches(state).length;
    case 'BRANCH_TITLES': return openBranches(state).reduce((a, b) => a + b.titles, 0);
    case 'TRIPLE': return state.counters.triples;
    case 'REPUTATION': return Math.floor(state.club.reputation);
    case 'HALL_OF_FAME': return state.hallOfFame.filter((h) => h.mainClub === state.club.name).length;
    default: return 0;
  }
}

export const goalReached = (state: GameState, g: GoalDef): boolean => !!state.goals[g.id];

/** Marks newly reached goals, pays their rewards and tells the player. Returns the new ones. */
export function checkGoals(state: GameState, data: GameData): GoalDef[] {
  const fresh: GoalDef[] = [];
  for (const g of data.goals) {
    if (state.goals[g.id] || goalProgress(state, g) < g.target) continue;
    state.goals[g.id] = { season: state.calendar.season, day: state.calendar.day };
    if (g.reward > 0) addLedger(state, { week: weekOfSeason(state), kind: 'PRIZE', amount: g.reward, note: `达成目标：${g.name}` });
    if (g.reputation > 0) state.club.reputation = Math.round(Math.min(100, state.club.reputation + g.reputation) * 10) / 10;
    postMessage(state, 'INFO', `达成目标：${g.name}`, `${g.description}。奖励 ${g.reward}${g.reputation > 0 ? `，声望 +${g.reputation}` : ''}。`, { goal: g.id });
    fresh.push(g);
  }
  return fresh;
}

/** End of a MOBA season: the running totals some goals count. Call once the season's history is written. */
export function countSeasonForGoals(state: GameState): void {
  const start = state.funds - state.ledger.reduce((a, e) => a + e.amount, 0);
  if (state.funds > start) state.counters.profitSeasons++;
  const season = state.calendar.season;
  const moba = state.history.at(-1)?.playerPlayoff === 'CHAMPION';
  const others = openBranches(state);
  if (moba && others.length === 2 && others.every((b) => b.history.some((h) => h.season === season && h.result === 'CHAMPION'))) state.counters.triples++;
}
