import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import {
  chemistryFromMatch, chemistryFromTraining, chemistryNewSeason, chemistryOf, chemistryWith, groupChemistry, matchInputFor, newGame,
  pairKey, signValueSquad, type GameState,
} from '../../src/game';
import { playerModsOf, traitModsOf } from '../../src/sim/units';

const data = loadGameData();
const c = data.growth.chemistry;

function club(seed = 2): GameState {
  const s = newGame('默契', '#3a7bd5', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  return s;
}

describe('chemistry (T25)', () => {
  it('starting a match together raises it for every pair of starters, not for the bench', () => {
    const s = club();
    const input = matchInputFor(s, data, { blue: s.club.id, red: s.aiClubs[0]!.id, seed: 1 });
    expect(input.blue.chemistry).toBe(0);
    chemistryFromMatch(s, data, input);
    const starters = input.blue.lineup.picks.map((p) => p.playerId);
    expect(groupChemistry(s, starters)).toBe(c.perMatch);
    const bench = s.club.roster.find((id) => !starters.includes(id));
    if (bench) expect(chemistryOf(s, bench, starters[0]!)).toBe(0);
    const again = matchInputFor(s, data, { blue: s.club.id, red: s.aiClubs[0]!.id, seed: 2 });
    expect(again.blue.chemistry).toBe(c.perMatch); // the next match feels it
  });

  it('a week of teamwork training raises it for the whole club; other training does not', () => {
    const s = club();
    chemistryFromTraining(s, data, s.club, 'MECHANICS');
    expect(Object.keys(s.chemistry)).toHaveLength(0);
    chemistryFromTraining(s, data, s.club, 'TEAMWORK');
    expect(groupChemistry(s, s.club.roster)).toBe(c.perTeamworkWeek);
  });

  it('never goes above 100', () => {
    const s = club();
    for (let i = 0; i < 200; i++) chemistryFromTraining(s, data, s.club, 'TEAMWORK');
    expect(groupChemistry(s, s.club.roster)).toBe(100);
  });

  it('fades between players who are no longer on the same club, and is forgotten at 0', () => {
    const s = club();
    const [a, b] = s.club.roster as [string, string];
    const other = s.aiClubs[0]!.roster[0]!;
    s.chemistry[pairKey(a, b)] = 80;
    s.chemistry[pairKey(a, other)] = c.decayApart + 10;
    s.chemistry[pairKey(b, other)] = c.decayApart - 1;
    chemistryNewSeason(s, data);
    expect(chemistryOf(s, a, b)).toBe(80);
    expect(chemistryOf(s, a, other)).toBe(10);
    expect(s.chemistry[pairKey(b, other)]).toBeUndefined();
  });

  it('averages over pairs; a player\'s chemistry with the rest of the five', () => {
    const s = club();
    const [a, b, d] = s.club.roster as [string, string, string];
    s.chemistry[pairKey(a, b)] = 60;
    expect(groupChemistry(s, [a, b, d])).toBe(20);
    expect(chemistryWith(s, a, [a, b, d])).toBe(30);
    expect(groupChemistry(s, [a])).toBe(0);
  });

  it('in a match, full chemistry adds the configured mechanics and teamwork; none adds nothing', () => {
    const s = club();
    const p = s.players[s.club.roster[0]!]!;
    const k = data.match.coefficients.chemistry;
    const base = traitModsOf(data.traits, p);
    expect(playerModsOf(data.traits, data.match, p, 0)).toEqual(base);
    const full = playerModsOf(data.traits, data.match, p, 100);
    expect(full.mechanics).toBeCloseTo(base.mechanics + k.mechanics, 9);
    expect(full.teamwork).toBeCloseTo(base.teamwork + k.teamwork, 9);
    expect(playerModsOf(data.traits, data.match, p, 50).mechanics).toBeCloseTo(base.mechanics + k.mechanics / 2, 9);
    expect(Math.abs(k.mechanics)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(k.teamwork)).toBeLessThanOrEqual(0.05);
  });
});
