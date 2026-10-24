import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import type { Authority, StaffRole } from '../../src/core/types';
import {
  PLAYER_CLUB_ID, advanceDay, coachMatchDay, coachTraining, commitMatchDay, financeWeek, hireStaff, managerWeek, newGame, protectedPlayers,
  rosterOf, runPending, signValueSquad, staffWeek, type GameState,
} from '../../src/game';

const data = loadGameData();

/** A new club (no players yet) with one staff member per listed role, at the given skill. */
function club(roles: Partial<Record<StaffRole, Authority>>, skill = 80, seed = 21): GameState {
  const s = newGame('委任', '#3a7bd5', seed, data);
  s.funds = 200000;
  for (const [role, authority] of Object.entries(roles) as [StaffRole, Authority][]) {
    const c = s.staffMarket.map((id) => s.staff[id]!).find((x) => x.role === role)!;
    expect(hireStaff(s, data, c.id).ok).toBe(true);
    c.skills = { scouting: skill, leading: skill, money: skill };
    s.delegation.roles[role].authority = authority;
  }
  return s;
}

function playSeason(s: GameState): void {
  for (let g = 0; g < 400 && s.calendar.phase !== 'FINISHED'; g++) {
    if (advanceDay(s, data).pause === 'MATCH_DAY') { const c = commitMatchDay(s, data); if (!c.ok) throw new Error(c.error); }
  }
}

describe('manager (T31)', () => {
  it('"full control" fills every missing role and logs why', () => {
    const s = club({ MANAGER: 'FULL' });
    managerWeek(s, data);
    expect(new Set(rosterOf(s).map((p) => p.primaryRole)).size).toBe(5);
    const signs = s.decisionLog.filter((e) => e.kind === 'SIGN');
    expect(signs).toHaveLength(5);
    for (const e of signs) expect(e).toMatchObject({ role: 'MANAGER', status: 'DONE' });
    expect(signs[0]!.reason).toContain('队里没有');
    expect(signs[0]!.cost).toBeLessThan(0);
  });

  it('"run it myself" only gives advice and changes nothing', () => {
    const s = club({ MANAGER: 'SELF' });
    s.delegation.roles.MANAGER.authority = 'SELF';
    const funds = s.funds;
    managerWeek(s, data);
    managerWeek(s, data); // the same advice is not repeated in a week
    expect(s.club.roster).toHaveLength(0);
    expect(s.funds).toBe(funds);
    expect(s.decisionLog.filter((e) => e.status === 'ADVICE')).toHaveLength(5);
    expect(s.pending).toHaveLength(0);
  });

  it('"small things alone": within the limit it acts, above it the player decides', () => {
    const s = club({ MANAGER: 'SMALL' });
    s.delegation.limit = 0;
    managerWeek(s, data);
    expect(s.club.roster).toHaveLength(0);
    expect(s.pending.length).toBe(5);
    expect(s.pending.every((p) => p.kind === 'SIGN' && !p.big)).toBe(true);
    managerWeek(s, data); // no duplicates
    expect(s.pending.length).toBe(5);
    expect(runPending(s, data, s.pending[0]!).ok).toBe(true);
    expect(s.club.roster).toHaveLength(1);

    const t = club({ MANAGER: 'SMALL' });
    t.delegation.limit = 1_000_000;
    managerWeek(t, data);
    expect(t.club.roster).toHaveLength(5);
    expect(t.pending).toHaveLength(0);
  });

  it('never sells a protected core player on its own, even with full control', () => {
    const s = club({ MANAGER: 'FULL' });
    managerWeek(s, data);
    managerWeek(s, data); // a sixth player so a sale leaves a full team
    const extra = Object.values(s.players).find((p) => !p.clubId && s.market.includes(p.id) && p.signingFee < s.funds)!;
    s.market = s.market.filter((id) => id !== extra.id);
    s.club.roster.push(extra.id); extra.clubId = PLAYER_CLUB_ID;
    const star = [...protectedPlayers(s)][0]!;
    const buyer = s.aiClubs[0]!.id;
    s.offers.push({ id: 900, season: 1, day: 0, buyer, seller: PLAYER_CLUB_ID, playerId: star, fee: 10_000_000, status: 'PENDING' });
    managerWeek(s, data);
    expect(s.club.roster).toContain(star);
    expect(s.pending.find((p) => p.kind === 'SELL')).toMatchObject({ big: true });
  });
});

describe('coach (T31)', () => {
  it('a good coach rests a tired squad and otherwise trains the weakest attribute', () => {
    const s = club({ MANAGER: 'FULL', COACH: 'FULL' }, 100);
    managerWeek(s, data);
    for (const p of rosterOf(s)) p.fatigue = 80;
    coachTraining(s, data);
    expect(s.training).toBe('REST');
    for (const p of rosterOf(s)) { p.fatigue = 0; p.attrs.teamwork = 1; }
    coachTraining(s, data);
    expect(s.training).toBe('TEAMWORK');
    expect(s.decisionLog.filter((e) => e.kind === 'TRAINING').map((e) => e.status)).toEqual(['DONE', 'DONE']);
  });

  it('a weak coach slips more often than a good one', () => {
    const slips = (skill: number) => {
      let n = 0;
      for (let seed = 0; seed < 60; seed++) {
        const s = club({ MANAGER: 'FULL', COACH: 'FULL' }, skill, 500 + seed);
        managerWeek(s, data);
        for (const p of rosterOf(s)) p.fatigue = 80;
        s.training = 'MECHANICS';
        coachTraining(s, data);
        if ((s.training as string) !== 'REST') n++;
      }
      return n;
    };
    expect(slips(100)).toBe(0);
    expect(slips(10)).toBeGreaterThan(5);
  });

  it('match day: sets a valid lineup with a tactic', () => {
    const s = club({ MANAGER: 'FULL', COACH: 'FULL' }, 100);
    managerWeek(s, data);
    s.lineup = null;
    for (let g = 0; g < 60 && advanceDay(s, data).pause !== 'MATCH_DAY'; g++);
    coachMatchDay(s, data);
    expect((s as GameState).lineup?.picks).toHaveLength(5);
    expect(commitMatchDay(s, data).ok).toBe(true);
    expect(s.decisionLog.some((e) => e.kind === 'TACTIC')).toBe(true);
  });
});

describe('finance (T31)', () => {
  it('signs a sponsor when there is none', () => {
    const s = club({ FINANCE: 'FULL' });
    signValueSquad(s, data);
    s.sponsor = null as never;
    financeWeek(s, data);
    expect(s.sponsor).toBeTruthy();
    expect(s.decisionLog.find((e) => e.kind === "SPONSOR")).toMatchObject({ role: "FINANCE", status: "DONE" });
  });

  it('does not upgrade rooms while the team is incomplete', () => {
    const s = club({ FINANCE: 'FULL' });
    s.funds = 5_000_000;
    financeWeek(s, data);
    expect(s.decisionLog.some((e) => e.kind === 'FACILITY')).toBe(false);
  });
});

describe('a club run by staff (T31)', () => {
  it('plays a whole season by itself, and the same seed gives the same decisions', () => {
    const run = () => {
      const s = club({ MANAGER: 'FULL', COACH: 'FULL', FINANCE: 'FULL' }, 70, 77);
      s.funds = 100000;
      staffWeek(s, data);
      playSeason(s);
      return s;
    };
    const a = run();
    const b = run();
    expect(a.calendar.phase).toBe('FINISHED');
    expect(a.club.roster.length).toBeGreaterThanOrEqual(5);
    expect(a.decisionLog.length).toBeGreaterThan(10);
    expect(a.decisionLog).toEqual(b.decisionLog);
    expect(a.funds).toBe(b.funds);
    expect(a.decisionLog.some((e) => e.kind === 'SIGN' && e.result)).toBe(true); // results filled in at the season's end
  }, 240_000);
});
