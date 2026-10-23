import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import type { Player } from '../../src/core/types';
import {
  PLAYER_CLUB_ID, advanceDay, ageRate, ageRateOf, careerPeak, commitMatchDay, newGame, openNegotiation, retirementChance, seasonWeeks,
  signValueSquad, startNewSeason, weekOfSeason, type GameState,
} from '../../src/game';

const data = loadGameData();
const r = data.growth.retirement;

function club(seed = 4): GameState {
  const s = newGame('生涯', '#3a7bd5', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  return s;
}

/** Plays day by day until `stop` is true (or the season is over). */
function playUntil(s: GameState, stop: (s: GameState) => boolean): void {
  for (let g = 0; g < 400 && !stop(s) && s.calendar.phase !== 'FINISHED'; g++) {
    if (advanceDay(s, data).pause === 'MATCH_DAY') { const c = commitMatchDay(s, data); if (!c.ok) throw new Error(c.error); }
  }
}

const noticeDay = (s: GameState) => weekOfSeason(s) > seasonWeeks(s, data) - r.noticeWeeks;
const aged = (p: Player, age: number, growthType: Player['growthType'] = 'NORMAL'): Player => ({ ...structuredClone(p), age, growthType, career: [] });

describe('growth types (T23)', () => {
  it('shift the age curve: early bloomers peak and fade sooner, late bloomers later', () => {
    const g = data.growth;
    const s = club();
    const p = s.players[s.club.roster[0]!]!;
    expect(ageRateOf(g, aged(p, 25, 'NORMAL'))).toBe(ageRate(g, 25));
    expect(ageRateOf(g, aged(p, 25, 'EARLY'))).toBe(ageRate(g, 25 - g.growthTypes.EARLY.ageShift));
    expect(ageRateOf(g, aged(p, 25, 'LATE'))).toBe(ageRate(g, 25 - g.growthTypes.LATE.ageShift));
    expect(ageRateOf(g, aged(p, 25, 'EARLY'))).toBeLessThan(ageRateOf(g, aged(p, 25, 'LATE')));
  });
});

describe('retirement chance (T23)', () => {
  const base = club();
  const p = base.players[base.club.roster[0]!]!;
  it('nobody below the first age, everyone at the last', () => {
    expect(retirementChance(data, aged(p, r.fromAge - 1))).toBe(0);
    expect(retirementChance(data, aged(p, r.alwaysAt))).toBe(1);
    expect(retirementChance(data, aged(p, r.alwaysAt + 3, 'LATE'))).toBe(1);
  });
  it('rises with age, more for early bloomers and for players clearly past their peak', () => {
    for (let age = r.fromAge; age < r.alwaysAt - 1; age++) {
      expect(retirementChance(data, aged(p, age + 1))).toBeGreaterThanOrEqual(retirementChance(data, aged(p, age)));
    }
    const age = r.fromAge + 2;
    expect(retirementChance(data, aged(p, age, 'EARLY'))).toBeGreaterThan(retirementChance(data, aged(p, age, 'NORMAL')));
    expect(retirementChance(data, aged(p, age, 'LATE'))).toBeLessThan(retirementChance(data, aged(p, age, 'NORMAL')));
    const fading = aged(p, age);
    fading.career = [{ season: 1, clubId: 'x', clubName: 'x', played: 10, wins: 5, champion: false, ovr: careerPeak(fading) + r.declinePoints }];
    expect(retirementChance(data, fading)).toBeCloseTo(retirementChance(data, aged(p, age)) + r.declineBonus, 5);
  });
});

describe('retiring (T23)', () => {
  function withVeteran(seed = 4) {
    const s = club(seed);
    const vetId = s.lineup?.picks[0]?.playerId ?? s.club.roster[0]!;
    const vet = s.players[vetId]!;
    vet.age = r.alwaysAt; // certain to stop this season
    const young = s.players[s.club.roster.find((id) => id !== vetId)!]!;
    young.age = r.fromAge - 1; // certain to stay
    return { s, vet, young };
  }

  it('is announced a few weeks before the season ends, with a message for your own players', () => {
    const { s, vet, young } = withVeteran();
    playUntil(s, (x) => weekOfSeason(x) >= seasonWeeks(x, data) - r.noticeWeeks - 1 && x.calendar.day % 7 === 6);
    expect(vet.retiring).toBeFalsy();
    playUntil(s, noticeDay);
    expect(vet.retiring).toBe(true);
    expect(young.retiring).toBeFalsy();
    expect(s.inbox.some((m) => m.title.includes(vet.name) && m.title.includes('退役'))).toBe(true);
    expect(openNegotiation(s, data, vet.id).ok).toBe(false);
  }, 120_000);

  it('retirees finish the season and are gone when the next one starts; the lineup is reset', () => {
    const { s, vet } = withVeteran();
    playUntil(s, () => false);
    expect(s.club.roster).toContain(vet.id);
    expect(s.lineup?.picks.some((pk) => pk.playerId === vet.id) ?? false).toBe(true);
    startNewSeason(s, data);
    expect(s.players[vet.id]).toBeUndefined();
    expect(s.club.roster).not.toContain(vet.id);
    expect(s.lineup).toBeNull();
    expect(Object.keys(s.chemistry).some((k) => k.includes(vet.id))).toBe(false);
    expect(s.inbox.some((m) => m.title.endsWith('名选手退役'))).toBe(true);
  }, 120_000);

  it('old free agents who stop leave the market at once', () => {
    const s = club();
    const fa = s.players[s.market[0]!]!;
    fa.age = r.alwaysAt;
    playUntil(s, noticeDay);
    expect(s.players[fa.id]).toBeUndefined();
    expect(s.market).not.toContain(fa.id);
  }, 120_000);

  it('the same seed retires the same players', () => {
    const run = () => {
      const s = club(7);
      for (const id of Object.keys(s.players)) s.players[id]!.age += 10; // plenty of veterans
      playUntil(s, () => false);
      return Object.values(s.players).filter((p) => p.retiring).map((p) => p.id).sort();
    };
    const a = run();
    expect(a.length).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  }, 120_000);

  it('AI clubs still field a full team after their veterans retire', () => {
    const s = club();
    for (const c of s.aiClubs) for (const id of c.roster) s.players[id]!.age = r.alwaysAt;
    playUntil(s, () => false);
    startNewSeason(s, data);
    for (const c of s.aiClubs) expect(c.roster.length).toBeGreaterThanOrEqual(data.economy.minRoster);
    expect(s.club.roster.every((id) => s.players[id] && s.players[id]!.clubId === PLAYER_CLUB_ID)).toBe(true);
  }, 120_000);
});
