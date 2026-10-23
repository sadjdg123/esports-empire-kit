// AI club management (P1, GDD 11). AI clubs follow the player's rules:
// they pay signing fees, salaries and transfer fees from their own funds,
// only trade in the pre-season window and renew at the asking price.

import { createRng } from '../core/rng';
import { ROLES, TACTICS, type AiStyleConfig, type GameData, type Player, type Role, type Tactic } from '../core/types';
import { autoLineup } from '../sim/scenario';
import { expiringPlayers, releaseFeeFor, remainingContractWeeks, renewalAsk, seasonWeeks } from './contracts';
import { expectedWeeklyIncome } from './finance';
import { contractStartSeason, emergencySalaryCap, playerOverall, rosterOf } from './game';
import { type ClubState, type GameState } from './state';
import { askingPrice, completeTransfer, transferWindowOpen } from './transfers';

export function aiStyle(data: GameData, club: ClubState): AiStyleConfig {
  if (club.management === 'PLAYER') throw new Error('the player club has no AI style');
  return data.ai.styles[club.management];
}

/** How much an AI club of this style values a player. */
export function aiEval(style: AiStyleConfig, p: Player): number {
  const ovr = playerOverall(p);
  const youth = p.age <= 22 ? Math.max(0, (p.potential ?? ovr) - ovr) * style.youthWeight : 0;
  return ovr + youth - Math.max(0, p.age - 27) * style.ageWeight;
}

function payroll(state: GameState, club: ClubState): number {
  return club.roster.reduce((a, id) => a + state.players[id]!.salaryPerWeek, 0);
}

/**
 * Payroll an AI club allows itself: a share of its income, plus (or minus)
 * the money above (or below) its reserve, spread over two seasons.
 */
export function aiWageBudget(state: GameState, data: GameData, club: ClubState): number {
  const style = aiStyle(data, club);
  const surplus = club.funds - payroll(state, club) * style.reserveWeeks;
  return Math.max(0, expectedWeeklyIncome(state, data, club.id) * style.wageShare + surplus / (2 * seasonWeeks(state, data)));
}

/** Money an AI club may spend on fees right now, keeping its reserve. */
function spendable(state: GameState, data: GameData, club: ClubState, extraSalary = 0): number {
  return club.funds - (payroll(state, club) + extraSalary) * aiStyle(data, club).reserveWeeks;
}

function contractYears(data: GameData, p: Player): number {
  const k = data.economy.contracts;
  return p.age <= 23 ? k.maxYears : p.age >= 29 ? k.minYears : k.defaultYears;
}

function starterIds(state: GameState, data: GameData, club: ClubState): Set<string> {
  const roster = rosterOf(state, club.id);
  if (roster.length < 5) return new Set(roster.map((p) => p.id));
  return new Set(autoLineup(data, club.id, roster, 'STEADY_MACRO').picks.map((pk) => pk.playerId));
}

/** Best current player of a role on a club, by the club's own valuation (-Infinity if nobody). */
function bestAt(state: GameState, style: AiStyleConfig, club: ClubState, role: Role): number {
  return Math.max(-Infinity, ...rosterOf(state, club.id).filter((p) => p.primaryRole === role).map((p) => aiEval(style, p)));
}

/** Roles from the club's weakest to its strongest (a missing role counts as weakest). */
function rolesByWeakness(state: GameState, data: GameData, club: ClubState): Role[] {
  const style = aiStyle(data, club);
  return ROLES.map((r) => ({ r, v: bestAt(state, style, club, r) })).sort((a, b) => a.v - b.v || a.r.localeCompare(b.r)).map((x) => x.r);
}

function signForAi(state: GameState, data: GameData, club: ClubState, p: Player): void {
  state.market = state.market.filter((id) => id !== p.id);
  club.roster.push(p.id);
  p.clubId = club.id;
  p.contractUntil = contractStartSeason(state) + contractYears(data, p) - 1;
  club.funds -= p.signingFee;
}

// ---------------------------------------------------------------------------
// Season rollover

/** Before contracts end: keep the players the club values most, if their asking salary fits the budget. */
export function aiRenewals(state: GameState, data: GameData, endedSeason: number): void {
  for (const club of state.aiClubs) {
    const style = aiStyle(data, club);
    const ranked = rosterOf(state, club.id).sort((a, b) => aiEval(style, b) - aiEval(style, a) || a.id.localeCompare(b.id));
    const keep = new Set(ranked.slice(0, aiRosterTarget(state, data, club)).map((p) => p.id));
    const starters = starterIds(state, data, club);
    const budget = aiWageBudget(state, data, club);
    for (const p of expiringPlayers(state, club.id, endedSeason).sort((a, b) => aiEval(style, b) - aiEval(style, a) || a.id.localeCompare(b.id))) {
      if (!keep.has(p.id) || p.age >= data.ai.talent.freeAgentLeaveAge) continue;
      const ask = renewalAsk(data, p);
      const fits = payroll(state, club) - p.salaryPerWeek + ask <= budget;
      if (!fits && !(starters.has(p.id) && club.funds > 0)) continue;
      p.salaryPerWeek = ask;
      p.signingFee = ask * data.economy.signingFeeWeeks;
      p.contractUntil = endedSeason + contractYears(data, p);
    }
  }
}

/** Never short of a team: below the minimum, sign the best affordable player, or a cheap one on credit (the player's rule). */
export function aiFillRosters(state: GameState, data: GameData): void {
  for (const club of state.aiClubs) {
    const cap = emergencySalaryCap(state, data);
    const style = aiStyle(data, club);
    while (club.roster.length < data.economy.minRoster && state.market.length > 0) {
      const roles = new Set(rosterOf(state, club.id).map((p) => p.primaryRole));
      const pool = state.market.map((id) => state.players[id]!).filter((p) => p.signingFee <= club.funds || p.salaryPerWeek <= cap);
      const pick = pool.sort((a, b) => Number(roles.has(a.primaryRole)) - Number(roles.has(b.primaryRole)) || aiEval(style, b) - aiEval(style, a) || a.id.localeCompare(b.id))[0];
      if (!pick) break;
      signForAi(state, data, club, pick);
    }
  }
}

/** Roster size an AI club aims for: its style's target, plus one or two when it has seasons of payroll to spare. */
export function aiRosterTarget(state: GameState, data: GameData, club: ClubState): number {
  const style = aiStyle(data, club);
  const spare = (club.funds - payroll(state, club) * style.reserveWeeks) / Math.max(1, payroll(state, club) * seasonWeeks(state, data));
  return Math.min(data.economy.maxRoster, style.rosterTarget + (spare >= 2 ? 2 : spare >= 1 ? 1 : 0));
}

/** Up to the roster target, missing roles first, within the wage budget and the bank reserve. */
export function aiSignFreeAgents(state: GameState, data: GameData): void {
  for (const club of state.aiClubs) {
    const style = aiStyle(data, club);
    const budget = aiWageBudget(state, data, club);
    const target = aiRosterTarget(state, data, club);
    for (let guard = 0; guard < 8 && club.roster.length < target; guard++) {
      const roles = new Set(rosterOf(state, club.id).map((p) => p.primaryRole));
      const pick = state.market.map((id) => state.players[id]!)
        .filter((p) => payroll(state, club) + p.salaryPerWeek <= budget && p.signingFee <= spendable(state, data, club, p.salaryPerWeek))
        .sort((a, b) => Number(roles.has(a.primaryRole)) - Number(roles.has(b.primaryRole)) || aiEval(style, b) - aiEval(style, a) || a.id.localeCompare(b.id))[0];
      if (!pick) break;
      signForAi(state, data, club, pick);
    }
  }
  aiFillRosters(state, data);
}

// ---------------------------------------------------------------------------
// Pre-season weeks

/** One upgrade per club and week: a clearly better player for one of its roles (weakest first), from the market or another AI club. */
export function aiUpgrades(state: GameState, data: GameData): void {
  if (!transferWindowOpen(state)) return;
  for (const club of state.aiClubs) {
    if (club.roster.length >= data.economy.maxRoster) continue;
    const style = aiStyle(data, club);
    const budget = aiWageBudget(state, data, club);
    const fits = (p: Player, fee: number) => payroll(state, club) + p.salaryPerWeek <= budget && fee <= spendable(state, data, club, p.salaryPerWeek);
    const others = state.aiClubs.filter((c) => c.id !== club.id && c.roster.length > data.economy.minRoster);
    for (const role of rolesByWeakness(state, data, club)) {
      const bar = bestAt(state, style, club, role) + style.upgradeMargin;
      const free = state.market.map((id) => state.players[id]!).filter((p) => p.primaryRole === role && aiEval(style, p) >= bar && fits(p, p.signingFee))
        .sort((a, b) => aiEval(style, b) - aiEval(style, a) || a.id.localeCompare(b.id))[0];
      if (free) { signForAi(state, data, club, free); break; }
      const buy = others.flatMap((c) => rosterOf(state, c.id).map((p) => ({ p, seller: c, fee: askingPrice(state, data, p.id) })))
        .filter(({ p, fee }) => p.primaryRole === role && aiEval(style, p) >= bar && fits(p, fee))
        .sort((a, b) => aiEval(style, b.p) - aiEval(style, a.p) || a.p.id.localeCompare(b.p.id))[0];
      if (buy) { completeTransfer(state, buy.p.id, buy.seller, club, buy.fee); break; }
    }
  }
}

/** Clubs in debt release their most expensive bench player when that saves money. */
export function aiCutCosts(state: GameState, data: GameData): void {
  if (!transferWindowOpen(state)) return;
  for (const club of state.aiClubs) {
    if (club.funds >= 0 || club.roster.length <= data.economy.minRoster) continue;
    const starters = starterIds(state, data, club);
    const bench = rosterOf(state, club.id).filter((p) => !starters.has(p.id))
      .map((p) => ({ p, saving: p.salaryPerWeek * remainingContractWeeks(state, data, p) - releaseFeeFor(state, data, p) }))
      .filter((x) => x.saving > 0)
      .sort((a, b) => b.saving - a.saving || a.p.id.localeCompare(b.p.id))[0];
    if (!bench) continue;
    club.funds -= releaseFeeFor(state, data, bench.p);
    club.roster = club.roster.filter((id) => id !== bench.p.id);
    state.market.push(bench.p.id);
    bench.p.clubId = null;
    delete bench.p.contractUntil;
  }
}

/** Weekly AI business in the transfer window. */
export function aiPreseasonWeek(state: GameState, data: GameData): void {
  aiCutCosts(state, data);
  aiSignFreeAgents(state, data);
  aiUpgrades(state, data);
}

// ---------------------------------------------------------------------------
// Match day

/** The players an AI club brings: very tired starters sit out when a fresh player of the same role is available. */
export function aiMatchSquad(state: GameState, data: GameData, club: ClubState): Player[] {
  const style = aiStyle(data, club);
  const roster = rosterOf(state, club.id);
  const fresh = (p: Player) => (p.fatigue ?? 0) < style.rotateFatigue;
  const squad = roster.filter((p) => fresh(p) || !roster.some((q) => q.id !== p.id && q.primaryRole === p.primaryRole && fresh(q)));
  return squad.length >= 5 ? squad : roster;
}

/** The club's own tactic; after a losing streak it tries the next one. Random-style clubs pick per match. */
export function aiTactic(state: GameState, data: GameData, club: ClubState, fixtureSeed: number): Tactic {
  if (club.style === 'PLAYER') return 'STEADY_MACRO';
  const base = club.style === 'RANDOM' ? createRng(fixtureSeed).fork(`tactic:${club.id}`).pick(TACTICS) : club.style;
  const n = data.ai.slumpLosses;
  const mine = state.results.filter((r) => r.blue === club.id || r.red === club.id).slice(-n);
  if (mine.length === n && mine.every((r) => r.winner !== club.id)) return TACTICS[(TACTICS.indexOf(base) + 1) % TACTICS.length]!;
  return base;
}
