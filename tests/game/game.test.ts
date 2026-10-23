import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { runMatch } from '../../src/sim';
import {
  PLAYER_CLUB_ID, advanceToNextMatch, advanceWeek, commitWeek, financeSummary, marketPlayers, newGame, prepareWeek, readinessIssues,
  recommendLineup, releaseFeeFor, releasePlayer, rosterOf, setLineup, signPlayer, signValueSquad, standings, type GameState,
} from '../../src/game';

const data = loadGameData();

function readyGame(seed = 1): GameState {
  const s = newGame('测试俱乐部', '#3a7bd5', seed, data);
  const r = signValueSquad(s, data);
  expect(r.ok).toBe(true);
  return s;
}

function fundsFromLedger(s: GameState): number {
  return s.startingFunds + s.ledger.reduce((a, e) => a + e.amount, 0);
}

describe('new game', () => {
  it('starts with an empty roster, the full market and a 10-round schedule', () => {
    const s = newGame('门哥电竞', '#ff0000', 7, data);
    expect(s.club.roster).toEqual([]);
    expect(s.market).toHaveLength(30);
    expect(s.funds).toBe(data.economy.startingFunds);
    expect(s.schedule).toHaveLength(10);
    for (const round of s.schedule) {
      expect(round).toHaveLength(3);
      const clubs = round.flatMap((f) => [f.blue, f.red]);
      expect(new Set(clubs).size).toBe(6); // everyone plays exactly once per round
    }
    // every pair meets twice, once on each side
    const pairs = new Map<string, number>();
    for (const f of s.schedule.flat()) {
      const key = [f.blue, f.red].sort().join('|');
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    expect(pairs.size).toBe(15);
    expect([...pairs.values()].every((n) => n === 2)).toBe(true);
  });

  it('builds the same schedule for the same seed and a different one for another seed', () => {
    expect(newGame('a', '#000000', 5, data).schedule).toEqual(newGame('b', '#ffffff', 5, data).schedule);
    expect(newGame('a', '#000000', 5, data).schedule).not.toEqual(newGame('a', '#000000', 6, data).schedule);
  });
});

describe('market', () => {
  it('signing pays the fee and moves the player; releasing pays the release fee and returns them', () => {
    const s = newGame('x', '#000000', 1, data);
    const p = marketPlayers(s)[0]!;
    expect(signPlayer(s, data, p.id).ok).toBe(true);
    expect(s.club.roster).toContain(p.id);
    expect(s.market).not.toContain(p.id);
    expect(s.funds).toBe(data.economy.startingFunds - p.signingFee);
    const fee = releaseFeeFor(s, data, p);
    expect(fee).toBeGreaterThan(0);
    expect(releasePlayer(s, data, p.id).ok).toBe(true);
    expect(s.market).toContain(p.id);
    expect(s.funds).toBe(data.economy.startingFunds - p.signingFee - fee);
    expect(fundsFromLedger(s)).toBe(s.funds);
  });

  it('refuses to sign without money or beyond the roster limit, with a reason', () => {
    const s = newGame('x', '#000000', 1, data);
    s.funds = 10;
    const cap = data.economy.finance.emergencySigningMaxSalary;
    const r = signPlayer(s, data, marketPlayers(s).find((p) => p.salaryPerWeek > cap)!.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('资金不足');
    // Short of 5 players, a cheap player can still be signed into debt so the club can play.
    const cheap = marketPlayers(s).find((p) => p.salaryPerWeek <= cap)!;
    expect(signPlayer(s, data, cheap.id).ok).toBe(true);
    expect(s.funds).toBe(10 - cheap.signingFee);
    expect(releasePlayer(s, data, cheap.id).ok).toBe(false); // cannot pay the release fee
    s.club.roster = [];
    cheap.clubId = null;
    s.market.push(cheap.id);
    s.funds = 1e9;
    const ids = marketPlayers(s).map((p) => p.id);
    for (let i = 0; i < data.economy.maxRoster; i++) expect(signPlayer(s, data, ids[i]!).ok).toBe(true);
    const over = signPlayer(s, data, ids[data.economy.maxRoster]!);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain('队伍已满');
  });

  it('refuses to drop below 5 players during the season', () => {
    const s = readyGame();
    expect(advanceWeek(s, data).ok).toBe(true);
    const r = releasePlayer(s, data, s.club.roster[0]!);
    expect(r.ok).toBe(false);
  });
});

describe('lineup', () => {
  it('cannot play without 5 players and a lineup', () => {
    const s = newGame('x', '#000000', 1, data);
    expect(readinessIssues(s, data).length).toBeGreaterThan(0);
    expect(recommendLineup(s, data).ok).toBe(false);
    expect(advanceWeek(s, data).ok).toBe(false);
  });

  it('rejects illegal lineups and accepts the recommended one', () => {
    const s = readyGame();
    const rec = recommendLineup(s, data);
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;
    const bad = { ...rec.value, picks: rec.value.picks.map((p, i) => (i === 1 ? { ...p, playerId: rec.value.picks[0]!.playerId } : p)) };
    expect(setLineup(s, data, bad).ok).toBe(false);
    expect(setLineup(s, data, rec.value).ok).toBe(true);
    // recommended picks each player's natural role where possible
    for (const pick of rec.value.picks) {
      expect(rosterOf(s).find((p) => p.id === pick.playerId)!.primaryRole).toBe(pick.role);
    }
  });
});

describe('season', () => {
  it('watching the player match then committing equals committing directly', () => {
    const a = readyGame(3);
    advanceToNextMatch(a, data);
    const b = structuredClone(a);
    const prep = prepareWeek(a, data);
    expect(prep.playerMatch).not.toBeNull();
    const watched = runMatch(prep.playerMatch!, data);
    const ra = commitWeek(a, data, watched);
    const rb = commitWeek(b, data);
    expect(ra.ok && rb.ok).toBe(true);
    expect(a).toEqual(b);
  });

  it('prepareWeek does not change the state', () => {
    const s = readyGame(4);
    const before = structuredClone(s);
    prepareWeek(s, data);
    expect(s).toEqual(before);
  });

  it('a full regular season: money is conserved and the table adds up', () => {
    const s = readyGame(5);
    for (let w = 0; w < 10; w++) {
      const r = advanceWeek(s, data);
      expect(r.ok).toBe(true);
      expect(fundsFromLedger(s)).toBeCloseTo(s.funds, 6);
    }
    expect(s.week).toBe(10); // regular season done; playoffs follow
    const table = standings(s);
    expect(table).toHaveLength(6);
    expect(table.reduce((a, r) => a + r.played, 0)).toBe(60);
    for (const row of table) {
      expect(row.played).toBe(10);
      expect(row.wins + row.losses).toBe(10);
    }
    expect(table.reduce((a, r) => a + r.wins, 0)).toBe(30);
    expect(s.reports).toHaveLength(10);
    expect(s.results.filter((r) => r.blue === PLAYER_CLUB_ID || r.red === PLAYER_CLUB_ID)).toHaveLength(10);
  });

  it('player form drifts within -10..10 from week to week', () => {
    const s = readyGame(6);
    const before = rosterOf(s).map((p) => p.form);
    for (let w = 0; w < 5; w++) advanceWeek(s, data);
    const after = rosterOf(s).map((p) => p.form);
    expect(after).not.toEqual(before);
    for (const f of after) expect(Math.abs(f)).toBeLessThanOrEqual(10);
  });

  it('finance summary reports runway and low-funds warning', () => {
    const s = readyGame(7);
    const f = financeSummary(s, data);
    expect(f.weeklySalaries).toBeGreaterThan(0);
    s.funds = f.weeklySalaries * 2;
    expect(financeSummary(s, data).lowFunds).toBe(true);
    s.funds = -1;
    expect(financeSummary(s, data).canSign).toBe(false);
  });
});

describe('economy calibration (sanity, 8 seeds; the full 100-seed check is `npm run sim -- --economy`)', () => {
  it('a value squad ends the season with 60%-150% of the starting funds most of the time', () => {
    let inside = 0;
    const n = 8;
    for (let seed = 100; seed < 100 + n; seed++) {
      const s = readyGame(seed);
      for (let w = 0; w < 10; w++) advanceWeek(s, data);
      const ratio = s.funds / s.startingFunds;
      if (ratio >= 0.6 && ratio <= 1.5) inside++;
    }
    expect(inside / n).toBeGreaterThanOrEqual(0.75);
  }, 120_000);
});
