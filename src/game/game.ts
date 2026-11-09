// P0 management loop: new game, market, lineup, schedule, weekly settlement.
// Functions that change the game mutate the given state; callers that need
// the previous state (e.g. React) should structuredClone it first.

import { validateLineup } from '../core/config';
import { personalityFor } from '../core/personality';
import { createRng, hashString, type Rng } from '../core/rng';
import { FACILITY_IDS, STAFF_ROLES, type ClubId, type FacilityId, type GameData, type Player, type PlayerId, type Tactic, type TeamLineup } from '../core/types';
import { autoLineup } from '../sim/scenario';
import { refreshStaffMarket } from './staff';
import { PLAYER_CLUB_ID, type ClubState, type Delegation, type Fixture, type GameState, type LedgerEntry } from './state';

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

function overall(p: Player): number {
  return (p.attrs.mechanics + p.attrs.awareness + p.attrs.teamwork + p.attrs.mental) / 4;
}

// ---------------------------------------------------------------------------
// New game

/** Circle-method double round robin: n teams, 2 * (n - 1) rounds; second half swaps sides. */
export function buildSchedule(clubIds: ClubId[], seed: number, rng: Rng, season = 1): Fixture[][] {
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
    round, index, blue, red, seed: hashString(season === 1 ? `${seed}:${round}:${index}` : `${seed}:s${season}:${round}:${index}`),
  })));
}

export function newGame(name: string, color: string, seed: number, data: GameData): GameState {
  const rng = createRng(seed);
  const players: Record<PlayerId, Player> = {};
  for (const p of data.players) players[p.id] = structuredClone(p);
  const aiClubs: ClubState[] = data.clubs.map((c) => {
    for (const p of c.players) players[p.id] = withP2Defaults(withP1Defaults(structuredClone(p)), data);
    return {
      id: c.id, name: c.name, shortName: c.shortName, color: c.color, style: c.style, roster: c.players.map((p) => p.id),
      reputation: c.reputation, management: c.management, funds: c.funds, facilities: startingFacilities(),
    };
  });
  for (const p of data.players) players[p.id] = withP2Defaults(withP1Defaults(players[p.id]!), data);
  const club: ClubState = {
    id: PLAYER_CLUB_ID, name: name.trim() || '我的俱乐部', shortName: (name.trim() || '我的').slice(0, 2), color, style: 'PLAYER', roster: [],
    reputation: data.season.startReputation, management: 'PLAYER', funds: 0, facilities: startingFacilities(),
  };
  const schedule = buildSchedule([PLAYER_CLUB_ID, ...aiClubs.map((c) => c.id)], seed, rng);
  const state: GameState = {
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
    calendar: { season: 1, phase: 'PRESEASON', day: 0 },
    training: 'AUTO',
    inbox: [],
    nextMessageId: 1,
    history: [],
    playoffs: [],
    offers: [],
    negotiations: [],
    sponsor: null,
    chemistry: {},
    hallOfFame: [],
    awards: [],
    branches: {},
    goals: {},
    counters: { wins: 0, profitSeasons: 0, triples: 0 },
    staff: {},
    staffMarket: [],
    delegation: startingDelegation(data),
    pending: [],
    decisionLog: [],
    nextDecisionId: 1,
  };
  refreshStaffMarket(state, data);
  return state;
}

/** Nobody hired, every role run by the player (P3). */
export function startingDelegation(data: GameData): Delegation {
  const d = data.staff.delegation;
  return {
    roles: Object.fromEntries(STAFF_ROLES.map((r) => [r, { staffId: null, authority: 'SELF' }])) as Delegation['roles'],
    limit: d.defaultLimit,
    protectTop: d.protectTop,
  };
}

/** Every room at level 1. */
export function startingFacilities(): Record<FacilityId, number> {
  return Object.fromEntries(FACILITY_IDS.map((id) => [id, 1])) as Record<FacilityId, number>;
}

/** Fills the P2 player fields (personality, growth type, career) that older data or saves may lack. */
export function withP2Defaults(p: Player, data: GameData): Player {
  if (!p.traits || !p.growthType) {
    const pers = personalityFor(p.id, data.traits, data.growth);
    p.traits ??= pers.traits;
    p.growthType ??= pers.growthType;
  }
  p.career ??= [];
  return p;
}

/** Fills the P1 player fields that older data or saves may lack. */
export function withP1Defaults(p: Player): Player {
  p.potential ??= Math.min(100, Math.round(overall(p) + Math.max(0, 24 - p.age) * 1.5));
  p.fatigue ??= 0;
  p.morale ??= 70;
  p.stats ??= { played: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
  return p;
}

export function seasonOver(state: GameState): boolean {
  return state.calendar.phase === 'FINISHED';
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

/** 0-based week of the current season (a calendar week, not a league round). */
export function weekOfSeason(state: GameState): number {
  return Math.floor(state.calendar.day / 7);
}

export function addLedger(state: GameState, entry: LedgerEntry): void {
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

/**
 * Highest salary a club short of a full team may sign on credit: the fixed
 * cap, or the cheapest third of the free agents, whichever is higher.
 */
export function emergencySalaryCap(state: GameState, data: GameData): number {
  const salaries = state.market.map((id) => state.players[id]!.salaryPerWeek).sort((a, b) => a - b);
  const third = salaries[Math.max(0, Math.ceil(salaries.length / 3) - 1)] ?? 0;
  return Math.max(data.economy.finance.emergencySigningMaxSalary, third);
}

/** The season a contract signed now starts in (signing after the final counts for the next season). */
export function contractStartSeason(state: GameState): number {
  return state.calendar.phase === 'FINISHED' ? state.calendar.season + 1 : state.calendar.season;
}

/** Signs a free agent for `years` seasons, counting the current one. */
export function signPlayer(state: GameState, data: GameData, playerId: PlayerId, years = data.economy.contracts.defaultYears): Result {
  const k = data.economy.contracts;
  if (!Number.isInteger(years) || years < k.minYears || years > k.maxYears) return fail(`合同年限要在 ${k.minYears}–${k.maxYears} 年之间`);
  const p = state.players[playerId];
  if (!p || !state.market.includes(playerId)) return fail('这名选手不在自由市场');
  if (state.club.roster.length >= data.economy.maxRoster) return fail(`队伍已满（最多 ${data.economy.maxRoster} 人）`);
  // Short of a full team, cheap players can always be signed, even into debt, so the club can keep playing.
  const emergency = state.club.roster.length < data.economy.minRoster && p.salaryPerWeek <= emergencySalaryCap(state, data);
  if (!emergency && state.funds < 0) return fail('资金为负，暂时不能签人');
  if (!emergency && state.funds < p.signingFee) return fail(`资金不足：签约费 ${p.signingFee}，当前资金 ${Math.round(state.funds)}`);
  state.market = state.market.filter((id) => id !== playerId);
  state.club.roster.push(playerId);
  p.clubId = PLAYER_CLUB_ID;
  p.contractUntil = contractStartSeason(state) + years - 1;
  addLedger(state, { week: weekOfSeason(state), kind: 'SIGNING', amount: -p.signingFee, note: `签下 ${p.name}` });
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
