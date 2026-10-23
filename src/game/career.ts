// Careers (P2, T23): players retire. A few weeks before the season ends, everyone old
// enough is checked once. Free agents who stop leave at once; players on a club finish
// the season (the player's own get a message) and leave when the new season starts.
// Growth by growth type is in training.ts (ageRateOf).

import { rngFromState } from '../core/rng';
import type { GameData, Player } from '../core/types';
import { seasonWeeks } from './contracts';
import { playerOverall, weekOfSeason } from './game';
import { postMessage } from './messages';
import { clubById } from './game';
import { PLAYER_CLUB_ID, type GameState, type HallOfFameEntry } from './state';

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
      remember(state, data, p);
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
export function retirePlayers(state: GameState, data: GameData): Player[] {
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
    remember(state, data, p);
    p.retired = true;
    p.retiring = false;
    p.clubId = null;
    delete state.players[p.id];
  }
  return gone;
}

// ---------------------------------------------------------------------------
// Season MVP and hall of fame (T27)

/** Picks the season's MVP among players who played enough this season (call after the careers are recorded). */
export function awardSeasonMvp(state: GameState, data: GameData): Player | null {
  const a = data.season.awards;
  const season = state.calendar.season;
  let best: { p: Player; score: number; clubId: string } | null = null;
  for (const club of [state.club, ...state.aiClubs]) {
    for (const id of [...club.roster].sort()) {
      const p = state.players[id]!;
      const c = p.career?.at(-1);
      if (!c || c.season !== season || c.played < a.mvpMinPlayed) continue;
      const score = c.ovr + (c.wins / c.played) * a.mvpWinRateWeight + (c.champion ? a.mvpChampionBonus : 0);
      if (!best || score > best.score || (score === best.score && p.id < best.p.id)) best = { p, score, clubId: club.id };
    }
  }
  if (!best) return null;
  const club = clubById(state, best.clubId);
  state.awards.push({ season, mvpId: best.p.id, mvpName: best.p.name, clubId: club.id, clubName: club.name });
  postMessage(state, 'SEASON', `第 ${season} 赛季 MVP：${best.p.name}`, `${club.name}的 ${best.p.name}（能力 ${Math.round(playerOverall(best.p))}）当选本赛季最有价值选手${best.clubId === PLAYER_CLUB_ID ? '，是你的选手！' : '。'}`, { playerId: best.p.id });
  return best.p;
}

/** Whether a retiring player's career earns a place in the hall of fame, and the entry if so. */
export function hallOfFameEntry(state: GameState, data: GameData, p: Player): HallOfFameEntry | null {
  const r = data.season.awards.hallOfFame;
  const career = p.career ?? [];
  // Titles count only from seasons the player was a regular, not from the bench of a champion.
  const regulars = career.filter((c) => c.played >= r.regularMinPlayed);
  const titles = regulars.filter((c) => c.champion).length;
  const mvps = state.awards.filter((w) => w.mvpId === p.id).length;
  const regular = regulars.length;
  if (titles < r.titles && mvps < r.mvps && regular < r.regularSeasons) return null;
  const byClub = new Map<string, number>();
  for (const c of career) byClub.set(c.clubName, (byClub.get(c.clubName) ?? 0) + 1);
  const mainClub = [...byClub].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? '';
  return {
    // Old free agents leave once the next season has begun: their last season is the one before.
    playerId: p.id, name: p.name, retiredSeason: state.calendar.phase === 'PRESEASON' ? state.calendar.season - 1 : state.calendar.season, seasons: career.length, titles, mvps,
    played: p.stats?.played ?? 0, peakOvr: Math.round(careerPeak(p)), mainClub,
  };
}

/** Called for every player who stops: the great ones go into the hall of fame. */
export function remember(state: GameState, data: GameData, p: Player): void {
  const e = hallOfFameEntry(state, data, p);
  if (!e || state.hallOfFame.some((h) => h.playerId === p.id)) return;
  state.hallOfFame.push(e);
  const why = [e.titles ? `${e.titles} 个冠军` : '', e.mvps ? `${e.mvps} 次 MVP` : '', `${e.seasons} 个赛季`].filter(Boolean).join('、');
  postMessage(state, 'SEASON', `${p.name} 入选名人堂`, `${p.name}（主要效力${e.mainClub || '—'}）退役，职业生涯 ${why}，巅峰能力 ${e.peakOvr}。可以在"历史"里看到。`);
}
