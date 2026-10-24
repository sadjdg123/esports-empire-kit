// Club finances (P1, GDD 8): sponsor deals, league share, merchandise,
// prizes, running costs and reputation. The player's money moves through
// the ledger; AI clubs follow the same rules but only keep a balance.

import type { ClubId, GameData, SponsorDef, SponsorGoal } from '../core/types';
import { addLedger, clubById, contractStartSeason, rosterOf, weekOfSeason, weeklySalaries, type Result } from './game';
import { postMessage } from './messages';
import { PLAYER_CLUB_ID, type ClubState, type FixtureResult, type GameState, type LedgerKind } from './state';
import { facilityUpkeep, facilityValue, sponsorStanding } from './facilities';
import { trainingFocusOf } from './training';
import { staffWages } from './staff';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Sponsors

export function activeSponsor(state: GameState) {
  return state.sponsor && state.sponsor.untilSeason >= state.calendar.season ? state.sponsor : null;
}

/** Sponsors open to a club of this reputation (plus the emergency deal when money is short). */
export function sponsorOffers(state: GameState, data: GameData): SponsorDef[] {
  const f = data.economy.finance;
  const list = f.sponsorTiers.filter((t) => t.minReputation <= sponsorStanding(state, data)).flatMap((t) => t.sponsors);
  return financeSummary(state, data).lowFunds ? [...list, f.emergencySponsor] : list;
}

/** Expected weekly value of a deal, for the AI and the automatic choice. */
// Season goals count at a fraction of their bonus spread over a season (roughly how often they are reached).
const sponsorScore = (s: SponsorDef) => s.weekly + s.winBonus * 0.5 + (s.goals ?? []).reduce((a, g) => a + g.bonus, 0) * 0.03;

export function bestSponsorFor(data: GameData, reputation: number): SponsorDef {
  const open = data.economy.finance.sponsorTiers.filter((t) => t.minReputation <= reputation).flatMap((t) => t.sponsors);
  return [...open].sort((a, b) => sponsorScore(b) - sponsorScore(a) || a.id.localeCompare(b.id))[0]!;
}

/** How the player's season went, for sponsor goals (T27). */
export interface SeasonOutcome { rank: number; wins: number; playoff: 'CHAMPION' | 'FINAL' | 'SEMI' | 'NONE' }

export function sponsorGoalMet(data: GameData, g: SponsorGoal, r: SeasonOutcome): boolean {
  switch (g.kind) {
    case 'PLAYOFFS': return r.rank <= data.season.playoffTeams;
    case 'TOP2': return r.rank <= 2;
    case 'FINAL': return r.playoff === 'FINAL' || r.playoff === 'CHAMPION';
    case 'CHAMPION': return r.playoff === 'CHAMPION';
    case 'WINS': return r.wins >= (g.value ?? 0);
  }
}

/** Season end: the current sponsor pays the bonus of every goal reached. Returns the total paid. */
export function paySponsorGoals(state: GameState, data: GameData, r: SeasonOutcome): number {
  const deal = activeSponsor(state);
  if (!deal?.goals?.length) return 0;
  const met = deal.goals.filter((g) => sponsorGoalMet(data, g, r));
  const total = met.reduce((a, g) => a + g.bonus, 0);
  for (const g of met) addLedger(state, { week: weekOfSeason(state), kind: 'SPONSOR', amount: g.bonus, note: `${deal.name} 目标奖金：${sponsorGoalText(g)}` });
  if (met.length) postMessage(state, 'FINANCE', '赞助目标达成', `${deal.name} 发来目标奖金 ${total}：${met.map(sponsorGoalText).join('、')}。`);
  return total;
}

/**
 * Season end for AI clubs: they run on the best deal their standing allows (as for the weekly money)
 * and collect that deal's goal bonuses by the same rules as the player.
 */
export function payAiSponsorGoals(state: GameState, data: GameData, outcome: (clubId: ClubId) => SeasonOutcome): void {
  for (const club of state.aiClubs) {
    const deal = bestSponsorFor(data, sponsorStanding(state, data, club.id));
    const r = outcome(club.id);
    club.funds += (deal.goals ?? []).filter((g) => sponsorGoalMet(data, g, r)).reduce((a, g) => a + g.bonus, 0);
  }
}

/** A goal in a few words. */
export function sponsorGoalText(g: SponsorGoal): string {
  switch (g.kind) {
    case 'PLAYOFFS': return '进季后赛';
    case 'TOP2': return '常规赛前 2';
    case 'FINAL': return '打进总决赛';
    case 'CHAMPION': return '拿总冠军';
    case 'WINS': return `常规赛 ${g.value ?? 0} 胜`;
  }
}

/** Signs a sponsor deal. Only when the current deal is over, except the emergency deal, which replaces it. */
export function signSponsor(state: GameState, data: GameData, sponsorId: string, years: number): Result {
  const f = data.economy.finance;
  const offer = sponsorOffers(state, data).find((s) => s.id === sponsorId);
  if (!offer) return fail('这家赞助商现在不和你签（声望不够，或者应急赞助只在资金偏低时提供）');
  if (!Number.isInteger(years) || years < 1 || years > f.sponsorMaxYears) return fail(`赞助合同 1–${f.sponsorMaxYears} 年`);
  const current = activeSponsor(state);
  const emergency = sponsorId === f.emergencySponsor.id;
  if (current && !emergency) return fail(`当前赞助（${current.name}）到第 ${current.untilSeason} 赛季，到期后才能换`);
  state.sponsor = {
    sponsorId, name: offer.name, weekly: offer.weekly, winBonus: offer.winBonus, untilSeason: contractStartSeason(state) + (emergency ? 0 : years - 1),
    ...(offer.goals?.length ? { goals: offer.goals.map((g) => ({ ...g })) } : {}),
  };
  if (offer.signingBonus > 0) addLedger(state, { week: weekOfSeason(state), kind: 'SPONSOR', amount: offer.signingBonus, note: `${offer.name} 签约金` });
  return ok(undefined);
}

/** A club without a deal when the league starts gets the best one it can, for one season. */
export function autoSponsor(state: GameState, data: GameData): void {
  if (activeSponsor(state)) return;
  const best = bestSponsorFor(data, sponsorStanding(state, data));
  signSponsor(state, data, best.id, 1);
  postMessage(state, 'FINANCE', `自动签下赞助：${best.name}`, `开赛时你还没选赞助商，系统替你签了能签到的最好一家（1 个赛季）：每周 ${best.weekly}，每赢一场另给 ${best.winBonus}。`);
}

// ---------------------------------------------------------------------------
// Weekly money

/** What a club earns in a typical week of a season (sponsor, league share, merchandise, prizes), for budgeting. */
export function expectedWeeklyIncome(state: GameState, data: GameData, clubId: ClubId = PLAYER_CLUB_ID): number {
  const eco = data.economy;
  const f = eco.finance;
  const club = clubById(state, clubId);
  const playoffWeeks = data.season.playoffTeams === 4 ? 2 : 1;
  const weeks = data.season.preseasonWeeks + state.totalRounds + playoffWeeks;
  const deal = clubId === PLAYER_CLUB_ID ? (activeSponsor(state) ?? bestSponsorFor(data, sponsorStanding(state, data))) : bestSponsorFor(data, sponsorStanding(state, data, clubId));
  const perMatch = (eco.prizeWin + eco.prizeLoss) / 2 + deal.winBonus / 2;
  return deal.weekly + (f.leagueShareWeekly * (state.totalRounds + playoffWeeks)) / weeks + f.merchBase + club.reputation * f.merchPerReputation
    + (state.totalRounds * perMatch) / weeks;
}

function seasonWinRate(state: GameState, clubId: ClubId): number {
  const mine = state.results.filter((r) => r.blue === clubId || r.red === clubId);
  return mine.length === 0 ? 0.5 : mine.filter((r) => r.winner === clubId).length / mine.length;
}

export interface WeeklyMoney {
  salaries: number; // as a positive amount
  sponsor: number;
  league: number;
  merch: number;
  training: number; // as a positive amount
  upkeep: number; // facilities, as a positive amount
  staff: number; // hired staff wages (player club, P3), as a positive amount
  net: number;
}

/** What next pay day brings for a club (prizes excluded). */
export function weeklyMoney(state: GameState, data: GameData, clubId: ClubId = PLAYER_CLUB_ID): WeeklyMoney {
  const f = data.economy.finance;
  const club = clubById(state, clubId);
  const salaries = rosterOf(state, clubId).reduce((a, p) => a + p.salaryPerWeek, 0);
  const sponsor = clubId === PLAYER_CLUB_ID ? (activeSponsor(state)?.weekly ?? 0) : bestSponsorFor(data, sponsorStanding(state, data, clubId)).weekly;
  const inLeague = state.calendar.phase === 'REGULAR' || state.calendar.phase === 'PLAYOFFS';
  const league = inLeague ? f.leagueShareWeekly : 0;
  const merch = Math.round((f.merchBase + club.reputation * f.merchPerReputation) * (1 + (seasonWinRate(state, clubId) - 0.5) * f.merchWinRateEffect)
    * (1 + facilityValue(state, data, clubId, 'STREAM')));
  const training = trainingFocusOf(state, data, clubId) === 'REST' ? 0 : club.roster.length * f.trainingCostPerPlayer;
  const upkeep = facilityUpkeep(data, club);
  const staff = clubId === PLAYER_CLUB_ID ? staffWages(state) : 0;
  return { salaries, sponsor, league, merch, training, upkeep, staff, net: sponsor + league + merch - salaries - training - upkeep - staff };
}

/** Pay day for every club. */
export function runPayDay(state: GameState, data: GameData): void {
  const week = weekOfSeason(state);
  const m = weeklyMoney(state, data);
  const line = (kind: LedgerKind, amount: number, note: string) => { if (amount !== 0) addLedger(state, { week, kind, amount, note }); };
  line('SALARY', -m.salaries, '选手周薪');
  line('SPONSOR', m.sponsor, `赞助：${activeSponsor(state)?.name ?? ''}`);
  line('LEAGUE', m.league, '联赛分成');
  line('MERCH', m.merch, '周边收入');
  line('TRAINING', -m.training, '训练开销');
  line('UPKEEP', -m.upkeep, '设施维护');
  line('STAFF', -m.staff, '负责人工资');
  for (const club of state.aiClubs) club.funds += weeklyMoney(state, data, club.id).net;
}

function credit(state: GameState, club: ClubState, kind: LedgerKind, amount: number, note: string): void {
  if (amount === 0) return;
  if (club.id === PLAYER_CLUB_ID) addLedger(state, { week: weekOfSeason(state), kind, amount, note });
  else club.funds += amount;
}

function addReputation(club: ClubState, delta: number): void {
  club.reputation = Math.round(Math.max(0, Math.min(100, club.reputation + delta)) * 10) / 10;
}

/** Prizes, sponsor win bonuses and reputation after one match. Call after the result is in state.results (league). */
export function applyMatchFinance(state: GameState, data: GameData, fr: FixtureResult, stage: 'LEAGUE' | 'SEMI' | 'FINAL'): void {
  const eco = data.economy;
  const rep = eco.finance.reputation;
  const label = stage === 'LEAGUE' ? '比赛' : stage === 'SEMI' ? '季后赛半决赛' : '总决赛';
  for (const id of [fr.blue, fr.red]) {
    const club = clubById(state, id);
    const won = fr.winner === id;
    credit(state, club, 'PRIZE', won ? eco.prizeWin : eco.prizeLoss, won ? `${label}胜利奖金` : `${label}出场奖金`);
    const bonus = won ? (id === PLAYER_CLUB_ID ? (activeSponsor(state)?.winBonus ?? 0) : bestSponsorFor(data, sponsorStanding(state, data, id)).winBonus) : 0;
    credit(state, club, 'SPONSOR', bonus, '赞助商胜场奖励');
    addReputation(club, won ? rep.win : rep.loss);
    if (!won && stage === 'LEAGUE') {
      const last = state.results.filter((r) => r.blue === id || r.red === id).slice(-rep.streakLength);
      if (last.length === rep.streakLength && last.every((r) => r.winner !== id)) addReputation(club, rep.streakLoss);
    }
  }
}

/** Playoff prizes and reputation, once the final is decided. */
export function applyPlayoffAwards(state: GameState, data: GameData): void {
  const f = data.economy.finance;
  const final = state.playoffs.find((m) => m.stage === 'FINAL');
  const semis = new Set(state.playoffs.filter((m) => m.stage === 'SEMI').flatMap((m) => [m.blue, m.red]));
  for (const id of [...semis].sort()) {
    const club = clubById(state, id);
    let prize = f.playoffPrize.semi;
    let rep = f.reputation.playoffs;
    if (final && (final.blue === id || final.red === id)) { prize = f.playoffPrize.final; rep += f.reputation.final; }
    if (final?.winner === id) { prize = f.playoffPrize.champion; rep += f.reputation.champion; }
    credit(state, club, 'PRIZE', prize, final?.winner === id ? '总冠军奖金' : final && (final.blue === id || final.red === id) ? '亚军奖金' : '季后赛奖金');
    addReputation(club, rep);
  }
}

/** New season: every club's reputation moves part of the way back toward the middle; it has to be earned again. */
export function settleReputation(state: GameState, data: GameData): void {
  const r = data.economy.finance.reputation;
  for (const club of [state.club, ...state.aiClubs]) addReputation(club, (r.neutral - club.reputation) * r.seasonPull);
}

// ---------------------------------------------------------------------------
// Summary, forecast, rescue

export interface FinanceSummary {
  funds: number;
  weeklySalaries: number;
  weeklySponsor: number;
  weeklyNet: number; // next pay day, prizes excluded
  runwayWeeks: number; // weeks until funds run out at the current burn; Infinity if not burning
  lowFunds: boolean;
  canSign: boolean;
}

export function financeSummary(state: GameState, data: GameData): FinanceSummary {
  const m = weeklyMoney(state, data);
  return {
    funds: state.funds,
    weeklySalaries: weeklySalaries(state),
    weeklySponsor: m.sponsor,
    weeklyNet: m.net,
    runwayWeeks: m.net >= 0 ? Infinity : Math.max(0, state.funds / -m.net),
    lowFunds: state.funds < weeklySalaries(state) * data.economy.lowFundsWarningWeeks,
    canSign: state.funds >= 0,
  };
}

export interface ForecastWeek {
  week: number; // calendar week of the season (0-based)
  matches: number;
  income: number; // incl. expected prizes (half wins, half losses)
  expense: number; // as a negative amount
  fundsAfter: number;
}

/** Expected cash flow for the next few weeks, from today's deals and schedule. */
export function cashForecast(state: GameState, data: GameData): ForecastWeek[] {
  const eco = data.economy;
  const m = weeklyMoney(state, data);
  const startWeek = weekOfSeason(state);
  const regularStart = data.season.preseasonWeeks;
  const leagueEnd = regularStart + state.totalRounds + (data.season.playoffTeams === 4 ? 2 : 1);
  const rows: ForecastWeek[] = [];
  let funds = state.funds;
  for (let i = 1; i <= eco.finance.forecastWeeks; i++) {
    const week = startWeek + i;
    if (state.calendar.phase === 'FINISHED' || week >= leagueEnd + 1) break;
    const inLeague = week >= regularStart && week < leagueEnd;
    const matches = inLeague && week < regularStart + state.totalRounds ? 1 : 0;
    const prize = matches * ((eco.prizeWin + eco.prizeLoss) / 2 + (activeSponsor(state)?.winBonus ?? 0) / 2);
    const income = m.sponsor + (inLeague ? eco.finance.leagueShareWeekly : 0) + m.merch + prize;
    const expense = -(m.salaries + m.training);
    funds += income + expense;
    rows.push({ week, matches, income: Math.round(income), expense, fundsAfter: Math.round(funds) });
  }
  return rows;
}

/** Plain-language ways out when money is short (GDD: no hidden bankruptcy). */
export function rescueOptions(state: GameState, data: GameData): string[] {
  const f = financeSummary(state, data);
  if (!f.lowFunds) return [];
  const tips: string[] = [];
  const priciest = rosterOf(state).sort((a, b) => b.salaryPerWeek - a.salaryPerWeek)[0];
  if (priciest) tips.push(state.calendar.phase === 'PRESEASON' ? `休赛期可以卖掉高薪选手，例如 ${priciest.name}（周薪 ${priciest.salaryPerWeek}）` : `周薪最高的是 ${priciest.name}（${priciest.salaryPerWeek}），休赛期可以考虑卖掉`);
  const em = data.economy.finance.emergencySponsor;
  if (state.sponsor?.sponsorId !== em.id) tips.push(`可以接应急赞助"${em.name}"：立即到账 ${em.signingBonus}，但之后每周只有 ${em.weekly}，到本赛季结束`);
  tips.push('训练改成"休息"可以省下训练开销');
  if (state.funds < 0) tips.push('资金为负时不能签人和买人（队伍不足 5 人时除外），比赛照常进行');
  return tips;
}
