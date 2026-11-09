import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { FPS_ROLES, FPS_TACTICS, fpsConfig, runFpsMatch, type FpsTactic, type FpsTeamInput } from '../../src/sim-fps';

const cfg = fpsConfig;
function team(id: string, level: number, tactic: FpsTactic, seed: number, offRole = false): FpsTeamInput {
  const r = createRng(seed);
  const v = () => level + r.int(-6, 6);
  return {
    id, name: id, tactic,
    players: FPS_ROLES.map((role, i) => ({
      id: `${id}${i}`, name: `${id}${i}`, role: offRole ? FPS_ROLES[(i + 1) % 5]! : role, primaryRole: role,
      attrs: { aim: v(), reaction: v(), positioning: v(), teamwork: v(), mental: v() },
    })),
  };
}
/** Win rate of the first team over n matches, sides swapped every other match. */
function winRate(n: number, make: (i: number) => [FpsTeamInput, FpsTeamInput]): number {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const [a, b] = make(i);
    const swap = i % 2 === 1;
    const r = runFpsMatch({ seed: 9000 + i, blue: swap ? b : a, red: swap ? a : b }, cfg);
    if ((r.winner === 'BLUE') !== swap) w++;
  }
  return w / n;
}

describe('shooter match engine (T36)', () => {
  it('the same seed gives the same match, another seed another one', () => {
    const input = { seed: 5, blue: team('a', 60, 'DEFAULT', 1), red: team('b', 60, 'RUSH', 2) };
    expect(runFpsMatch(input, cfg)).toEqual(runFpsMatch(input, cfg));
    expect(runFpsMatch({ ...input, seed: 6 }, cfg).checksum).not.toBe(runFpsMatch(input, cfg).checksum);
  });

  it('a match is well formed: first to seven, sides swap, every kill has a living killer', () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = runFpsMatch({ seed, blue: team('a', 60, FPS_TACTICS[seed % 4]!, seed), red: team('b', 60, FPS_TACTICS[(seed + 1) % 4]!, seed + 50) }, cfg);
      const w = r.winner, l = w === 'BLUE' ? 'RED' : 'BLUE';
      expect(r.score[w]).toBe(cfg.roundsToWin);
      expect(r.score[l]).toBeLessThan(cfg.roundsToWin);
      expect(r.rounds).toHaveLength(r.score.BLUE + r.score.RED);
      expect(r.rounds.at(-1)!.score).toEqual(r.score);
      for (const round of r.rounds) {
        if (round.n <= cfg.halfRounds) expect(round.attackers).toBe('BLUE');
        else if (round.n <= cfg.halfRounds * 2) expect(round.attackers).toBe('RED');
        const dead = new Set<string>();
        let last = 0;
        for (const e of round.events) {
          expect(e.t).toBeGreaterThanOrEqual(0);
          if (e.type !== 'FAKE') { expect(e.t).toBeGreaterThanOrEqual(last); last = e.t; }
          if (e.type === 'KILL') { expect(dead.has(e.killer)).toBe(false); expect(dead.has(e.victim)).toBe(false); dead.add(e.victim); }
        }
        if (round.reason === 'DEFUSE' || round.reason === 'EXPLODE') expect(round.events.some((e) => e.type === 'PLANT')).toBe(true);
        if (round.reason === 'DEFUSE' || round.reason === 'TIMEOUT') expect(round.winner).not.toBe(round.attackers);
        if (round.reason === 'EXPLODE') expect(round.winner).toBe(round.attackers);
      }
      const kills = r.stats.reduce((a, s) => a + s.kills, 0), deaths = r.stats.reduce((a, s) => a + s.deaths, 0);
      expect(kills).toBe(deaths);
      expect(r.report.keyReasons.length).toBeGreaterThan(0);
      expect(r.stats.some((s) => s.id === r.report.mvp)).toBe(true);
    }
  });

  it('both sides of an even match win about as often', () => {
    const blue = winRate(600, (i) => [team('a', 60, 'DEFAULT', i), team('b', 60, 'DEFAULT', i)]);
    expect(blue).toBeGreaterThan(0.42);
    expect(blue).toBeLessThan(0.58);
  });

  it('better players win more, but not always', () => {
    const strong = winRate(600, (i) => [team('a', 67, 'DEFAULT', i), team('b', 52, 'DEFAULT', i + 7)]);
    expect(strong).toBeGreaterThan(0.65);
    expect(strong).toBeLessThan(0.93);
  });

  it('playing out of position costs a lot', () => {
    expect(winRate(600, (i) => [team('a', 60, 'DEFAULT', i, true), team('b', 60, 'DEFAULT', i + 7)])).toBeLessThan(0.42);
  });

  it('no tactic beats all the others, and each has one it counters', () => {
    const rate: Record<string, number> = {};
    for (const a of FPS_TACTICS) for (const b of FPS_TACTICS) if (a < b) {
      const r = winRate(500, (i) => [team('a', 60, a, i), team('b', 60, b, i + 7)]);
      rate[`${a}>${b}`] = r; rate[`${b}>${a}`] = 1 - r;
    }
    for (const a of FPS_TACTICS) {
      const others = FPS_TACTICS.filter((b) => b !== a).map((b) => rate[`${a}>${b}`]!);
      expect(others.every((x) => x > 0.55)).toBe(false);
      expect(Math.max(...others)).toBeGreaterThan(0.52);
    }
  }, 120_000);
});
