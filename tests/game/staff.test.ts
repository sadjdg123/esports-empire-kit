import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import type { StaffRole } from '../../src/core/types';
import {
  advanceDay, commitMatchDay, fireStaff, hireStaff, hiredStaff, mainSkill, newGame, refreshStaffMarket, renewStaff, runPayDay, setAuthority,
  signValueSquad, staffReleaseFee, startNewSeason, weeklyMoney, type GameState,
} from '../../src/game';

const data = loadGameData();
const m = data.staff.market;

function game(seed = 3): GameState {
  const s = newGame('负责人', '#3a7bd5', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  s.funds = 200000;
  return s;
}
const first = (s: GameState, role: StaffRole) => s.staffMarket.map((id) => s.staff[id]!).find((x) => x.role === role)!;
function playSeason(s: GameState): void {
  for (let g = 0; g < 400 && s.calendar.phase !== 'FINISHED'; g++) {
    if (advanceDay(s, data).pause === 'MATCH_DAY') { const c = commitMatchDay(s, data); if (!c.ok) throw new Error(c.error); }
  }
}

describe('staff candidates (T30)', () => {
  it('a new game offers candidates for every role, the same for the same seed, without touching the game\'s random numbers', () => {
    const a = newGame('x', '#fff', 11, data);
    const b = newGame('x', '#fff', 11, data);
    expect(a.staffMarket).toHaveLength(m.perRole * 3);
    expect(a.staffMarket.map((id) => a.staff[id])).toEqual(b.staffMarket.map((id) => b.staff[id]));
    const before = [...a.rngState];
    refreshStaffMarket(a, data);
    expect(a.rngState).toEqual(before);
    for (const role of ['MANAGER', 'COACH', 'FINANCE'] as const) expect(a.staffMarket.filter((id) => a.staff[id]!.role === role)).toHaveLength(m.perRole);
  });

  it('skills stay in range; salary follows the role\'s main skill', () => {
    const s = newGame('x', '#fff', 5, data);
    for (const id of s.staffMarket) {
      const c = s.staff[id]!;
      for (const v of Object.values(c.skills)) { expect(v).toBeGreaterThanOrEqual(m.skillMin); expect(v).toBeLessThanOrEqual(100); }
      const expected = Math.round((m.salaryBase + Math.max(0, mainSkill(data, c) - m.skillMin) * m.salaryPerSkill) / 10) * 10;
      expect(c.salaryPerWeek).toBe(expected);
      expect(c.signingFee).toBe(c.salaryPerWeek * m.signingFeeWeeks);
    }
  });
});

describe('hiring and firing (T30)', () => {
  it('hiring pays the fee, fills the role and starts on "small things alone"', () => {
    const s = game();
    const c = first(s, 'COACH');
    const before = s.funds;
    expect(hireStaff(s, data, c.id).ok).toBe(true);
    expect(s.funds).toBe(before - c.signingFee);
    expect(s.ledger.at(-1)).toMatchObject({ kind: 'STAFF', amount: -c.signingFee });
    expect(s.delegation.roles.COACH).toEqual({ staffId: c.id, authority: 'SMALL' });
    expect(s.staffMarket).not.toContain(c.id);
    expect(hireStaff(s, data, first(s, 'COACH').id).ok).toBe(false); // one per role
  });

  it('refuses without the money', () => {
    const s = game();
    s.funds = 10;
    expect(hireStaff(s, data, first(s, 'MANAGER').id).ok).toBe(false);
    expect(s.delegation.roles.MANAGER.staffId).toBeNull();
  });

  it('wages are paid every pay day', () => {
    const s = game();
    const c = first(s, 'FINANCE');
    hireStaff(s, data, c.id);
    expect(weeklyMoney(s, data).staff).toBe(c.salaryPerWeek);
    runPayDay(s, data);
    expect(s.ledger.find((e) => e.kind === 'STAFF' && e.note === '负责人工资')!.amount).toBe(-c.salaryPerWeek);
  });

  it('firing pays part of the rest of the contract and gives the role back', () => {
    const s = game();
    const c = first(s, 'MANAGER');
    hireStaff(s, data, c.id);
    const fee = staffReleaseFee(s, data, c);
    expect(fee).toBeGreaterThan(0);
    const before = s.funds;
    expect(fireStaff(s, data, 'MANAGER')).toEqual({ ok: true, value: fee });
    expect(s.funds).toBe(before - fee);
    expect(s.delegation.roles.MANAGER).toEqual({ staffId: null, authority: 'SELF' });
    expect(s.staff[c.id]).toBeUndefined();
  });

  it('a role without anybody can only be run by the player', () => {
    const s = game();
    expect(setAuthority(s, 'COACH', 'FULL').ok).toBe(false);
    hireStaff(s, data, first(s, 'COACH').id);
    expect(setAuthority(s, 'COACH', 'FULL').ok).toBe(true);
    expect(s.delegation.roles.COACH.authority).toBe('FULL');
  });
});

describe('staff over seasons (T30)', () => {
  it('a new batch each off-season; the hire stays until the contract ends, can renew in the last season', () => {
    const s = game(6);
    const c = first(s, 'COACH');
    hireStaff(s, data, c.id);
    const oldCandidates = [...s.staffMarket];
    expect(renewStaff(s, data, 'COACH').ok).toBe(m.contractYears === 1);
    for (let season = 1; season < m.contractYears; season++) { playSeason(s); startNewSeason(s, data); signValueSquad(s, data); }
    expect(s.staffMarket.some((id) => oldCandidates.includes(id))).toBe(false);
    expect(oldCandidates.every((id) => !s.staff[id])).toBe(true);
    expect(hiredStaff(s, 'COACH')?.id).toBe(c.id);
    expect(hiredStaff(s, 'COACH')!.hired!.until).toBe(s.calendar.season); // last season
    s.funds = 200000;
    expect(renewStaff(s, data, 'COACH').ok).toBe(true);
    playSeason(s);
    startNewSeason(s, data);
    expect(hiredStaff(s, 'COACH')?.id).toBe(c.id);
  }, 240_000);

  it('without renewal the staff member leaves when the contract ends', () => {
    const s = game(7);
    hireStaff(s, data, first(s, 'FINANCE').id);
    for (let season = 0; season < m.contractYears; season++) { playSeason(s); startNewSeason(s, data); signValueSquad(s, data); }
    expect(s.delegation.roles.FINANCE).toEqual({ staffId: null, authority: 'SELF' });
    expect(s.inbox.some((x) => x.title.includes('合同到期离开'))).toBe(true);
  }, 240_000);

  it('a strong player who just retired may become a coach candidate', () => {
    const s = game();
    const p = structuredClone(s.players[s.club.roster[0]!]!);
    p.career = [{ season: 1, clubId: 'x', clubName: 'x', played: 10, wins: 5, champion: false, ovr: m.retiredCoachMinPeak + 5 }];
    refreshStaffMarket(s, data, [p]);
    const coach = s.staffMarket.map((id) => s.staff[id]!).find((x) => x.origin === 'RETIRED')!;
    expect(coach).toMatchObject({ role: 'COACH', name: p.name, formerPlayerId: p.id });
    expect(s.inbox.some((x) => x.title.includes('想当教练'))).toBe(true);
  });
});
