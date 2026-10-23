import { describe, expect, it } from 'vitest';
import { defaultRawData, loadGameData, validateRawData } from '../../src/core/config';
import { traitEffect } from '../../src/core/personality';
import type { Player } from '../../src/core/types';
import { applyDailyRecovery, newGame, playerTrainingBoost, renewalAsk, signValueSquad, trainPlayer } from '../../src/game';
import { runMatch } from '../../src/sim';
import { clubTeam, type TeamInput } from '../../src/sim/scenario';
import { computeCoefficients, traitModsOf } from '../../src/sim/units';

const data = loadGameData();
const NO_BOOST = { growth: 1, mastery: 1 };
const sample = (): Player => structuredClone(data.clubs[0]!.players[0]!);
const withTraits = (p: Player, traits: string[]): Player => ({ ...structuredClone(p), traits });
const effect = (id: string, key: string) => data.traits.traits.find((t) => t.id === id)!.effects[key]!;

describe('personality effects (T24)', () => {
  it('adds up the effects of all of a player\'s traits', () => {
    expect(traitEffect(data.traits, [], 'salaryAsk')).toBe(0);
    expect(traitEffect(data.traits, ['GREEDY'], 'salaryAsk')).toBe(effect('GREEDY', 'salaryAsk'));
    expect(traitEffect(data.traits, ['GREEDY', 'DILIGENT'], 'trainingGrowth')).toBe(effect('DILIGENT', 'trainingGrowth'));
    expect(traitEffect(data.traits, ['NOT_A_TRAIT'], 'salaryAsk')).toBe(0);
  });

  it('match effects are capped at ±5% by the data check (Q7)', () => {
    const raw = structuredClone(defaultRawData());
    (raw.traits as { traits: { effects: Record<string, number> }[] }).traits[0]!.effects = { behindPerformance: 0.2 };
    expect(validateRawData(raw).some((e) => e.includes('behindPerformance'))).toBe(true);
  });

  it('clutch and fragile: stronger or weaker only while far behind in gold', () => {
    const p = sample();
    const heroId = Object.keys(p.heroMastery)[0]!;
    const plain = computeCoefficients(data.match, p, p.primaryRole, heroId);
    const clutch = computeCoefficients(data.match, p, p.primaryRole, heroId, traitModsOf(data.traits, withTraits(p, ['CLUTCH'])));
    const fragile = computeCoefficients(data.match, p, p.primaryRole, heroId, traitModsOf(data.traits, withTraits(p, ['FRAGILE'])));
    expect(clutch.mentalPenalty).toBeCloseTo(plain.mentalPenalty * (1 + effect('CLUTCH', 'behindPerformance')), 9);
    expect(fragile.mentalPenalty).toBeCloseTo(plain.mentalPenalty * (1 + effect('FRAGILE', 'behindPerformance')), 9);
    expect(clutch.damage).toBe(plain.damage);
  });

  it('loner: a little more damage, worse at playing together', () => {
    const p = sample();
    const heroId = Object.keys(p.heroMastery)[0]!;
    const plain = computeCoefficients(data.match, p, p.primaryRole, heroId);
    const loner = computeCoefficients(data.match, p, p.primaryRole, heroId, traitModsOf(data.traits, withTraits(p, ['LONER'])));
    expect(loner.damage).toBeGreaterThan(plain.damage);
    expect(loner.focusChance).toBeLessThan(plain.focusChance);
    expect(loner.groupDelay).toBeGreaterThan(plain.groupDelay);
  });

  it('diligent players grow 20% faster in training, lazy ones 20% slower', () => {
    const young = { ...sample(), age: 18, potential: 99 };
    const gain = (traits: string[]) => {
      const p = withTraits(young, traits);
      trainPlayer(p, 'MECHANICS', data.growth, playerTrainingBoost(data, p, NO_BOOST));
      return p.attrs.mechanics - young.attrs.mechanics;
    };
    const base = gain([]);
    expect(base).toBeGreaterThan(0);
    expect(gain(['DILIGENT']) / base).toBeCloseTo(1 + effect('DILIGENT', 'trainingGrowth'), 1);
    expect(gain(['LAZY']) / base).toBeCloseTo(1 + effect('LAZY', 'trainingGrowth'), 1);
  });

  it('a leader on the club lifts low morale back faster, for the whole club', () => {
    const run = (leader: boolean) => {
      const s = newGame('性格', '#3a7bd5', 3, data);
      expect(signValueSquad(s, data).ok).toBe(true);
      const [a, b] = s.club.roster;
      for (const id of s.club.roster) Object.assign(s.players[id]!, { traits: [], morale: 40 });
      if (leader) s.players[a!]!.traits = ['LEADER'];
      applyDailyRecovery(s, data);
      return s.players[b!]!.morale!;
    };
    expect(run(true) - 40).toBeCloseTo(data.growth.moraleDailyDrift + effect('LEADER', 'teamMoraleDrift'), 5);
    expect(run(false) - 40).toBeCloseTo(data.growth.moraleDailyDrift, 5);
  });

  it('modest players ask less at renewal, greedy ones more', () => {
    const p = sample();
    const plain = renewalAsk(data, withTraits(p, []));
    expect(renewalAsk(data, withTraits(p, ['MODEST']))).toBeLessThan(plain);
    expect(renewalAsk(data, withTraits(p, ['GREEDY']))).toBeGreaterThan(plain);
    expect(renewalAsk(data, withTraits(p, ['GREEDY'])) / plain).toBeCloseTo(1 + effect('GREEDY', 'salaryAsk'), 1);
  });

  it('a whole team with one match trait wins within 15 points of the same team without it', () => {
    const N = 200;
    const copy = (t: TeamInput, pre: string, traits: string[]): TeamInput => ({
      lineup: { ...t.lineup, clubId: pre, picks: t.lineup.picks.map((pk) => ({ ...pk, playerId: pre + pk.playerId })) },
      players: t.players.map((p) => ({ ...p, id: pre + p.id, traits })),
    });
    const winRate = (traits: string[]) => {
      let wins = 0;
      for (let i = 0; i < N; i++) {
        const base = clubTeam(data, data.clubs[i % data.clubs.length]!.id, 'STEADY_MACRO');
        const a = copy(base, 'a_', traits);
        const b = copy(base, 'b_', []);
        const aBlue = i % 2 === 0;
        const r = runMatch({ seed: 9000 + i, blue: aBlue ? a : b, red: aBlue ? b : a }, data);
        if ((r.winner === 'BLUE') === aBlue) wins++;
      }
      return wins / N;
    };
    const none = winRate([]);
    for (const t of ['CLUTCH', 'FRAGILE', 'LONER']) {
      const diff = winRate([t]) - none;
      expect(Math.abs(diff)).toBeLessThanOrEqual(0.15);
    }
  }, 300_000);
});

