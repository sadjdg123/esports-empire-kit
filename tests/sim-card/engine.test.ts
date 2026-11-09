import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { CARD_DECKS, cardConfig, runCardMatch, type CardDeck, type CardTeamInput } from '../../src/sim-card';

const cfg = cardConfig;
function team(id: string, level: number, deck: CardDeck | 'MIX', seed: number, proficiency = 65): CardTeamInput {
  const r = createRng(seed);
  const v = () => level + r.int(-6, 6);
  return {
    id, name: id,
    players: [0, 1, 2].map((i) => {
      const d = deck === 'MIX' ? CARD_DECKS[(seed + i) % 4]! : deck;
      return { id: `${id}${i}`, name: `${id}${i}`, deck: d, decks: { [d]: proficiency }, attrs: { calc: v(), read: v(), macro: v(), mental: v() } };
    }),
  };
}
function winRate(n: number, make: (i: number) => [CardTeamInput, CardTeamInput]): number {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const [a, b] = make(i);
    const swap = i % 2 === 1;
    const r = runCardMatch({ seed: 9000 + i, blue: swap ? b : a, red: swap ? a : b }, cfg);
    if ((r.winner === 'BLUE') !== swap) w++;
  }
  return w / n;
}

describe('card match engine (T37)', () => {
  it('the same seed gives the same match, another seed another one', () => {
    const input = { seed: 5, blue: team('a', 60, 'MIX', 1), red: team('b', 60, 'MIX', 2) };
    expect(runCardMatch(input, cfg)).toEqual(runCardMatch(input, cfg));
    expect(runCardMatch({ ...input, seed: 6 }, cfg).checksum).not.toBe(runCardMatch(input, cfg).checksum);
  });

  it('a match is well formed: series to two games, match to two series, life adds up', () => {
    for (let seed = 0; seed < 60; seed++) {
      const r = runCardMatch({ seed, blue: team('a', 60, 'MIX', seed), red: team('b', 60, 'MIX', seed + 3) }, cfg);
      const w = r.winner, l = w === 'BLUE' ? 'RED' : 'BLUE';
      expect(r.score[w]).toBe(cfg.seriesToWin);
      expect(r.score[l]).toBeLessThan(cfg.seriesToWin);
      expect(r.series).toHaveLength(r.score.BLUE + r.score.RED);
      for (const s of r.series) {
        const won = { BLUE: s.games.filter((g) => g.winner === 'BLUE').length, RED: s.games.filter((g) => g.winner === 'RED').length };
        expect(won[s.winner]).toBe(cfg.gamesToWin);
        for (const g of s.games) {
          const last = g.turns.at(-1)!;
          for (const t of g.turns) { expect(t.life.BLUE).toBeGreaterThanOrEqual(0); expect(t.life.RED).toBeGreaterThanOrEqual(0); expect(t.damage).toBeGreaterThanOrEqual(0); }
          if (!g.byTime) { expect(last.side).toBe(g.winner); expect(last.life[g.winner === 'BLUE' ? 'RED' : 'BLUE']).toBe(0); expect(last.notes).toContain('LETHAL'); }
          expect(Math.ceil(g.turns.length / 2)).toBeLessThanOrEqual(cfg.maxTurns);
        }
      }
      expect(r.stats.filter((p) => p.played)).toHaveLength(r.series.length * 2);
      expect(r.report.keyReasons.length).toBeGreaterThan(0);
      expect(r.stats.find((p) => p.id === r.report.mvp)?.played).toBe(true);
    }
  });

  it('both sides of an even match win about as often, and going first is no big edge', () => {
    let first = 0, games = 0;
    const blue = winRate(600, (i) => [team('a', 60, CARD_DECKS[i % 4]!, i), team('b', 60, CARD_DECKS[i % 4]!, i)]);
    for (let i = 0; i < 300; i++) for (const s of runCardMatch({ seed: i, blue: team('a', 60, 'MIX', i), red: team('b', 60, 'MIX', i) }, cfg).series) for (const g of s.games) { games++; if (g.winner === g.first) first++; }
    expect(blue).toBeGreaterThan(0.43);
    expect(blue).toBeLessThan(0.57);
    expect(first / games).toBeGreaterThan(0.44);
    expect(first / games).toBeLessThan(0.58);
  });

  it('better players and players who know their deck win more, but not always', () => {
    const strong = winRate(600, (i) => [team('a', 67, 'MIX', i), team('b', 52, 'MIX', i)]);
    expect(strong).toBeGreaterThan(0.65);
    expect(strong).toBeLessThan(0.93);
    const known = winRate(600, (i) => [team('a', 60, 'MIX', i, 90), team('b', 60, 'MIX', i, 40)]);
    expect(known).toBeGreaterThan(0.6);
    expect(known).toBeLessThan(0.93);
  });

  it('decks counter each other in a circle, and none beats all the others', () => {
    const rate: Record<string, number> = {};
    for (const a of CARD_DECKS) for (const b of CARD_DECKS) if (a < b) {
      const r = winRate(400, (i) => [team('a', 60, a, i), team('b', 60, b, i + 7)]);
      rate[`${a}>${b}`] = r; rate[`${b}>${a}`] = 1 - r;
    }
    expect(rate['AGGRO>COMBO']).toBeGreaterThan(0.55);
    expect(rate['COMBO>CONTROL']).toBeGreaterThan(0.55);
    expect(rate['CONTROL>AGGRO']).toBeGreaterThan(0.55);
    for (const a of CARD_DECKS) expect(CARD_DECKS.filter((b) => b !== a).every((b) => rate[`${a}>${b}`]! > 0.55)).toBe(false);
  }, 120_000);
});
