// P0 management loop: new game, market, lineup, schedule, weekly settlement.
// Functions that change the game mutate the given state; callers that need
// the previous state (e.g. React) should structuredClone it first.

import { validateLineup } from '../core/config';
import { createRng, hashString, rngFromState, type Rng } from '../core/rng';
import { TACTICS, type ClubId, type GameData, type MatchInput, type MatchResult, type Player, type PlayerId, type Tactic, type TeamLineup } from '../core/types';
import { runMatch } from '../sim';
import { buildReport } from '../sim/report';
import { autoLineup } from '../sim/scenario';
import { PLAYER_CLUB_ID, type ClubState, type Fixture, type FixtureResult, type GameState, type LedgerEntry, type StoredReport } from './state';

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

function overall(p: Player): number {
  return (p.attrs.mechanics + p.attrs.awareness + p.attrs.teamwork + p.attrs.mental) / 4;
}

// ---------------------------------------------------------------------------
// New game

/** Circle-method double round robin: n teams, 2 * (n - 1) rounds; second half swaps sides. */
function buildSchedule(clubIds: ClubId[], seed: number, rng: Rng): Fixture[][] {
  const teams = [...clubIds];
  for (let i = teams.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [teams[i], teams[j]] = [teams[j]!, teams[i]!];
  }
  const n = teams.length;
  const half: [ClubId, ClubId][][] = [];
  const rot = [...teams];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [ClubId, ClubId][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = rot[i]!;
      const b = rot[n - 1 - i]!;
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    half.push(pairs);
    rot.splice(1, 0, rot.pop()!);
  }
  const rounds = [...half, ...half.map((pairs) => pairs.map(([a, b]) => [b, a] as [ClubId, ClubId]))];
  return rounds.map((pairs, round) => pairs.map(([blue, red], index) => ({
    round, index, blue, red, seed: hashString(`${seed}:${round}:${index}`),
  })));
}

export function newGame(name: string, color: string, seed: number, data: GameData): GameState {
  const rng = createRng(seed);
  const players: Record<PlayerId, Player> = {};
  for (const p of data.players) players[p.id] = structuredClone(p);
  const aiClubs: ClubState[] = data.clubs.map((c) => {
    for (const p of c.players) players[p.id] = structuredClone(p);
    return { id: c.id, name: c.name, shortName: c.shortName, color: c.color, style: c.style, roster: c.players.map((p) => p.id) };
  });
  const club: ClubState = { id: PLAYER_CLUB_ID, name: name.trim() || '我的俱乐部', shortName: (name.trim() || '我的').slice(0, 2), color, style: 'PLAYER', roster: [] };
  const schedule = buildSchedule([PLAYER_CLUB_ID, ...aiClubs.map((c) => c.id)], seed, rng);
  return {
    seed,
    week: 0,
    totalRounds: schedule.length,
    startingFunds: data.economy.startingFunds,
    funds: data.economy.startingFunds,
    club,
    lineup: null,
    aiClubs,
    players,
    market: data.players.map((p) => p.id),
    schedule,
    results: [],
    ledger: [],
    reports: [],
    rngState: rng.state(),
  };
}

export function seasonOver(state: GameState): boolean {
  return state.week >= state.totalRounds;
}

export function clubById(state: GameState, id: ClubId): ClubState {
  if (id === PLAYER_CLUB_ID) return state.club;
  const c = state.aiClubs.find((x) => x.id === id);
  if (!c) throw new Error(`unknown club ${id}`);
  return c;
}

export function rosterOf(state: GameState, id: ClubId = PLAYER_CLUB_ID): Player[] {
  return clubById(state, id).roster.map((pid) => state.players[pid]!);
}

function addLedger(state: GameState, entry: LedgerEntry): void {
  state.ledger.push(entry);
  state.funds += entry.amount;
}

// ---------------------------------------------------------------------------
// Market

export function marketPlayers(state: GameState): Player[] {
  return state.market.map((id) => state.players[id]!);
}

export function weeklySalaries(state: GameState): number {
  return rosterOf(state).reduce((a, p) => a + p.salaryPerWeek, 0);
}

export function releaseFee(data: GameData, p: Player): number {
  return p.salaryPerWeek * data.economy.releaseFeeWeeks;
}

export function signPlayer(state: GameState, data: GameData, playerId: PlayerId): Result {
  const p = state.players[playerId];
  if (!p || !state.market.includes(playerId)) return fail('这名选手不在自由市场');
  if (state.club.roster.length >= data.economy.maxRoster) return fail(`队伍已满（最多 ${data.economy.maxRoster} 人）`);
  if (state.funds < 0) return fail('资金为负，暂时不能签人');
  if (state.funds < p.signingFee) return fail(`资金不足：签约费 ${p.signingFee}，当前资金 ${Math.round(state.funds)}`);
  state.market = state.market.filter((id) => id !== playerId);
  state.club.roster.push(playerId);
  p.clubId = PLAYER_CLUB_ID;
  addLedger(state, { week: state.week - (state.week === 0 ? 1 : 0), kind: 'SIGNING', amount: -p.signingFee, note: `签下 ${p.name}` });
  return ok(undefined);
}

export function releasePlayer(state: GameState, data: GameData, playerId: PlayerId): Result {
  const p = state.players[playerId];
  if (!p || !state.club.roster.includes(playerId)) return fail('这名选手不在你的队伍里');
  if (state.week > 0 && state.club.roster.length <= data.economy.minRoster) return fail(`赛季中队伍至少要有 ${data.economy.minRoster} 人`);
  const fee = releaseFee(data, p);
  if (state.funds < fee) return fail(`资金不足：违约金 ${fee}，当前资金 ${Math.round(state.funds)}`);
  state.club.roster = state.club.roster.filter((id) => id !== playerId);
  state.market.push(playerId);
  p.clubId = null;
  if (state.lineup?.picks.some((pk) => pk.playerId === playerId)) state.lineup = null;
  addLedger(state, { week: state.week - (state.week === 0 ? 1 : 0), kind: 'RELEASE', amount: -fee, note: `与 ${p.name} 解约` });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Lineup

export function setLineup(state: GameState, data: GameData, lineup: TeamLineup): Result {
  const issues = validateLineup({ ...lineup, clubId: PLAYER_CLUB_ID }, rosterOf(state), data);
  if (issues.length > 0) return fail(issues.join('；'));
  state.lineup = structuredClone({ ...lineup, clubId: PLAYER_CLUB_ID });
  return ok(undefined);
}

/** Best player per role and their best hero. */
export function recommendLineup(state: GameState, data: GameData, tactic: Tactic = state.lineup?.tactic ?? 'STEADY_MACRO'): Result<TeamLineup> {
  const roster = rosterOf(state);
  if (roster.length < 5) return fail(`至少需要 5 名选手才能布阵（现在 ${roster.length} 人）`);
  return ok(autoLineup(data, PLAYER_CLUB_ID, roster, tactic));
}

/** Reasons the player cannot play the next match (empty = ready). */
export function readinessIssues(state: GameState, data: GameData): string[] {
  if (seasonOver(state)) return ['赛季已经结束'];
  const roster = rosterOf(state);
  if (roster.length < data.economy.minRoster) return [`至少需要 ${data.economy.minRoster} 名选手（现在 ${roster.length} 人）`];
  if (!state.lineup) return ['还没有设置首发阵容'];
  return validateLineup(state.lineup, roster, data);
}

// ---------------------------------------------------------------------------
// Matches

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

export function matchInputFor(state: GameState, data: GameData, fixture: Fixture): MatchInput {
  return { seed: fixture.seed, blue: teamFor(state, data, fixture.blue, fixture.seed), red: teamFor(state, data, fixture.red, fixture.seed) };
}

export function currentFixtures(state: GameState): Fixture[] {
  return state.schedule[state.week] ?? [];
}

export function playerFixture(state: GameState): Fixture | null {
  return currentFixtures(state).find((f) => f.blue === PLAYER_CLUB_ID || f.red === PLAYER_CLUB_ID) ?? null;
}

/** The player's match this week, for the render layer to play before settlement. Does not change state. */
export function prepareWeek(state: GameState, data: GameData): { playerMatch: MatchInput | null; fixture: Fixture | null; issues: string[] } {
  const issues = readinessIssues(state, data);
  const fixture = playerFixture(state);
  if (issues.length > 0 || !fixture) return { playerMatch: null, fixture, issues };
  return { playerMatch: matchInputFor(state, data, fixture), fixture, issues };
}

export interface WeekSummary {
  round: number;
  fundsBefore: number;
  fundsAfter: number;
  lines: LedgerEntry[];
  results: FixtureResult[];
  playerResult: FixtureResult | null;
  report: StoredReport | null;
  seasonOver: boolean;
}

function toFixtureResult(f: Fixture, input: MatchInput, r: MatchResult): FixtureResult {
  const blueIds = new Set(input.blue.lineup.picks.map((p) => p.playerId));
  const kills = { blue: 0, red: 0 };
  for (const p of r.players) {
    if (blueIds.has(p.playerId)) kills.blue += p.kills;
    else kills.red += p.kills;
  }
  return {
    round: f.round, index: f.index, blue: f.blue, red: f.red,
    winner: r.winner === 'BLUE' ? f.blue : f.red, winnerSide: r.winner,
    durationSec: r.durationSec, kills, blueTactic: input.blue.lineup.tactic, redTactic: input.red.lineup.tactic, checksum: r.checksum,
  };
}

/**
 * Settles the week: salaries and sponsor, every match of the round, prizes,
 * standings and form. `playerMatchResult` is the result the render layer
 * produced from prepareWeek's input; if omitted the match is simulated here
 * with the same input, which gives the identical result.
 */
export function commitWeek(state: GameState, data: GameData, playerMatchResult?: MatchResult): Result<WeekSummary> {
  const issues = readinessIssues(state, data);
  if (issues.length > 0) return fail(issues.join('；'));
  const eco = data.economy;
  const round = state.week;
  const fundsBefore = state.funds;
  const ledgerStart = state.ledger.length;

  addLedger(state, { week: round, kind: 'SALARY', amount: -weeklySalaries(state), note: '选手周薪' });
  addLedger(state, { week: round, kind: 'SPONSOR', amount: eco.weeklySponsor, note: '基础赞助' });

  const results: FixtureResult[] = [];
  let playerResult: FixtureResult | null = null;
  let report: StoredReport | null = null;
  for (const f of currentFixtures(state)) {
    const input = matchInputFor(state, data, f);
    const isPlayer = f.blue === PLAYER_CLUB_ID || f.red === PLAYER_CLUB_ID;
    const r = isPlayer && playerMatchResult ? playerMatchResult : runMatch(input, data);
    const fr = toFixtureResult(f, input, r);
    results.push(fr);
    if (!isPlayer) continue;
    playerResult = fr;
    const won = fr.winner === PLAYER_CLUB_ID;
    const mySide = f.blue === PLAYER_CLUB_ID ? 'BLUE' : 'RED';
    addLedger(state, { week: round, kind: 'PRIZE', amount: won ? eco.prizeWin : eco.prizeLoss, note: won ? '比赛胜利奖金' : '比赛出场奖金' });
    const names = Object.fromEntries([state.club, ...state.aiClubs].map((c) => [c.id, c.name]));
    const rep = buildReport(r, input, data, names);
    report = {
      round, opponent: mySide === 'BLUE' ? f.red : f.blue, won,
      headline: rep.headline, keyReasons: rep.keyReasons, mvp: rep.mvp, ratings: rep.ratings, durationSec: r.durationSec,
      kills: mySide === 'BLUE' ? { mine: fr.kills.blue, theirs: fr.kills.red } : { mine: fr.kills.red, theirs: fr.kills.blue },
      goldDiffTimeline: r.goldDiffTimeline.map((p) => ({ t: p.t, diff: mySide === 'BLUE' ? p.diff : (0 - p.diff) || 0 })), // avoid -0, which JSON cannot keep
    };
    state.reports.push(report);
  }
  state.results.push(...results);

  // Weekly form drift for every player (stable id order).
  const rng = rngFromState(state.rngState);
  for (const id of Object.keys(state.players).sort()) {
    const p = state.players[id]!;
    p.form = Math.max(-10, Math.min(10, p.form + rng.int(-eco.formWeeklyDelta, eco.formWeeklyDelta)));
  }
  state.rngState = rng.state();
  state.week++;
  return ok({
    round, fundsBefore, fundsAfter: state.funds, lines: state.ledger.slice(ledgerStart),
    results, playerResult, report, seasonOver: seasonOver(state),
  });
}

/** prepareWeek + commitWeek in one go (no rendering). */
export function advanceWeek(state: GameState, data: GameData): Result<WeekSummary> {
  return commitWeek(state, data);
}

// ---------------------------------------------------------------------------
// Standings and finance

export interface StandingRow {
  clubId: ClubId;
  name: string;
  played: number;
  wins: number;
  losses: number;
  killDiff: number;
}

export function standings(state: GameState): StandingRow[] {
  const rows = new Map<ClubId, StandingRow>();
  for (const c of [state.club, ...state.aiClubs]) rows.set(c.id, { clubId: c.id, name: c.name, played: 0, wins: 0, losses: 0, killDiff: 0 });
  for (const r of state.results) {
    const b = rows.get(r.blue)!;
    const d = rows.get(r.red)!;
    b.played++; d.played++;
    b.killDiff += r.kills.blue - r.kills.red;
    d.killDiff += r.kills.red - r.kills.blue;
    if (r.winner === r.blue) { b.wins++; d.losses++; } else { d.wins++; b.losses++; }
  }
  return [...rows.values()].sort((x, y) => y.wins - x.wins || y.killDiff - x.killDiff || x.clubId.localeCompare(y.clubId));
}

export interface FinanceSummary {
  funds: number;
  weeklySalaries: number;
  weeklySponsor: number;
  weeklyNet: number; // sponsor - salaries (prizes excluded)
  runwayWeeks: number; // weeks until funds run out at the current burn; Infinity if not burning
  lowFunds: boolean;
  canSign: boolean;
}

export function financeSummary(state: GameState, data: GameData): FinanceSummary {
  const salaries = weeklySalaries(state);
  const sponsor = data.economy.weeklySponsor;
  const net = sponsor - salaries;
  return {
    funds: state.funds,
    weeklySalaries: salaries,
    weeklySponsor: sponsor,
    weeklyNet: net,
    runwayWeeks: net >= 0 ? Infinity : Math.max(0, state.funds / -net),
    lowFunds: state.funds < salaries * data.economy.lowFundsWarningWeeks,
    canSign: state.funds >= 0,
  };
}

/** Income and expenses grouped per week (week -1 = pre-season signings). */
export function ledgerByWeek(state: GameState): { week: number; income: number; expense: number; entries: LedgerEntry[] }[] {
  const byWeek = new Map<number, LedgerEntry[]>();
  for (const e of state.ledger) {
    const list = byWeek.get(e.week) ?? [];
    list.push(e);
    byWeek.set(e.week, list);
  }
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([week, entries]) => ({
    week,
    income: entries.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0),
    expense: entries.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0),
    entries,
  }));
}

export { overall as playerOverall };
