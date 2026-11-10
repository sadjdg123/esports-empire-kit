import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { STAFF_ROLES } from '../../src/core/types';
import {
  PLAYER_CLUB_ID, advanceDay, commitMatchDay, hireStaff, moneyBreakdown, newGame, reportWeeks, seasonReport, staffWeek, standings, weekReport, type GameState,
} from '../../src/game';

const data = loadGameData();

/** A club run by staff with full control, played up to `rounds` match days (or the whole season). */
function staffedClub(rounds = Infinity): GameState {
  const s = newGame('报表', '#3a7bd5', 31, data);
  s.funds = 150000;
  for (const role of STAFF_ROLES) {
    const c = s.staffMarket.map((id) => s.staff[id]!).find((x) => x.role === role)!;
    hireStaff(s, data, c.id);
    s.delegation.roles[role].authority = 'FULL';
  }
  staffWeek(s, data);
  let played = 0;
  for (let g = 0; g < 400 && s.calendar.phase !== 'FINISHED' && played < rounds; g++) {
    if (advanceDay(s, data).pause !== 'MATCH_DAY') continue;
    const c = commitMatchDay(s, data);
    if (!c.ok) throw new Error(c.error);
    played++;
  }
  return s;
}

describe('group reports (T33)', () => {
  it('a breakdown adds up to the ledger', () => {
    const s = staffedClub(4);
    const m = moneyBreakdown(s.ledger);
    const sum = s.ledger.reduce((a, e) => a + e.amount, 0);
    expect(m.net).toBe(sum);
    expect(m.totalIncome).toBe(Object.values(m.income).reduce((a, v) => a + v, 0));
    expect(m.totalExpense).toBe(Object.values(m.expense).reduce((a, v) => a + v, 0));
    expect(m.totalExpense).toBeLessThanOrEqual(0);
  });

  it('the weeks add up to the season, and the season to the money in the bank', () => {
    const s = staffedClub();
    const r = seasonReport(s);
    expect(r.fundsStart + r.money.net).toBeCloseTo(s.funds, 6);
    expect(r.fundsNow).toBe(s.funds);
    const weeks = reportWeeks(s);
    expect(weeks).toEqual([...weeks].sort((a, b) => b - a));
    const byWeek = weeks.reduce((a, w) => a + weekReport(s, w).money.net, 0);
    expect(byWeek).toBeCloseTo(r.money.net, 6);
    // each week's decisions are that week's, under the right role
    for (const w of weeks) {
      const wr = weekReport(s, w);
      for (const role of STAFF_ROLES) for (const e of wr.decisions[role]) { expect(e.role).toBe(role); expect(Math.floor(e.day / 7)).toBe(w); }
    }
    const all = weeks.reduce((a, w) => a + STAFF_ROLES.reduce((b, role) => b + weekReport(s, w).decisions[role].length, 0), 0);
    expect(all).toBe(s.decisionLog.filter((e) => e.season === s.calendar.season).length);
  }, 240_000);

  it('the season record and each staff member\'s numbers', () => {
    const s = staffedClub();
    const r = seasonReport(s);
    const row = standings(s).find((x) => x.clubId === PLAYER_CLUB_ID)!;
    expect(r.wins + r.losses).toBeGreaterThanOrEqual(row.played);
    const manager = r.staff.find((p) => p.role === 'MANAGER')!;
    const signs = s.decisionLog.filter((e) => e.season === s.calendar.season && e.role === 'MANAGER' && e.kind === 'SIGN' && e.status === 'DONE');
    expect(manager.signings).toHaveLength(signs.length);
    expect(manager.signings.length).toBeGreaterThanOrEqual(5);
    for (const g of manager.signings) { expect(g.wins).toBeLessThanOrEqual(g.played); expect(g.played).toBeLessThanOrEqual(r.wins + r.losses); }
    expect(manager.signings.some((g) => g.played > 0)).toBe(true);
    expect(manager.spent).toBe(signs.reduce((a, e) => a + e.cost, 0) + s.decisionLog.filter((e) => e.season === s.calendar.season && e.role === 'MANAGER' && e.kind !== 'SIGN' && e.status === 'DONE' && e.cost < 0).reduce((a, e) => a + e.cost, 0));
    const coach = r.staff.find((p) => p.role === 'COACH')!;
    expect(coach.plans).toBeGreaterThan(0);
    expect(coach.planWins).toBeLessThanOrEqual(coach.plans);
    const finance = r.staff.find((p) => p.role === 'FINANCE')!;
    expect(finance.lowestFunds).toBeLessThanOrEqual(Math.min(r.fundsStart, s.funds));
  }, 240_000);

  it('no staff, no decisions: the report still works', () => {
    const s = newGame('x', '#fff', 2, data);
    const r = seasonReport(s);
    expect(r.staff.every((p) => p.staffName === null && p.done === 0)).toBe(true);
    expect(weekReport(s).money.net).toBe(0);
  });
});

describe('reports per division (T40)', () => {
  it('the divisions add up to the whole ledger', async () => {
    const { moneyByDivision } = await import('../../src/game');
    const s = staffedClub(2);
    s.ledger.push({ week: 1, kind: 'SALARY', amount: -700, note: 'x', branch: 'FPS' }, { week: 1, kind: 'LEAGUE', amount: 300, note: 'x', branch: 'CARD' });
    const parts = moneyByDivision(s.ledger);
    expect(parts.map((p) => p.division)).toEqual(['MOBA', 'FPS', 'CARD']);
    expect(parts.reduce((a, p) => a + p.money.net, 0)).toBe(moneyBreakdown(s.ledger).net);
    expect(parts[1]!.money.net).toBe(-700);
    expect(moneyByDivision(s.ledger.filter((e) => !e.branch)).map((p) => p.division)).toEqual(['MOBA']);
  });
});
