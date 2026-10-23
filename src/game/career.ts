// Careers (P2, T23): players retire. A few weeks before the season ends, everyone old
// enough is checked once. Free agents who stop leave at once; players on a club finish
// the season (the player's own get a message) and leave when the new season starts.
// Growth by growth type is in training.ts (ageRateOf).

import { rngFromState } from '../core/rng';
import type { GameData, Player } from '../core/types';
import { seasonWeeks } from './contracts';
import { playerOverall, weekOfSeason } from './game';
import { postMessage } from './messages';
import { PLAYER_CLUB_ID, type GameState } from './state';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const NEWS_NAMES = 5;

/** Highest overall a player had at the end of any season (or now). */
export function careerPeak(p: Player): number {
  return Math.max(playerOverall(p), ...(p.career ?? []).map((c) => c.ovr));
}

/** Chance that a player stops after this season: rises with age, more when clearly past the peak. */
export function retirementChance(data: GameData, p: Player): number {
  const r = data.growth.retirement;
  if (p.age >= r.alwaysAt) return 1;
  if (p.age < r.fromAge) return 0;
  let c = r.chance[Math.min(r.chance.length - 1, p.age - r.fromAge)]!;
  if (careerPeak(p) - playerOverall(p) >= r.declinePoints) c += r.declineBonus;
  c += r.typeBonus[p.growthType ?? 'NORMAL'];
  return clamp01(c);
}

/** True on the pay day when this season's retirements are decided. */
export function retirementNoticeDue(state: GameState, data: GameData): boolean {
  return state.calendar.phase !== 'PRESEASON' && weekOfSeason(state) === seasonWeeks(state, data) - data.growth.retirement.noticeWeeks;
}

/** Decides who stops after this season. Returns the players on clubs who will leave when it ends. */
export function announceRetirements(state: GameState, data: GameData): Player[] {
  const rng = rngFromState(state.rngState);
  const leaving: Player[] = [];
  const freeAgents = new Set(state.market);
  for (const id of Object.keys(state.players).sort()) {
    const p = state.players[id]!;
    if (p.retired || p.retiring) continue;
    const c = retirementChance(data, p);
    if (c <= 0 || !rng.chance(c)) continue;
    if (freeAgents.has(id)) {
      delete state.players[id]; // nobody is waiting for an unsigned player
      continue;
    }
    p.retiring = true;
    leaving.push(p);
  }
  state.rngState = rng.state();
  state.market = state.market.filter((id) => state.players[id]);
  for (const p of leaving.filter((x) => x.clubId === PLAYER_CLUB_ID)) {
    const st = p.stats ?? { played: 0, wins: 0 };
    const titles = (p.career ?? []).filter((c) => c.champion).length;
    postMessage(state, 'CONTRACT', `${p.name} 将在本赛季结束后退役`,
      `${p.name}（${p.age} 岁）决定打完这个赛季就退役。职业生涯 ${st.played} 场、${st.wins} 胜${titles ? `、${titles} 个冠军` : ''}。休赛期记得补人。`, { playerId: p.id });
  }
  return leaving;
}

/** At the start of a new season (before anyone ages): players who announced it leave the game. */
export function retirePlayers(state: GameState): Player[] {
  const gone = Object.values(state.players).filter((p) => p.retiring).sort((a, b) => careerPeak(b) - careerPeak(a) || a.id.localeCompare(b.id));
  if (gone.length === 0) return [];
  const ids = new Set(gone.map((p) => p.id));
  for (const club of [state.club, ...state.aiClubs]) club.roster = club.roster.filter((id) => !ids.has(id));
  state.market = state.market.filter((id) => !ids.has(id));
  if (state.lineup?.picks.some((pk) => ids.has(pk.playerId))) {
    state.lineup = null;
    postMessage(state, 'INFO', '阵容需要重排', '有首发选手退役了，新赛季开打前到白板（阵容）重新排一下。');
  }
  state.negotiations = state.negotiations.filter((n) => !ids.has(n.playerId));
  state.offers = state.offers.filter((o) => !ids.has(o.playerId));
  for (const key of Object.keys(state.chemistry)) if (key.split('|').some((id) => ids.has(id))) delete state.chemistry[key];
  const names = gone.slice(0, NEWS_NAMES).map((p) => `${p.name}（${p.age} 岁，巅峰 ${Math.round(careerPeak(p))}）`);
  postMessage(state, 'SEASON', `${gone.length} 名选手退役`, `${names.join('、')}${gone.length > NEWS_NAMES ? ` 等 ${gone.length} 人` : ''}告别了赛场。`);
  for (const p of gone) {
    p.retired = true;
    p.retiring = false;
    p.clubId = null;
    delete state.players[p.id];
  }
  return gone;
}
