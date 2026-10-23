// Contracts (P1, GDD 10): salaries, market value, renewals, expiry and
// release fees. A contract runs to the end of season `contractUntil`.

import type { ClubId, GameData, Player, PlayerId } from '../core/types';
import { addLedger, playerOverall, rosterOf, weekOfSeason, type Result } from './game';
import { facilityValue } from './facilities';
import { postMessage } from './messages';
import { PLAYER_CLUB_ID, type GameState, type Negotiation } from './state';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });
const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

/** What a player of this ability is worth per week. */
export function fairSalary(data: GameData, p: Player): number {
  const k = data.economy.contracts;
  const ovr = playerOverall(p);
  let s = k.salaryBase + Math.max(0, ovr - k.salaryFloor) ** k.salaryExp * k.salaryPer;
  if (p.age <= k.youthAge) s += Math.max(0, (p.potential ?? ovr) - ovr) * k.youthPremiumPerPotential;
  return roundTo(s, 50);
}

/** Transfer value: salary-based, higher for young high-potential players, lower past the peak. */
export function marketValue(data: GameData, p: Player): number {
  const k = data.economy.contracts;
  const ovr = playerOverall(p);
  const ageMult = Math.max(k.valueMinMult,
    1 + Math.max(0, (p.potential ?? ovr) - ovr) * k.valuePotentialPer - Math.max(0, p.age - k.valueDeclineAge) * k.valueDeclinePerYear);
  return roundTo(fairSalary(data, p) * k.valueWeeks * ageMult * (1 + p.form * k.valueFormPer), 500);
}

/** Weeks in a season: pre-season, one week per league round, one per playoff stage. */
export function seasonWeeks(state: GameState, data: GameData): number {
  return data.season.preseasonWeeks + state.totalRounds + (data.season.playoffTeams === 4 ? 2 : 1);
}

export function remainingContractWeeks(state: GameState, data: GameData, p: Player): number {
  if (p.contractUntil === undefined) return 0;
  const thisSeason = state.calendar.phase === 'FINISHED' ? 0 : Math.max(0, seasonWeeks(state, data) - weekOfSeason(state));
  return thisSeason + Math.max(0, p.contractUntil - state.calendar.season) * seasonWeeks(state, data);
}

export function releaseFeeFor(state: GameState, data: GameData, p: Player): number {
  return Math.round(p.salaryPerWeek * remainingContractWeeks(state, data, p) * data.economy.contracts.releaseFeeShare);
}

/** Players of a club whose contract ends this season (or by the given season). */
export function expiringPlayers(state: GameState, clubId: ClubId = PLAYER_CLUB_ID, season = state.calendar.season): Player[] {
  return rosterOf(state, clubId).filter((p) => p.contractUntil !== undefined && p.contractUntil <= season);
}

export function validYears(data: GameData, years: number): boolean {
  const k = data.economy.contracts;
  return Number.isInteger(years) && years >= k.minYears && years <= k.maxYears;
}

// ---------------------------------------------------------------------------
// Renewals (player club)

/**
 * Weekly salary a player asks for: fair pay, more when unhappy, never much less than now.
 * `office` is the club office's effect (T22): −0.05 asks 5% less.
 */
export function renewalAsk(data: GameData, p: Player, office = 0): number {
  const k = data.economy.contracts;
  const neutral = data.growth.moraleNeutral;
  const moodMult = 1 + (neutral - (p.morale ?? neutral)) * k.askMoralePer;
  return roundTo(Math.max(fairSalary(data, p) * moodMult, p.salaryPerWeek * k.askMinOfCurrent) * (1 + office), 50);
}

export function negotiationFor(state: GameState, playerId: PlayerId): Negotiation | undefined {
  return state.negotiations.find((n) => n.playerId === playerId && n.season === state.calendar.season);
}

/** Opens (or returns the open) renewal talk. Only in the last season of the contract. */
export function openNegotiation(state: GameState, data: GameData, playerId: PlayerId): Result<Negotiation> {
  const p = state.players[playerId];
  if (!p || !state.club.roster.includes(playerId)) return fail('这名选手不在你的队伍里');
  if (state.calendar.phase === 'FINISHED') return fail('赛季已经结束，续约要在合同最后一个赛季内谈');
  if (p.retiring) return fail(`${p.name} 打完这个赛季就退役，不再续约`);
  if (p.contractUntil === undefined || p.contractUntil > state.calendar.season) return fail(`${p.name} 的合同到第 ${p.contractUntil} 赛季，最后一个赛季才能续约`);
  const existing = negotiationFor(state, playerId);
  if (existing) return existing.status === 'OPEN' ? ok(existing) : fail(existing.status === 'AGREED' ? '已经续约了' : `${p.name} 已经拒绝续约，赛季结束后离队`);
  const n: Negotiation = { playerId, season: state.calendar.season, ask: renewalAsk(data, p, facilityValue(state, data, PLAYER_CLUB_ID, 'OFFICE')), countered: false, status: 'OPEN' };
  state.negotiations.push(n);
  return ok(n);
}

function signRenewal(state: GameState, data: GameData, p: Player, salary: number, years: number, n: Negotiation): void {
  p.salaryPerWeek = salary;
  p.signingFee = salary * data.economy.signingFeeWeeks;
  p.contractUntil = state.calendar.season + years;
  n.status = 'AGREED';
  postMessage(state, 'CONTRACT', `${p.name} 续约成功`, `新合同到第 ${p.contractUntil} 赛季，周薪 ${salary}（立即生效）。`);
}

export function acceptRenewal(state: GameState, data: GameData, playerId: PlayerId, years: number): Result {
  if (!validYears(data, years)) return fail('合同年限不对');
  const opened = openNegotiation(state, data, playerId);
  if (!opened.ok) return opened;
  signRenewal(state, data, state.players[playerId]!, opened.value.ask, years, opened.value);
  return ok(undefined);
}

/** One counter offer per talk. Accepted when close enough to the ask (happier players settle for less). */
export function counterRenewal(state: GameState, data: GameData, playerId: PlayerId, salary: number, years: number): Result<{ accepted: boolean }> {
  if (!validYears(data, years)) return fail('合同年限不对');
  if (!Number.isFinite(salary) || salary <= 0) return fail('周薪要大于 0');
  const opened = openNegotiation(state, data, playerId);
  if (!opened.ok) return opened;
  const n = opened.value;
  if (n.countered) return fail('只能还价一次，现在只能接受或拒绝');
  n.countered = true;
  const p = state.players[playerId]!;
  const k = data.economy.contracts;
  const ratio = k.counterAcceptRatio - ((p.morale ?? data.growth.moraleNeutral) - data.growth.moraleNeutral) * k.counterMoralePer;
  if (salary >= n.ask * ratio) {
    signRenewal(state, data, p, Math.round(salary), years, n);
    return ok({ accepted: true });
  }
  p.morale = Math.max(0, (p.morale ?? data.growth.moraleNeutral) - k.refuseMoralePenalty / 2);
  return ok({ accepted: false });
}

export function declineRenewal(state: GameState, data: GameData, playerId: PlayerId): Result {
  const opened = openNegotiation(state, data, playerId);
  if (!opened.ok) return opened;
  opened.value.status = 'REFUSED';
  const p = state.players[playerId]!;
  p.morale = Math.max(0, (p.morale ?? data.growth.moraleNeutral) - data.economy.contracts.refuseMoralePenalty);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Season rollover

/** Free agents re-price themselves each season. */
function repriceMarket(state: GameState, data: GameData): void {
  for (const id of state.market) {
    const p = state.players[id]!;
    p.salaryPerWeek = fairSalary(data, p);
    p.signingFee = p.salaryPerWeek * data.economy.signingFeeWeeks;
  }
}

/**
 * Called when a new season starts (calendar.season already incremented, AI
 * renewals already decided): expired contracts leave and the market re-prices.
 */
export function rollContracts(state: GameState, data: GameData): void {
  for (const club of [state.club, ...state.aiClubs]) {
    for (const p of rosterOf(state, club.id)) {
      if (p.contractUntil === undefined || p.contractUntil >= state.calendar.season) continue;
      club.roster = club.roster.filter((id) => id !== p.id);
      state.market.push(p.id);
      p.clubId = null;
      delete p.contractUntil;
      if (club.id === PLAYER_CLUB_ID) {
        if (state.lineup?.picks.some((pk) => pk.playerId === p.id)) state.lineup = null;
        postMessage(state, 'CONTRACT', `${p.name} 合同到期离队`, `${p.name} 成为自由球员。休赛期可以去市场补人。`);
      }
    }
  }
  state.negotiations = state.negotiations.filter((n) => n.season >= state.calendar.season);
  repriceMarket(state, data);
}

/** Inbox reminder for the player's contracts ending this season. Returns true if there were any. */
export function remindExpiring(state: GameState): boolean {
  const list = expiringPlayers(state).filter((p) => !p.retiring && negotiationFor(state, p.id)?.status !== 'AGREED' && negotiationFor(state, p.id)?.status !== 'REFUSED');
  if (list.length === 0) return false;
  postMessage(state, 'CONTRACT', '合同即将到期', `${list.map((p) => p.name).join('、')} 的合同本赛季结束。不续约的话，赛季结束后会离队。`,
    { players: list.map((p) => p.id).join(',') });
  return true;
}

/** Releases one of the player's players; the fee covers part of the remaining contract. */
export function releasePlayer(state: GameState, data: GameData, playerId: PlayerId): Result {
  const p = state.players[playerId];
  if (!p || !state.club.roster.includes(playerId)) return fail('这名选手不在你的队伍里');
  if (state.calendar.phase !== 'PRESEASON' && state.club.roster.length <= data.economy.minRoster) return fail(`赛季中队伍至少要有 ${data.economy.minRoster} 人`);
  const fee = releaseFeeFor(state, data, p);
  if (state.funds < fee) return fail(`资金不足：违约金 ${fee}，当前资金 ${Math.round(state.funds)}`);
  state.club.roster = state.club.roster.filter((id) => id !== playerId);
  state.market.push(playerId);
  p.clubId = null;
  delete p.contractUntil;
  if (state.lineup?.picks.some((pk) => pk.playerId === playerId)) state.lineup = null;
  addLedger(state, { week: weekOfSeason(state), kind: 'RELEASE', amount: -fee, note: `与 ${p.name} 解约` });
  return ok(undefined);
}
