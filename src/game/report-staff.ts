// Group reports (P3, T33): where the money went this week and this season, and how each
// staff member did. Everything is read from the ledger and the decision log, so the numbers
// always match the accounts.

import { STAFF_ROLES, type StaffRole } from '../core/types';
import { standings, weekOfSeason } from './game';
import { hiredStaff } from './staff';
import { PLAYER_CLUB_ID, type DecisionEntry, type GameState, type LedgerEntry, type LedgerKind } from './state';

export interface MoneyBreakdown {
  income: Partial<Record<LedgerKind, number>>;
  expense: Partial<Record<LedgerKind, number>>; // negative amounts
  totalIncome: number;
  totalExpense: number; // negative
  net: number;
}

export function moneyBreakdown(entries: readonly LedgerEntry[]): MoneyBreakdown {
  const b: MoneyBreakdown = { income: {}, expense: {}, totalIncome: 0, totalExpense: 0, net: 0 };
  for (const e of entries) {
    const side = e.amount >= 0 ? b.income : b.expense;
    side[e.kind] = (side[e.kind] ?? 0) + e.amount;
    if (e.amount >= 0) b.totalIncome += e.amount;
    else b.totalExpense += e.amount;
  }
  b.net = b.totalIncome + b.totalExpense;
  return b;
}

const weekOfDay = (day: number) => Math.floor(day / 7);
const isAction = (e: DecisionEntry) => e.status === 'DONE' || e.status === 'APPROVED';

/** Decisions of this season grouped by role. */
function byRole(list: readonly DecisionEntry[]): Record<StaffRole, DecisionEntry[]> {
  const out = { MANAGER: [], COACH: [], FINANCE: [] } as Record<StaffRole, DecisionEntry[]>;
  for (const e of list) out[e.role].push(e);
  return out;
}

export interface WeekReport {
  week: number;
  money: MoneyBreakdown;
  decisions: Record<StaffRole, DecisionEntry[]>;
}

/** One week of this season (default: the current one): money by item and what each staff member did. */
export function weekReport(state: GameState, week = weekOfSeason(state)): WeekReport {
  const season = state.calendar.season;
  return {
    week,
    money: moneyBreakdown(state.ledger.filter((e) => e.week === week)),
    decisions: byRole(state.decisionLog.filter((e) => e.season === season && weekOfDay(e.day) === week)),
  };
}

/** Weeks of this season that have money moves or decisions, newest first. */
export function reportWeeks(state: GameState): number[] {
  const season = state.calendar.season;
  const weeks = new Set<number>([...state.ledger.map((e) => e.week), ...state.decisionLog.filter((e) => e.season === season).map((e) => weekOfDay(e.day))]);
  return [...weeks].sort((a, b) => b - a);
}

export interface SigningResult {
  playerId: string;
  name: string;
  played: number;
  wins: number;
  stillHere: boolean;
}

export interface StaffPerformance {
  role: StaffRole;
  staffName: string | null; // who holds the job now
  done: number; // carried out (alone or approved)
  advice: number;
  approved: number;
  rejected: number;
  expired: number;
  spent: number; // money the carried-out decisions moved out (negative)
  earned: number; // money they brought in
  // Manager: players signed this season and what they did since.
  signings: SigningResult[];
  // Coach: match plans that were played, and how many were won.
  plans: number;
  planWins: number;
  restWeeks: number;
  // Finance: the lowest money of the season and weeks spent below zero.
  lowestFunds: number;
  weeksInDebt: number;
}

export interface SeasonReport {
  season: number;
  money: MoneyBreakdown;
  fundsStart: number;
  fundsNow: number;
  wins: number;
  losses: number;
  staff: StaffPerformance[];
}

/** The money at the end of each week of this season, rebuilt from the ledger. */
function fundsByWeek(state: GameState): { start: number; weeks: Map<number, number> } {
  const start = state.funds - state.ledger.reduce((a, e) => a + e.amount, 0);
  const weeks = new Map<number, number>();
  let funds = start;
  for (const e of state.ledger) { funds += e.amount; weeks.set(e.week, funds); }
  return { start, weeks };
}

function signingResults(state: GameState, list: readonly DecisionEntry[]): SigningResult[] {
  return list.filter((e) => e.kind === 'SIGN' && isAction(e) && e.ref).map((e) => {
    const p = state.players[e.ref!];
    const stats = p?.stats ?? { played: 0, wins: 0 };
    return {
      playerId: e.ref!, name: p?.name ?? '?',
      played: stats.played - (e.since?.played ?? 0), wins: stats.wins - (e.since?.wins ?? 0),
      stillHere: !!p && p.clubId === PLAYER_CLUB_ID,
    };
  });
}

/** This season so far: income and spending by item, results, and how each staff member did. */
export function seasonReport(state: GameState): SeasonReport {
  const season = state.calendar.season;
  const log = state.decisionLog.filter((e) => e.season === season);
  const { start, weeks } = fundsByWeek(state);
  const row = standings(state).find((r) => r.clubId === PLAYER_CLUB_ID);
  const playoffWins = state.playoffs.filter((m) => m.winner === PLAYER_CLUB_ID).length;
  const playoffLosses = state.playoffs.filter((m) => m.winner !== null && m.winner !== PLAYER_CLUB_ID && (m.blue === PLAYER_CLUB_ID || m.red === PLAYER_CLUB_ID)).length;
  const funds = [...weeks.values()];
  const staff = STAFF_ROLES.map((role): StaffPerformance => {
    const mine = log.filter((e) => e.role === role);
    const acted = mine.filter(isAction);
    const plans = acted.filter((e) => e.kind === 'TACTIC' && e.result);
    return {
      role, staffName: hiredStaff(state, role)?.name ?? null,
      done: acted.length,
      advice: mine.filter((e) => e.status === 'ADVICE').length,
      approved: mine.filter((e) => e.status === 'APPROVED').length,
      rejected: mine.filter((e) => e.status === 'REJECTED').length,
      expired: mine.filter((e) => e.status === 'EXPIRED').length,
      spent: acted.filter((e) => e.cost < 0).reduce((a, e) => a + e.cost, 0),
      earned: acted.filter((e) => e.cost > 0).reduce((a, e) => a + e.cost, 0),
      signings: role === 'MANAGER' ? signingResults(state, mine) : [],
      plans: plans.length,
      planWins: plans.filter((e) => e.result === '赢了').length,
      restWeeks: acted.filter((e) => e.kind === 'TRAINING' && e.text.endsWith('休息')).length,
      lowestFunds: Math.min(start, ...funds),
      weeksInDebt: funds.filter((f) => f < 0).length,
    };
  });
  return {
    season, money: moneyBreakdown(state.ledger), fundsStart: start, fundsNow: state.funds,
    wins: (row?.wins ?? 0) + playoffWins, losses: (row?.losses ?? 0) + playoffLosses, staff,
  };
}
