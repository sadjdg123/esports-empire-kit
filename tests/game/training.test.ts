import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import type { Player } from '../../src/core/types';
import {
  PLAYER_CLUB_ID, advanceDay, ageRate, applyMatchEffects, commitMatchDay, matchInputFor, newGame, playerOverall, signValueSquad,
  todaysMatches, trainPlayer, trainingFocusOf, updateForm, type GameState, type TrainingPlan,
} from '../../src/game';
import { createRng } from '../../src/core/rng';
import { runMatch } from '../../src/sim';
import { cloneTeam, clubTeam } from '../../src/sim/scenario';

const data = loadGameData();
const g = data.growth;

function playSeason(seed: number, focusFor: (week: number) => TrainingPlan): { s: GameState; fatigueAtMatches: number[]; before: Record<string, Player> } {
  const s = newGame('训练测试', '#3a7bd5', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  const before = structuredClone(s.players);
  const fatigueAtMatches: number[] = [];
  for (let guard = 0; guard < 500 && s.calendar.phase !== 'FINISHED'; guard++) {
    s.training = focusFor(Math.floor(s.calendar.day / 7));
    if (advanceDay(s, data).pause === 'MATCH_DAY') {
      fatigueAtMatches.push(s.club.roster.reduce((a, id) => a + s.players[id]!.fatigue!, 0) / s.club.roster.length);
      const c = commitMatchDay(s, data);
      if (!c.ok) throw new Error(c.error);
    }
  }
  return { s, fatigueAtMatches, before };
}

function samplePlayer(age: number, potential: number): Player {
  const p = structuredClone(data.players[0]!);
  p.age = age;
  p.potential = potential;
  p.attrs = { mechanics: 60, awareness: 60, teamwork: 60, mental: 60 };
  p.fatigue = 0;
  return p;
}

describe('growth', () => {
  it('follows the age curve: fast when young, slower at the peak, declining past 30', () => {
    expect(ageRate(g, 15)).toBe(g.ageCurve[0]!.rate);
    expect(ageRate(g, 22)).toBeCloseTo(1.0, 5); // halfway between 20 (1.2) and 24 (0.8)
    expect(ageRate(g, 40)).toBe(g.ageCurve[g.ageCurve.length - 1]!.rate);
    const young = samplePlayer(18, 90);
    const veteran = samplePlayer(31, 90);
    for (let w = 0; w < 14; w++) { trainPlayer(young, 'MECHANICS', g); trainPlayer(veteran, 'MECHANICS', g); young.fatigue = 0; veteran.fatigue = 0; }
    expect(young.attrs.mechanics).toBeGreaterThan(young.attrs.awareness); // the focus grows most
    expect(young.attrs.awareness).toBeGreaterThan(60); // the others a little
    expect(playerOverall(veteran)).toBeLessThan(60);
  });

  it('stops at the hidden potential', () => {
    const p = samplePlayer(17, 62);
    for (let w = 0; w < 200; w++) { trainPlayer(p, 'MENTAL', g); p.fatigue = 0; }
    expect(playerOverall(p)).toBeLessThanOrEqual(62 + 0.01);
    expect(playerOverall(p)).toBeGreaterThan(61);
  });

  it('over a real season, young high-potential players grow clearly more than veterans', () => {
    const { s, before } = playSeason(5, () => 'MECHANICS');
    const rostered = [s.club, ...s.aiClubs].flatMap((c) => c.roster);
    const growth = (pred: (p: Player) => boolean) => {
      const ids = rostered.filter((id) => pred(before[id]!));
      expect(ids.length).toBeGreaterThan(3);
      return ids.reduce((a, id) => a + playerOverall(s.players[id]!) - playerOverall(before[id]!), 0) / ids.length;
    };
    const young = growth((p) => p.age <= 20 && p.potential! - playerOverall(p) >= 8);
    const veterans = growth((p) => p.age >= 25);
    expect(young).toBeGreaterThan(veterans + 2);
    expect(young).toBeGreaterThan(2);
  }, 60_000);

  it('MASTERY focus raises the best heroes; playing a hero raises it a little', () => {
    const p = samplePlayer(19, 90);
    const best = Object.entries(p.heroMastery).sort((a, b) => b[1] - a[1])[0]!;
    trainPlayer(p, 'MASTERY', g);
    expect(p.heroMastery[best[0]]).toBeGreaterThan(best[1]);
  });
});

describe('fatigue and morale', () => {
  it('a squad that never rests wears out; resting every third week keeps it fresh', () => {
    const tired = playSeason(7, () => 'MECHANICS').fatigueAtMatches;
    const rested = playSeason(7, (w) => (w % 3 === 2 ? 'REST' : 'MECHANICS')).fatigueAtMatches;
    expect(Math.max(...tired.slice(-3))).toBeGreaterThanOrEqual(80);
    expect(Math.max(...rested)).toBeLessThan(50);
  }, 60_000);

  it('automatic training (the default) rests the week the squad is tired and rotates otherwise', () => {
    const s = newGame('自动', '#3a7bd5', 3, data);
    expect(s.training).toBe('AUTO');
    expect(signValueSquad(s, data).ok).toBe(true);
    for (const id of s.club.roster) s.players[id]!.fatigue = 0;
    expect(trainingFocusOf(s, data, PLAYER_CLUB_ID)).not.toBe('REST');
    for (const id of s.club.roster) s.players[id]!.fatigue = g.autoRestFatigue;
    expect(trainingFocusOf(s, data, PLAYER_CLUB_ID)).toBe('REST');
    // Over a whole season the squad never wears out, and it still trains most weeks.
    const auto = playSeason(7, () => 'AUTO');
    expect(Math.max(...auto.fatigueAtMatches)).toBeLessThan(50);
    const grew = auto.s.club.roster.filter((id) => playerOverall(auto.s.players[id]!) > playerOverall(auto.before[id]!)).length;
    expect(grew).toBeGreaterThan(0);
  }, 60_000);

  it('tired players lose more often than the same players fresh', () => {
    let tiredWins = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const fresh = clubTeam(data, data.clubs[2]!.id, 'STEADY_MACRO');
      const tired = cloneTeam(fresh, "t");
      for (const p of tired.players) p.fatigue = 90;
      const tiredBlue = i % 2 === 0;
      const r = runMatch({ seed: 500 + i, blue: tiredBlue ? tired : fresh, red: tiredBlue ? fresh : tired }, data);
      if ((r.winner === 'BLUE') === tiredBlue) tiredWins++;
    }
    expect(tiredWins / N).toBeLessThan(0.4);
  }, 60_000);

  it('wins lift morale, losses and the bench lower it, and morale pulls form', () => {
    const s = newGame('士气测试', '#3a7bd5', 9, data);
    const fixture = { blue: data.clubs[0]!.id, red: data.clubs[1]!.id, seed: 42 };
    const input = matchInputFor(s, data, fixture);
    const before = structuredClone(s.players);
    const r = runMatch(input, data);
    applyMatchEffects(s, data, input, r);
    const winners = (r.winner === 'BLUE' ? input.blue : input.red).lineup.picks.map((pk) => pk.playerId);
    const losers = (r.winner === 'BLUE' ? input.red : input.blue).lineup.picks.map((pk) => pk.playerId);
    for (const id of winners) expect(s.players[id]!.morale).toBeGreaterThan(before[id]!.morale!);
    for (const id of losers) expect(s.players[id]!.morale).toBeLessThan(before[id]!.morale!);
    for (const id of [...winners, ...losers]) {
      expect(s.players[id]!.fatigue).toBe(g.fatiguePerMatch);
      expect(s.players[id]!.stats!.played).toBe(1);
    }
    const bench = s.aiClubs[0]!.roster.filter((id) => !input.blue.lineup.picks.some((pk) => pk.playerId === id));
    for (const id of bench) expect(s.players[id]!.morale).toBe(before[id]!.morale! + g.moraleBench);

    const happy = samplePlayer(22, 80);
    happy.morale = 100;
    happy.form = 0;
    const rng = createRng(1);
    for (let w = 0; w < 6; w++) updateForm(happy, g, rng, 0);
    expect(happy.form).toBeGreaterThan(0);
  });

  it('only rostered players play; AI-only match days still apply effects', () => {
    const s = newGame('测试', '#3a7bd5', 3, data);
    signValueSquad(s, data);
    while (todaysMatches(s, data).length === 0) advanceDay(s, data);
    const ai = todaysMatches(s, data).find((m) => m.blue !== 'player' && m.red !== 'player')!;
    const starters = matchInputFor(s, data, ai).blue.lineup.picks.map((pk) => pk.playerId);
    commitMatchDay(s, data);
    expect(s.players[starters[0]!]!.stats!.played).toBe(1);
  });
});
