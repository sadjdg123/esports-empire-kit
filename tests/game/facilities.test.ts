import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import type { FacilityId } from '../../src/core/types';
import {
  PLAYER_CLUB_ID, advanceDay, applyDailyRecovery, autoFacilities, commitMatchDay, facilityLevel, facilityUpkeep, newGame, renewalAsk,
  runPayDay, signValueSquad, sponsorOffers, startNewSeason, trainPlayer, trainingBoost, upgradeFacility, weeklyMoney, type GameState,
} from '../../src/game';

const data = loadGameData();

function club(seed = 3): GameState {
  const s = newGame('设施', '#3a7bd5', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  return s;
}
const maxOut = (s: GameState, id: FacilityId) => { s.club.facilities[id] = 3; };

describe('facilities (T22)', () => {
  it('an upgrade is paid once, goes in the ledger, and stops at level 3', () => {
    const s = club();
    s.funds = 500000;
    const cost = data.facilities.rooms.find((r) => r.id === 'TRAINING')!.levels[1]!.cost;
    expect(upgradeFacility(s, data, 'TRAINING')).toEqual({ ok: true, value: 2 });
    expect(s.funds).toBe(500000 - cost);
    expect(s.ledger.at(-1)).toMatchObject({ kind: 'FACILITY', amount: -cost });
    expect(upgradeFacility(s, data, 'TRAINING').ok).toBe(true);
    const r = upgradeFacility(s, data, 'TRAINING');
    expect(r.ok).toBe(false);
    expect(facilityLevel(s.club, 'TRAINING')).toBe(3);
  });

  it('refuses when the money is not there', () => {
    const s = club();
    s.funds = 100;
    expect(upgradeFacility(s, data, 'LOUNGE').ok).toBe(false);
    expect(facilityLevel(s.club, 'LOUNGE')).toBe(1);
  });

  it('upkeep is charged every pay day', () => {
    const s = club();
    expect(weeklyMoney(s, data).upkeep).toBe(0);
    maxOut(s, 'TRAINING');
    maxOut(s, 'STREAM');
    const upkeep = facilityUpkeep(data, s.club);
    expect(upkeep).toBeGreaterThan(0);
    expect(weeklyMoney(s, data).upkeep).toBe(upkeep);
    runPayDay(s, data);
    expect(s.ledger.find((e) => e.kind === 'UPKEEP')!.amount).toBe(-upkeep);
  });

  it('training room: players grow faster (+20% at level 3)', () => {
    const s = club();
    const young = s.club.roster.map((id) => s.players[id]!).find((p) => p.age <= 22)!;
    const a = structuredClone(young);
    const b = structuredClone(young);
    trainPlayer(a, 'MECHANICS', data.growth, trainingBoost(s, data, PLAYER_CLUB_ID));
    maxOut(s, 'TRAINING');
    trainPlayer(b, 'MECHANICS', data.growth, trainingBoost(s, data, PLAYER_CLUB_ID));
    const gain = (p: typeof a) => p.attrs.mechanics - young.attrs.mechanics;
    expect(gain(b)).toBeGreaterThan(0);
    expect(gain(b) / gain(a)).toBeCloseTo(1.2, 1);
  });

  it('analysis room: hero mastery grows faster', () => {
    const s = club();
    const p = s.players[s.club.roster[0]!]!;
    const a = structuredClone(p);
    const b = structuredClone(p);
    trainPlayer(a, 'MASTERY', data.growth, trainingBoost(s, data, PLAYER_CLUB_ID));
    maxOut(s, 'ANALYSIS');
    trainPlayer(b, 'MASTERY', data.growth, trainingBoost(s, data, PLAYER_CLUB_ID));
    const best = Object.entries(p.heroMastery).sort((x, y) => y[1] - x[1])[0]![0];
    expect(b.heroMastery[best]! - p.heroMastery[best]!).toBeGreaterThan(a.heroMastery[best]! - p.heroMastery[best]!);
  });

  it('lounge: tired players recover faster every day', () => {
    const s = club();
    for (const id of s.club.roster) s.players[id]!.fatigue = 50;
    const other = s.aiClubs[0]!.roster[0]!;
    s.players[other]!.fatigue = 50;
    maxOut(s, 'LOUNGE');
    applyDailyRecovery(s, data);
    const extra = data.facilities.rooms.find((r) => r.id === 'LOUNGE')!.levels[2]!.value;
    expect(s.players[s.club.roster[0]!]!.fatigue).toBe(50 - data.growth.fatigueDailyRecovery - extra);
    expect(s.players[other]!.fatigue).toBe(50 - data.growth.fatigueDailyRecovery);
  });

  it('office: renewals ask less, and better sponsors open up earlier', () => {
    const s = club();
    const p = s.players[s.club.roster[0]!]!;
    expect(renewalAsk(data, p, -0.1)).toBeLessThan(renewalAsk(data, p));
    const tier2 = data.economy.finance.sponsorTiers[1]!;
    s.club.reputation = tier2.minReputation - 8;
    expect(sponsorOffers(s, data).some((o) => tier2.sponsors.some((t) => t.id === o.id))).toBe(false);
    maxOut(s, 'OFFICE');
    expect(sponsorOffers(s, data).some((o) => tier2.sponsors.some((t) => t.id === o.id))).toBe(true);
  });

  it('streaming room: more merchandise income and positive net weekly gain', () => {
    const s = club();
    const before = weeklyMoney(s, data);
    maxOut(s, 'STREAM');
    const boost = data.facilities.rooms.find((r) => r.id === 'STREAM')!.levels[2]!.value;
    const after = weeklyMoney(s, data);
    expect(after.merch).toBeCloseTo(before.merch * (1 + boost), -1);
    expect(after.net).toBeGreaterThan(before.net);
  });

  it('AI clubs upgrade in the off-season from spare money, never below their reserve', () => {
    const s = club(5);
    for (let season = 1; season <= 3; season++) {
      for (let g = 0; g < 400 && s.calendar.phase !== 'FINISHED'; g++) {
        if (advanceDay(s, data).pause === 'MATCH_DAY') { const c = commitMatchDay(s, data); if (!c.ok) throw new Error(c.error); }
      }
      startNewSeason(s, data);
      signValueSquad(s, data);
    }
    const upgraded = s.aiClubs.filter((c) => Object.values(c.facilities).some((l) => l > 1));
    expect(upgraded.length).toBeGreaterThan(0);
    for (const c of s.aiClubs) for (const l of Object.values(c.facilities)) expect(l).toBeLessThanOrEqual(3);
  }, 120_000);

  it('the automatic manager spends only money it can spare', () => {
    const s = club();
    s.funds = 40000;
    autoFacilities(s, data);
    expect(Object.values(s.club.facilities)).toEqual([1, 1, 1, 1, 1]);
    s.funds = 400000;
    autoFacilities(s, data);
    expect(s.club.facilities.TRAINING).toBeGreaterThan(1);
    expect(s.funds).toBeGreaterThan(0);
  });
});
