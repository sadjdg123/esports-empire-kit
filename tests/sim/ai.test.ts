import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import type { MatchResult, Side, Tactic } from '../../src/core/types';
import { createMatch, runMatch, step } from '../../src/sim';
import { decideUtility } from '../../src/sim/ai';
import { cloneTeam, syntheticTeam, type TeamInput } from '../../src/sim/scenario';
import { tacticFactor } from '../../src/sim/tactics';
import { data, mirrorInput } from './helpers';

function tacticMatches(n: number, ta: Tactic, tb: Tactic, seed0: number, tweak?: (a: TeamInput, b: TeamInput) => void) {
  const out: { r: MatchResult; sideA: Side }[] = [];
  for (let i = 0; i < n; i++) {
    const rng = createRng(seed0 + i);
    const base = syntheticTeam(data, rng, { idPrefix: 'X', tactic: ta, ability: 50 + rng.int(0, 20) });
    const a = cloneTeam(base, 'A', ta);
    const b = cloneTeam(base, 'B', tb);
    tweak?.(a, b);
    const aBlue = i % 2 === 0;
    out.push({ r: runMatch({ seed: seed0 + i, blue: aBlue ? a : b, red: aBlue ? b : a }, data), sideA: aBlue ? 'BLUE' : 'RED' });
  }
  return out;
}

describe('tactic modifiers', () => {
  it('apply the configured factors by time window and role', () => {
    const cfg = data.match;
    expect(tacticFactor(cfg, 'EARLY_AGGRO', 'GANK', 'JUNGLE', 300)).toBeCloseTo(1.6, 9);
    expect(tacticFactor(cfg, 'EARLY_AGGRO', 'GANK', 'JUNGLE', 900)).toBe(1);
    expect(tacticFactor(cfg, 'EARLY_AGGRO', 'PUSH', 'MID', 1300)).toBeCloseTo(0.85, 9);
    expect(tacticFactor(cfg, 'SPLIT_PUSH', 'SPLIT', 'TOP', 800)).toBeCloseTo(2.0, 9);
    expect(tacticFactor(cfg, 'SPLIT_PUSH', 'SPLIT', 'MID', 800)).toBe(1);
    expect(tacticFactor(cfg, 'TEAMFIGHT_PUSH', 'GROUP', 'ADC', 800)).toBeCloseTo(1.6, 9);
  });
});

describe('AI behaviour (statistical)', () => {
  it('EARLY_AGGRO ganks clearly more than STEADY_MACRO in the first 12 minutes (200 matches)', () => {
    let ea = 0;
    let sm = 0;
    for (const { r, sideA } of tacticMatches(200, 'EARLY_AGGRO', 'STEADY_MACRO', 100)) {
      for (const e of r.events) if (e.type === 'GANK' && e.t < 720) { if (e.side === sideA) ea++; else sm++; }
      expect(r.durationSec).toBeLessThan(45 * 60);
    }
    expect(ea / 200).toBeGreaterThan((sm / 200) * 2);
  }, 120_000);

  it('SPLIT_PUSH teams split push; TEAMFIGHT_PUSH teams fight more teamfights after 12 minutes', () => {
    const split = tacticMatches(40, 'SPLIT_PUSH', 'STEADY_MACRO', 300);
    const splitEvents = split.reduce((a, { r, sideA }) => a + r.events.filter((e) => e.type === 'SPLIT_PUSH' && e.side === sideA).length, 0);
    expect(splitEvents / 40).toBeGreaterThan(1);
    // Teamfights per minute of play after the 12-minute mark.
    const lateFights = (ms: { r: MatchResult }[]) => {
      const fights = ms.reduce((a, { r }) => a + r.events.filter((e) => e.type === 'TEAMFIGHT_START' && e.t >= 720).length, 0);
      const minutes = ms.reduce((a, { r }) => a + Math.max(0, r.durationSec - 720) / 60, 0);
      return fights / minutes;
    };
    const tfp = tacticMatches(60, 'TEAMFIGHT_PUSH', 'TEAMFIGHT_PUSH', 400);
    const steady = tacticMatches(60, 'STEADY_MACRO', 'STEADY_MACRO', 400);
    expect(lateFights(tfp)).toBeGreaterThan(lateFights(steady));
  }, 120_000);

  it('a hero at low health decides to retreat', () => {
    const s = createMatch(mirrorInput(3), data);
    for (let i = 0; i < 120; i++) step(s);
    const h = s.heroes[2]!;
    h.hp = h.maxHp * 0.08;
    h.coef = { ...h.coef, decisionChance: 1 };
    decideUtility(s, h);
    expect(h.action).toBe('RETREAT');
  });

  it('a high-awareness hero dies to ganks less often than a low-awareness one (200 matches)', () => {
    let hiDeaths = 0;
    let loDeaths = 0;
    const games = tacticMatches(200, 'EARLY_AGGRO', 'EARLY_AGGRO', 700, (a, b) => {
      // Same mid player on both sides except awareness.
      a.players[2]!.attrs.awareness = 90;
      b.players[2]!.attrs.awareness = 40;
    });
    for (const { r } of games) {
      for (const e of r.events) {
        if (e.type !== 'KILL') continue;
        if (e.targets?.[0] === 'A3') hiDeaths++;
        if (e.targets?.[0] === 'B3') loDeaths++;
      }
    }
    expect(hiDeaths).toBeLessThan(loDeaths);
  }, 120_000);
});
