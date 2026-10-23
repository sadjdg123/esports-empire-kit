// Calendar and season flow (P1): days pass one by one; a season is a
// pre-season transfer window, a 10-round league and a top-4 playoff.
// Matches are settled in two steps so the render layer can play the
// player's match first: prepareMatchDay -> (watch) -> commitMatchDay.

import { createRng, hashString, rngFromState } from '../core/rng';
import { TACTICS, type AutoPauseEvent, type ClubId, type GameData, type MatchInput, type MatchResult, type Tactic } from '../core/types';
import { runMatch } from '../sim';
import { buildReport } from '../sim/report';
import { autoLineup } from '../sim/scenario';
import {
  buildSchedule, clubById, readinessIssues, rosterOf, seasonOver, standings, type Result,
} from './game';
import {
  PLAYER_CLUB_ID, type ClubState, type Fixture, type FixtureResult, type GameState, type InboxMessage,
  type LedgerEntry, type PlayoffMatch, type SeasonPhase, type StoredReport,
} from './state';
import { remindExpiring, rollContracts } from './contracts';
import { applyMatchFinance, applyPlayoffAwards, autoSponsor, financeSummary, rescueOptions, runPayDay } from './finance';
import { postMessage } from './messages';
import { applyDailyRecovery, applyMatchEffects, applyTrainingWeek } from './training';
import { expireOffers, generateAiOffers } from './transfers';

export { postMessage };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Season layout (pure functions of the configuration)

export interface SeasonLayout {
  regularStart: number; // first day of the regular season
  playoffStart: number; // first day of the playoffs
  roundDay: (round: number) => number; // league match day of a round
  semiDay: number; // -1 when there are no semi-finals
  finalDay: number;
}

export function seasonLayout(state: GameState, data: GameData): SeasonLayout {
  const cfg = data.season;
  const week = cfg.daysPerWeek;
  const regularStart = cfg.preseasonWeeks * week;
  const playoffStart = regularStart + state.totalRounds * week;
  const semiDay = cfg.playoffTeams === 4 ? playoffStart + cfg.matchWeekday : -1;
  const finalDay = cfg.playoffTeams === 4 ? playoffStart + week + cfg.matchWeekday : playoffStart + cfg.matchWeekday;
  return { regularStart, playoffStart, roundDay: (r) => regularStart + r * week + cfg.matchWeekday, semiDay, finalDay };
}

const PHASE_NAME: Record<SeasonPhase, string> = { PRESEASON: '休赛期', REGULAR: '常规赛', PLAYOFFS: '季后赛', FINISHED: '赛季结束' };
const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'];

/** e.g. "第 1 赛季 · 常规赛 · 第 4 周 周六". */
export function describeDate(state: GameState, data: GameData): string {
  const c = state.calendar;
  const week = Math.floor(c.day / data.season.daysPerWeek) + 1;
  const wd = WEEKDAY[c.day % data.season.daysPerWeek] ?? '';
  return `第 ${c.season} 赛季 · ${PHASE_NAME[c.phase]} · 第 ${week} 周 周${wd}`;
}

// ---------------------------------------------------------------------------
// Inbox

// ---------------------------------------------------------------------------
// Today's matches

function aiTactic(club: ClubState, fixtureSeed: number): Tactic {
  if (club.style !== 'RANDOM' && club.style !== 'PLAYER') return club.style;
  return createRng(fixtureSeed).fork(`tactic:${club.id}`).pick(TACTICS);
}

function teamFor(state: GameState, data: GameData, clubId: ClubId, fixtureSeed: number) {
  const club = clubById(state, clubId);
  const players = rosterOf(state, clubId).map((p) => structuredClone(p));
  const lineup = clubId === PLAYER_CLUB_ID ? structuredClone(state.lineup!) : autoLineup(data, clubId, players, aiTactic(club, fixtureSeed));
  return { lineup, players };
}

export function matchInputFor(state: GameState, data: GameData, fixture: { blue: ClubId; red: ClubId; seed: number }): MatchInput {
  return { seed: fixture.seed, blue: teamFor(state, data, fixture.blue, fixture.seed), red: teamFor(state, data, fixture.red, fixture.seed) };
}

/** A match to be played today: a league fixture or a playoff game. */
export interface TodayMatch {
  kind: 'LEAGUE' | 'SEMI' | 'FINAL';
  index: number;
  blue: ClubId;
  red: ClubId;
  seed: number;
}

export function todaysMatches(state: GameState, data: GameData): TodayMatch[] {
  const L = seasonLayout(state, data);
  const day = state.calendar.day;
  if (state.calendar.phase === 'REGULAR' && state.week < state.totalRounds && day === L.roundDay(state.week)) {
    return (state.schedule[state.week] ?? []).map((f) => ({ kind: 'LEAGUE', index: f.index, blue: f.blue, red: f.red, seed: f.seed }));
  }
  if (state.calendar.phase === 'PLAYOFFS') {
    return state.playoffs.filter((m) => m.day === day && m.winner === null).map((m) => ({ kind: m.stage, index: m.index, blue: m.blue, red: m.red, seed: m.seed }));
  }
  return [];
}

const involvesPlayer = (m: { blue: ClubId; red: ClubId }) => m.blue === PLAYER_CLUB_ID || m.red === PLAYER_CLUB_ID;

export function playerMatchToday(state: GameState, data: GameData): TodayMatch | null {
  return todaysMatches(state, data).find(involvesPlayer) ?? null;
}

/** The player's next fixture (today or later this season), for the home page. */
export function nextPlayerFixture(state: GameState, data: GameData): { opponent: ClubId; day: number; kind: TodayMatch['kind'] } | null {
  const L = seasonLayout(state, data);
  if (state.calendar.phase === 'PLAYOFFS' || state.week >= state.totalRounds) {
    const m = state.playoffs.find((x) => x.winner === null && involvesPlayer(x));
    return m ? { opponent: m.blue === PLAYER_CLUB_ID ? m.red : m.blue, day: m.day, kind: m.stage } : null;
  }
  const f = (state.schedule[state.week] ?? []).find(involvesPlayer);
  return f ? { opponent: f.blue === PLAYER_CLUB_ID ? f.red : f.blue, day: L.roundDay(state.week), kind: 'LEAGUE' } : null;
}

// ---------------------------------------------------------------------------
// Days

export interface DayResult {
  day: number;
  pause: AutoPauseEvent | null;
  messages: InboxMessage[];
}

function startPlayoffs(state: GameState, data: GameData): void {
  const L = seasonLayout(state, data);
  const table = standings(state);
  const seedOf = (tag: string) => hashString(`${state.seed}:s${state.calendar.season}:${tag}`);
  state.playoffs = [];
  if (data.season.playoffTeams === 4) {
    const [a, b, c, d] = table.slice(0, 4).map((r) => r.clubId) as [ClubId, ClubId, ClubId, ClubId];
    state.playoffs.push({ stage: 'SEMI', index: 0, blue: a, red: d, seed: seedOf('semi0'), winner: null, day: L.semiDay });
    state.playoffs.push({ stage: 'SEMI', index: 1, blue: b, red: c, seed: seedOf('semi1'), winner: null, day: L.semiDay });
  } else {
    const [a, b] = table.slice(0, 2).map((r) => r.clubId) as [ClubId, ClubId];
    state.playoffs.push({ stage: 'FINAL', index: 0, blue: a, red: b, seed: seedOf('final'), winner: null, day: L.finalDay });
  }
  const rank = table.findIndex((r) => r.clubId === PLAYER_CLUB_ID) + 1;
  const inIt = rank <= data.season.playoffTeams;
  postMessage(state, 'SEASON', '常规赛结束', inIt
    ? `你以第 ${rank} 名进入季后赛！对手：${state.playoffs.filter(involvesPlayer).map((m) => clubById(state, m.blue === PLAYER_CLUB_ID ? m.red : m.blue).name).join('')}。`
    : `你最终排名第 ${rank}，没有进入季后赛。季后赛会自动进行。`);
}

function finishSeason(state: GameState, data: GameData): void {
  state.calendar.phase = 'FINISHED';
  applyPlayoffAwards(state, data);
  const table = standings(state);
  const final = state.playoffs.find((m) => m.stage === 'FINAL');
  const champion = final?.winner ?? null;
  const rank = table.findIndex((r) => r.clubId === PLAYER_CLUB_ID) + 1;
  const reachedFinal = !!final && involvesPlayer(final);
  const reachedSemi = state.playoffs.some((m) => m.stage === 'SEMI' && involvesPlayer(m));
  state.history.push({
    season: state.calendar.season,
    table: table.map((r) => ({ clubId: r.clubId, name: r.name, wins: r.wins, losses: r.losses })),
    champion,
    playerRank: rank,
    playerPlayoff: champion === PLAYER_CLUB_ID ? 'CHAMPION' : reachedFinal ? 'FINAL' : reachedSemi ? 'SEMI' : 'NONE',
    fundsEnd: state.funds,
  });
  if (state.history.length > data.season.maxSeasonsHistory) state.history = state.history.slice(-data.season.maxSeasonsHistory);
  postMessage(state, 'SEASON', `第 ${state.calendar.season} 赛季结束`,
    `${champion ? `冠军：${clubById(state, champion).name}。` : ''}你的常规赛排名第 ${rank}${champion === PLAYER_CLUB_ID ? '，并拿下了总冠军！' : '。'}继续前进就会进入新赛季的休赛期。`);
}

/** Starts the next season: new schedule, clean table, everyone one year older. */
/** Returns true when the player has contracts ending in the new season (a reminder was posted). */
export function startNewSeason(state: GameState, data: GameData): boolean {
  const rng = rngFromState(state.rngState);
  state.calendar = { season: state.calendar.season + 1, phase: 'PRESEASON', day: 0 };
  state.schedule = buildSchedule([PLAYER_CLUB_ID, ...state.aiClubs.map((c) => c.id)], state.seed, rng, state.calendar.season);
  state.rngState = rng.state();
  state.totalRounds = state.schedule.length;
  state.week = 0;
  state.results = [];
  state.reports = [];
  state.playoffs = [];
  state.offers = state.offers.filter((o) => o.status === 'PENDING');
  for (const id of Object.keys(state.players).sort()) state.players[id]!.age++;
  postMessage(state, 'SEASON', `第 ${state.calendar.season} 赛季开始`, `休赛期 ${data.season.preseasonWeeks} 周，可以签人、买卖选手、调整阵容。常规赛 ${state.totalRounds} 轮之后是前 ${data.season.playoffTeams} 名的季后赛。`);
  return rollContracts(state, data);
}

/**
 * Moves the calendar forward by one day and settles that day's routine
 * (pay day, phase changes, AI-only matches). Stops in place, without moving,
 * while the player still has a match to play today.
 */
export function advanceDay(state: GameState, data: GameData): DayResult {
  const inboxBefore = state.inbox.length;
  const res = (pause: AutoPauseEvent | null): DayResult => ({ day: state.calendar.day, pause, messages: state.inbox.slice(inboxBefore) });
  if (playerMatchToday(state, data)) return res('MATCH_DAY');
  if (todaysMatches(state, data).length > 0) commitMatchDay(state, data); // AI-only day (e.g. eliminated from playoffs)
  if (seasonOver(state)) return res(startNewSeason(state, data) ? 'CONTRACT_EXPIRING' : null);

  const cfg = data.season;
  const L = seasonLayout(state, data);
  state.calendar.day++;
  const day = state.calendar.day;
  let pause: AutoPauseEvent | null = null;

  if (state.calendar.phase === 'PRESEASON' && day >= L.regularStart) {
    state.calendar.phase = 'REGULAR';
    expireOffers(state);
    autoSponsor(state, data);
    postMessage(state, 'SEASON', '常规赛开始', `本赛季 ${state.totalRounds} 轮，每周${WEEKDAY[cfg.matchWeekday]}比赛。`);
  }
  if (state.calendar.phase === 'REGULAR' && state.week >= state.totalRounds && day >= L.playoffStart) {
    state.calendar.phase = 'PLAYOFFS';
    startPlayoffs(state, data);
    if (remindExpiring(state)) pause = 'CONTRACT_EXPIRING';
  }
  applyDailyRecovery(state, data);
  if (day % cfg.daysPerWeek === cfg.payWeekday) {
    runPayDay(state, data); // before training: this week's training is paid for
    applyTrainingWeek(state, data);
    if (generateAiOffers(state, data).length > 0) pause ??= 'OFFER';
    const f = financeSummary(state, data);
    if (f.lowFunds && f.weeklySalaries > 0) {
      postMessage(state, 'FINANCE', '资金偏低', `现在资金 ${Math.round(state.funds)}，低于 ${data.economy.lowFundsWarningWeeks} 周工资。${rescueOptions(state, data).join('；')}。`);
      pause = 'LOW_FUNDS';
    }
  }
  if (playerMatchToday(state, data)) pause = 'MATCH_DAY';
  else if (todaysMatches(state, data).length > 0) commitMatchDay(state, data);
  if (seasonOver(state)) pause = 'SEASON_END';
  return res(pause);
}

/** Advances day by day until something needs the player (a match, a warning, the end of the season). */
export function advanceUntilPause(state: GameState, data: GameData, maxDays = 400): DayResult {
  let last: DayResult = { day: state.calendar.day, pause: null, messages: [] };
  const messages: InboxMessage[] = [];
  for (let i = 0; i < maxDays; i++) {
    last = advanceDay(state, data);
    messages.push(...last.messages);
    if (last.pause === 'MATCH_DAY' || last.pause === 'SEASON_END') break;
    if (last.pause && data.season.autoPause.includes(last.pause)) break;
  }
  return { ...last, messages };
}

/** Skips straight to the player's next match day (warnings do not stop it). */
export function advanceToNextMatch(state: GameState, data: GameData): DayResult {
  const messages: InboxMessage[] = [];
  let last: DayResult = { day: state.calendar.day, pause: null, messages: [] };
  for (let i = 0; i < 400; i++) {
    last = advanceDay(state, data);
    messages.push(...last.messages);
    if (last.pause === 'MATCH_DAY' || last.pause === 'SEASON_END') break;
  }
  return { ...last, messages };
}

// ---------------------------------------------------------------------------
// Settling a match day

export interface WeekSummary {
  round: number; // league round, or totalRounds + stage index for playoff games
  stage: 'LEAGUE' | 'SEMI' | 'FINAL';
  fundsBefore: number;
  fundsAfter: number;
  lines: LedgerEntry[];
  results: FixtureResult[];
  playerResult: FixtureResult | null;
  report: StoredReport | null;
  seasonOver: boolean;
}

function toFixtureResult(round: number, f: TodayMatch, input: MatchInput, r: MatchResult): FixtureResult {
  const blueIds = new Set(input.blue.lineup.picks.map((p) => p.playerId));
  const kills = { blue: 0, red: 0 };
  for (const p of r.players) {
    if (blueIds.has(p.playerId)) kills.blue += p.kills;
    else kills.red += p.kills;
  }
  return {
    round, index: f.index, blue: f.blue, red: f.red,
    winner: r.winner === 'BLUE' ? f.blue : f.red, winnerSide: r.winner,
    durationSec: r.durationSec, kills, blueTactic: input.blue.lineup.tactic, redTactic: input.red.lineup.tactic, checksum: r.checksum,
  };
}

/** The player's match today, for the render layer. Does not change state. */
export function prepareMatchDay(state: GameState, data: GameData): { playerMatch: MatchInput | null; fixture: TodayMatch | null; issues: string[] } {
  const fixture = playerMatchToday(state, data);
  if (!fixture) return { playerMatch: null, fixture: null, issues: ['今天没有你的比赛'] };
  const issues = readinessIssues(state, data);
  if (issues.length > 0) return { playerMatch: null, fixture, issues };
  return { playerMatch: matchInputFor(state, data, fixture), fixture, issues };
}

/**
 * Plays every match scheduled today. `playerMatchResult` is the result the
 * render layer produced from prepareMatchDay's input; without it the match is
 * simulated here with the same input, which gives the identical result.
 */
export function commitMatchDay(state: GameState, data: GameData, playerMatchResult?: MatchResult): Result<WeekSummary> {
  const today = todaysMatches(state, data);
  if (today.length === 0) return fail('今天没有比赛');
  if (today.some(involvesPlayer)) {
    const issues = readinessIssues(state, data);
    if (issues.length > 0) return fail(issues.join('；'));
  }
  const stage = today[0]!.kind;
  const round = stage === 'LEAGUE' ? state.week : state.totalRounds + (stage === 'SEMI' ? 0 : 1);
  const fundsBefore = state.funds;
  const ledgerStart = state.ledger.length;
  const results: FixtureResult[] = [];
  let playerResult: FixtureResult | null = null;
  let report: StoredReport | null = null;
  const names = Object.fromEntries([state.club, ...state.aiClubs].map((c) => [c.id, c.name]));

  for (const f of today) {
    const input = matchInputFor(state, data, f);
    const isPlayer = involvesPlayer(f);
    const r = isPlayer && playerMatchResult ? playerMatchResult : runMatch(input, data);
    const fr = toFixtureResult(round, f, input, r);
    results.push(fr);
    applyMatchEffects(state, data, input, r);
    if (stage !== 'LEAGUE') {
      const pm = state.playoffs.find((m) => m.stage === stage && m.index === f.index)!;
      pm.winner = fr.winner;
    }
    if (!isPlayer) continue;
    playerResult = fr;
    const won = fr.winner === PLAYER_CLUB_ID;
    const mySide = f.blue === PLAYER_CLUB_ID ? 'BLUE' : 'RED';
    const label = stage === 'LEAGUE' ? '比赛' : stage === 'SEMI' ? '季后赛半决赛' : '总决赛';
    const rep = buildReport(r, input, data, names);
    report = {
      round, stage, season: state.calendar.season, opponent: mySide === 'BLUE' ? f.red : f.blue, won,
      headline: rep.headline, keyReasons: rep.keyReasons, mvp: rep.mvp, ratings: rep.ratings, durationSec: r.durationSec,
      kills: mySide === 'BLUE' ? { mine: fr.kills.blue, theirs: fr.kills.red } : { mine: fr.kills.red, theirs: fr.kills.blue },
      goldDiffTimeline: r.goldDiffTimeline.map((p) => ({ t: p.t, diff: mySide === 'BLUE' ? p.diff : (0 - p.diff) || 0 })), // avoid -0, which JSON cannot keep
    };
    state.reports.push(report);
    postMessage(state, 'MATCH', `${label}${won ? '胜利' : '失利'}：对阵 ${clubById(state, report.opponent).name}`, rep.headline, { round });
  }

  if (stage === 'LEAGUE') state.results.push(...results);
  for (const fr of results) applyMatchFinance(state, data, fr, stage);
  if (stage === 'LEAGUE') {
    state.week++;
  } else if (stage === 'SEMI') {
    const [s0, s1] = [state.playoffs.find((m) => m.stage === 'SEMI' && m.index === 0)!, state.playoffs.find((m) => m.stage === 'SEMI' && m.index === 1)!];
    if (s0.winner && s1.winner) {
      const L = seasonLayout(state, data);
      state.playoffs.push({ stage: 'FINAL', index: 0, blue: s0.winner, red: s1.winner, seed: hashString(`${state.seed}:s${state.calendar.season}:final`), winner: null, day: L.finalDay });
    }
  } else {
    finishSeason(state, data);
  }
  return ok({
    round, stage, fundsBefore, fundsAfter: state.funds, lines: state.ledger.slice(ledgerStart),
    results, playerResult, report, seasonOver: seasonOver(state),
  });
}

// ---------------------------------------------------------------------------
// P0-style helpers kept for the UI and tests

/** The player's match if today is a match day. */
export function prepareWeek(state: GameState, data: GameData) {
  return prepareMatchDay(state, data);
}

export function commitWeek(state: GameState, data: GameData, playerMatchResult?: MatchResult): Result<WeekSummary> {
  return commitMatchDay(state, data, playerMatchResult);
}

/** Skip to the player's next match and play it (no rendering). Fails once the player has no more matches this season. */
export function advanceWeek(state: GameState, data: GameData): Result<WeekSummary> {
  if (seasonOver(state)) return fail('赛季已经结束');
  if (!playerMatchToday(state, data)) {
    const issues = readinessIssues(state, data);
    if (issues.length > 0 && state.calendar.phase !== 'PLAYOFFS') return fail(issues.join('；'));
    advanceToNextMatch(state, data);
  }
  if (!playerMatchToday(state, data)) return fail('赛季已经结束');
  return commitMatchDay(state, data);
}

/** Current league fixtures (for compatibility with P0 pages). */
export function currentFixtures(state: GameState): Fixture[] {
  return state.schedule[state.week] ?? [];
}

export type { PlayoffMatch };
