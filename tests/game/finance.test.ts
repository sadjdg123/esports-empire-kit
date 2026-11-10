import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import {
  PLAYER_CLUB_ID, activeSponsor, advanceDay, applyMatchFinance, autoManage, autoTraining, bidForPlayer, cashForecast, commitMatchDay,
  financeSummary, newGame, rescueOptions, signPlayer, signSponsor, sponsorOffers, weeklyMoney, type FixtureResult, type GameState,
} from '../../src/game';

const data = loadGameData();
const f = data.economy.finance;

function ready(seed = 1): GameState {
  const s = newGame('财务测试', '#3a7bd5', seed, data);
  expect(autoManage(s, data, 'balanced').ok).toBe(true);
  return s;
}

const ledgerSum = (s: GameState) => s.ledger.reduce((a, e) => a + e.amount, 0);

function playSeason(s: GameState): void {
  for (let guard = 0; guard < 400 && s.calendar.phase !== 'FINISHED'; guard++) {
    autoTraining(s);
    if (advanceDay(s, data).pause === 'MATCH_DAY') {
      const c = commitMatchDay(s, data);
      if (!c.ok) throw new Error(c.error);
    }
  }
}

describe('sponsors', () => {
  it('better sponsors need more reputation; one deal at a time; the signing bonus is paid', () => {
    const s = newGame('t', '#fff', 2, data);
    const tier1 = f.sponsorTiers[0]!.sponsors.map((x) => x.id);
    expect(sponsorOffers(s, data).map((x) => x.id)).toEqual(tier1);
    const top = f.sponsorTiers[f.sponsorTiers.length - 1]!.sponsors[0]!;
    expect(signSponsor(s, data, top.id, 1).ok).toBe(false);
    s.club.reputation = 90;
    const funds = s.funds;
    expect(signSponsor(s, data, top.id, 2).ok).toBe(true);
    expect(s.funds).toBe(funds + top.signingBonus);
    expect(activeSponsor(s)?.untilSeason).toBe(2);
    expect(signSponsor(s, data, tier1[0]!, 1).ok).toBe(false); // still under contract
  });

  it('the emergency deal is only offered when money is short, and replaces the current deal', () => {
    const s = ready(3);
    expect(sponsorOffers(s, data).some((x) => x.id === f.emergencySponsor.id)).toBe(false);
    s.funds = 100;
    expect(financeSummary(s, data).lowFunds).toBe(true);
    expect(rescueOptions(s, data).length).toBeGreaterThan(1);
    expect(signSponsor(s, data, f.emergencySponsor.id, 1).ok).toBe(true);
    expect(s.funds).toBe(100 + f.emergencySponsor.signingBonus);
    expect(activeSponsor(s)?.sponsorId).toBe(f.emergencySponsor.id);
    expect(activeSponsor(s)?.untilSeason).toBe(1);
  });

  it('a club without a deal gets one automatically when the league starts', () => {
    const s = newGame('t', '#fff', 4, data);
    for (let i = 0; i < 5; i++) signPlayer(s, data, s.market[i]!);
    while (s.calendar.phase === 'PRESEASON') advanceDay(s, data);
    expect(activeSponsor(s)).not.toBeNull();
    expect(s.inbox.some((m) => m.title.startsWith('自动签下赞助'))).toBe(true);
  });
});

describe('weekly money', () => {
  it('pay day books salaries, sponsor, league share, merchandise and training; the ledger explains every coin', () => {
    const s = ready(5);
    const start = s.funds - ledgerSum(s);
    while (s.calendar.phase === 'PRESEASON' || s.calendar.day % 7 !== 6) {
      if (advanceDay(s, data).pause === 'MATCH_DAY') commitMatchDay(s, data);
    }
    s.training = 'MECHANICS';
    const m = weeklyMoney(s, data);
    expect(m.league).toBe(f.leagueShareWeekly);
    expect(m.training).toBe(s.club.roster.length * f.trainingCostPerPlayer);
    const before = s.ledger.length;
    while (s.calendar.day % 7 !== 0) {
      const r = advanceDay(s, data);
      if (r.pause === 'MATCH_DAY') commitMatchDay(s, data);
    }
    const kinds = s.ledger.slice(before).map((e) => e.kind);
    for (const k of ['SALARY', 'SPONSOR', 'LEAGUE', 'MERCH', 'TRAINING']) expect(kinds).toContain(k);
    s.training = 'REST';
    expect(weeklyMoney(s, data).training).toBe(0);
    expect(s.funds).toBe(start + ledgerSum(s));
  });

  it('there is no league share in the pre-season', () => {
    const s = ready(6);
    expect(weeklyMoney(s, data).league).toBe(0);
  });

  it('the 4-week forecast adds up and includes facility upkeep and staff wages', () => {
    const s = ready(7);
    s.funds = 250000;
    s.club.facilities.TRAINING = 2;
    const candidate = s.staffMarket[0]!;
    const staffSalary = s.staff[candidate]!.salaryPerWeek;
    s.delegation.roles[s.staff[candidate]!.role].staffId = candidate;
    s.staffMarket = s.staffMarket.filter((id) => id !== candidate);
    while (s.calendar.phase === 'PRESEASON') advanceDay(s, data);
    const m = weeklyMoney(s, data);
    expect(m.upkeep).toBeGreaterThan(0);
    expect(m.staff).toBe(staffSalary);
    const rows = cashForecast(s, data);
    expect(rows).toHaveLength(f.forecastWeeks);
    let funds = s.funds;
    for (const r of rows) {
      expect(r.expense).toBe(-(m.salaries + m.training + m.upkeep + m.staff));
      funds += r.income + r.expense;
      expect(r.fundsAfter).toBe(Math.round(funds));
      expect(r.matches).toBe(1);
    }
  });
});

describe('reputation and prizes', () => {
  it('wins raise reputation, losing streaks cost extra', () => {
    const s = newGame('t', '#fff', 8, data);
    const a = s.aiClubs[0]!;
    const b = s.aiClubs[1]!;
    const game = (winner: string): FixtureResult => ({
      round: s.results.length, index: 0, blue: a.id, red: b.id, winner, winnerSide: winner === a.id ? 'BLUE' : 'RED',
      durationSec: 1200, kills: { blue: 0, red: 0 }, blueTactic: 'STEADY_MACRO', redTactic: 'STEADY_MACRO', checksum: '',
    });
    const [ra, rb, fa, fb] = [a.reputation, b.reputation, a.funds, b.funds];
    const r1 = game(a.id); s.results.push(r1); applyMatchFinance(s, data, r1, 'LEAGUE');
    expect(a.reputation).toBeCloseTo(ra + f.reputation.win, 5);
    expect(b.reputation).toBeCloseTo(rb + f.reputation.loss, 5);
    expect(a.funds).toBeGreaterThan(fa + data.economy.prizeWin - 1);
    expect(b.funds).toBe(fb + data.economy.prizeLoss);
    const r2 = game(a.id); s.results.push(r2); applyMatchFinance(s, data, r2, 'LEAGUE');
    const before = b.reputation;
    const r3 = game(a.id); s.results.push(r3); applyMatchFinance(s, data, r3, 'LEAGUE');
    expect(b.reputation).toBeCloseTo(before + f.reputation.loss + f.reputation.streakLoss, 5);
  });

  it('a whole season: playoff prizes paid, the champion gains reputation, AI clubs keep books', () => {
    const s = ready(9);
    const aiFunds = s.aiClubs.map((c) => c.funds);
    const start = s.funds - ledgerSum(s);
    playSeason(s);
    const champ = s.history[0]!.champion!;
    expect(champ).toBeTruthy();
    if (champ === PLAYER_CLUB_ID) expect(s.ledger.some((e) => e.note === '总冠军奖金' && e.amount === f.playoffPrize.champion)).toBe(true);
    expect(s.aiClubs.map((c) => c.funds)).not.toEqual(aiFunds);
    expect(s.funds).toBe(start + ledgerSum(s));
    expect(s.history[0]!.fundsEnd).toBe(s.funds);
  }, 60_000);

  it('the normal manager stays solvent over a season', () => {
    for (const seed of [11, 12, 13]) {
      const s = ready(seed);
      playSeason(s);
      const ratio = s.funds / s.startingFunds;
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(1.8);
    }
  }, 120_000);
});

describe('no money, no shopping', () => {
  it('negative funds block buying; signing only when short of a team and only cheap players', () => {
    const s = ready(14);
    s.funds = -5000;
    const target = s.aiClubs[0]!.roster[0]!;
    expect(bidForPlayer(s, data, target, 1000).ok).toBe(false);
    const cheap = s.market.find((id) => s.players[id]!.salaryPerWeek <= f.emergencySigningMaxSalary)!;
    expect(signPlayer(s, data, cheap).ok).toBe(false); // the team is complete
  });
});
