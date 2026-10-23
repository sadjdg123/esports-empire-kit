import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import {
  PLAYER_CLUB_ID, advanceDay, aiEval, aiMatchSquad, aiStyle, aiTactic, aiUpgrades, aiWageBudget, autoManage, autoTraining,
  commitMatchDay, newGame, playerOverall, refreshTalent, rosterOf, type FixtureResult, type GameState,
} from '../../src/game';

const data = loadGameData();

function playSeasons(s: GameState, n: number, each?: (s: GameState) => void): void {
  for (let k = 0; k < n; k++) {
    autoManage(s, data, 'balanced');
    for (let guard = 0; guard < 400 && s.calendar.phase !== 'FINISHED'; guard++) {
      autoTraining(s);
      each?.(s);
      if (advanceDay(s, data).pause !== 'MATCH_DAY') continue;
      let c = commitMatchDay(s, data);
      if (!c.ok) { autoManage(s, data, 'balanced'); c = commitMatchDay(s, data); }
      if (!c.ok) throw new Error(c.error);
    }
    advanceDay(s, data);
  }
}

const totalMoney = (s: GameState) => s.funds + s.aiClubs.reduce((a, c) => a + c.funds, 0);

describe('AI club valuation and budget', () => {
  it('youth clubs value young potential more; old players are worth less to everyone', () => {
    const young = { ...structuredClone(data.players[0]!), age: 18, potential: 90 };
    const old = { ...structuredClone(data.players[0]!), age: 31, potential: 50 };
    const youth = data.ai.styles.YOUTH;
    const rich = data.ai.styles.RICH;
    expect(aiEval(youth, young) - aiEval(rich, young)).toBeGreaterThan(5);
    expect(aiEval(youth, old)).toBeLessThan(playerOverall(old));
  });

  it('a richer club allows itself a bigger payroll', () => {
    const s = newGame('t', '#fff', 1, data);
    const c = s.aiClubs[0]!;
    c.funds = 0;
    const poor = aiWageBudget(s, data, c);
    c.funds = 2_000_000;
    expect(aiWageBudget(s, data, c)).toBeGreaterThan(poor * 1.5);
  });
});

describe('AI club business', () => {
  it('upgrades in the window only, keep money conserved between clubs, and never take a club below 5', () => {
    const s = newGame('t', '#fff', 2, data);
    for (const c of s.aiClubs) c.funds = 3_000_000;
    s.market = []; // only club-to-club deals
    const before = totalMoney(s);
    for (let i = 0; i < 6; i++) aiUpgrades(s, data);
    expect(totalMoney(s)).toBe(before);
    for (const c of s.aiClubs) expect(c.roster.length).toBeGreaterThanOrEqual(data.economy.minRoster);
    for (const c of s.aiClubs) for (const id of c.roster) expect(s.players[id]!.clubId).toBe(c.id);
    while (s.calendar.phase === 'PRESEASON') advanceDay(s, data);
    const rosters = JSON.stringify(s.aiClubs.map((c) => c.roster));
    aiUpgrades(s, data);
    expect(JSON.stringify(s.aiClubs.map((c) => c.roster))).toBe(rosters);
  });

  it('rests very tired starters when a fresh player of the same role is on the bench', () => {
    const s = newGame('t', '#fff', 3, data);
    const club = s.aiClubs.find((c) => {
      const roles = rosterOf(s, c.id).map((p) => p.primaryRole);
      return roles.some((r, i) => roles.indexOf(r) !== i);
    })!;
    const roster = rosterOf(s, club.id);
    const dup = roster.find((p, i) => roster.findIndex((q) => q.primaryRole === p.primaryRole) !== i)!;
    const first = roster.find((p) => p.primaryRole === dup.primaryRole && p.id !== dup.id)!;
    first.fatigue = 95;
    dup.fatigue = 0;
    const squad = aiMatchSquad(s, data, club).map((p) => p.id);
    expect(squad).not.toContain(first.id);
    expect(squad).toContain(dup.id);
    dup.fatigue = 95; // nobody fresh: both play rather than leaving a hole
    expect(aiMatchSquad(s, data, club).length).toBe(roster.length);
  });

  it('switches tactic after a losing streak', () => {
    const s = newGame('t', '#fff', 4, data);
    const club = s.aiClubs.find((c) => c.style !== 'RANDOM')!;
    const base = aiTactic(s, data, club, 1);
    const loss = (i: number): FixtureResult => ({
      round: i, index: 0, blue: club.id, red: PLAYER_CLUB_ID, winner: PLAYER_CLUB_ID, winnerSide: 'RED', durationSec: 1200,
      kills: { blue: 0, red: 0 }, blueTactic: base, redTactic: 'STEADY_MACRO', checksum: '',
    });
    for (let i = 0; i < data.ai.slumpLosses; i++) s.results.push(loss(i));
    expect(aiTactic(s, data, club, 1)).not.toBe(base);
  });

  it('every AI club has a style with sensible numbers', () => {
    const s = newGame('t', '#fff', 5, data);
    for (const c of s.aiClubs) expect(aiStyle(data, c).rosterTarget).toBeGreaterThanOrEqual(data.economy.minRoster);
  });
});

describe('talent supply', () => {
  it('a new class joins each season; old free agents leave; the market stays bounded', () => {
    const s = newGame('t', '#fff', 6, data);
    const old = s.market[0]!;
    s.players[old]!.age = data.ai.talent.freeAgentLeaveAge;
    s.calendar.season = 2;
    const r = refreshTalent(s, data);
    expect(r.joined).toBe(data.ai.talent.intakePerRole * 5);
    expect(s.players[old]).toBeUndefined();
    expect(s.market).not.toContain(old);
    expect(s.market.length).toBeLessThanOrEqual(data.ai.talent.marketCap);
    const fresh = Object.values(s.players).filter((p) => p.id.startsWith('yt_s2_'));
    expect(fresh).toHaveLength(r.joined);
    expect(new Set(Object.values(s.players).map((p) => p.name)).size).toBe(Object.keys(s.players).length);
    for (const p of fresh) {
      expect(p.age).toBeGreaterThanOrEqual(data.ai.talent.ageMin);
      expect(p.age).toBeLessThanOrEqual(data.ai.talent.ageMax);
      expect(p.potential!).toBeGreaterThan(playerOverall(p));
      expect(Object.keys(p.heroMastery).length).toBeGreaterThan(0);
    }
  });
});

describe('a league over several seasons', () => {
  it('AI clubs always field 5 players, stay solvent within limits, and the title moves around', () => {
    const s = newGame('多赛季', '#3a7bd5', 7, data);
    const start = Object.fromEntries(s.aiClubs.map((c) => [c.id, c.funds]));
    let minRoster = 99;
    playSeasons(s, 6, (st) => { for (const c of st.aiClubs) minRoster = Math.min(minRoster, c.roster.length); });
    expect(minRoster).toBeGreaterThanOrEqual(data.economy.minRoster);
    for (const c of s.aiClubs) {
      expect(c.funds / start[c.id]!).toBeGreaterThan(-1);
      expect(c.funds / start[c.id]!).toBeLessThan(5);
    }
    expect(new Set(s.history.map((h) => h.champion)).size).toBeGreaterThanOrEqual(2);
  }, 300_000);
});
