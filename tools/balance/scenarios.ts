// Balance scenarios for GDD 16.1 (G1-G9). Each scenario turns an index into a
// match input plus the side whose win rate the scenario measures.

import { createRng, type Rng } from '../../src/core/rng';
import { ROLES, TACTICS, type GameData, type MatchInput, type Side, type Tactic } from '../../src/core/types';
import { cloneTeam, clubTeam, heroesForRole, syntheticTeam, type TeamInput } from '../../src/sim/scenario';

export type ScenarioId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'POOL';

export interface ScenarioCase {
  input: MatchInput;
  focus: Side; // side whose win rate we measure
  tags: Record<string, string>;
}

const PAIRS: [Tactic, Tactic][] = [];
for (let i = 0; i < TACTICS.length; i++) for (let j = i + 1; j < TACTICS.length; j++) PAIRS.push([TACTICS[i]!, TACTICS[j]!]);
export const TACTIC_PAIRS = PAIRS;

function heroesPick(data: GameData, rng: Rng) {
  return Object.fromEntries(ROLES.map((r) => [r, rng.pick(heroesForRole(data, r))]));
}

function place(i: number, focusTeam: TeamInput, other: TeamInput, seed: number): { input: MatchInput; focus: Side } {
  const focusBlue = i % 2 === 0;
  return { input: { seed, blue: focusBlue ? focusTeam : other, red: focusBlue ? other : focusTeam }, focus: focusBlue ? 'BLUE' : 'RED' };
}

export function buildCase(data: GameData, id: ScenarioId, i: number): ScenarioCase {
  const seed = (hashId(id) * 100_003 + i * 7_919) >>> 0;
  const rng = createRng(seed);
  switch (id) {
    case 'G1': {
      const clubs = data.clubs.map((c) => c.id);
      const b = clubs[i % clubs.length]!;
      const r = clubs[(i * 3 + 1) % clubs.length]!;
      return { input: { seed, blue: clubTeam(data, b, rng.pick(TACTICS)), red: clubTeam(data, r, rng.pick(TACTICS)) }, focus: 'BLUE', tags: {} };
    }
    case 'G2': {
      const tactic = rng.pick(TACTICS);
      const blue = syntheticTeam(data, rng, { idPrefix: 'B', tactic, ability: rng.int(45, 75) });
      return { input: { seed, blue, red: cloneTeam(blue, 'R') }, focus: 'BLUE', tags: { tactic } };
    }
    case 'G3': {
      const tactic = rng.pick(TACTICS);
      const ability = rng.int(45, 60);
      const heroes = heroesPick(data, rng);
      const strong = syntheticTeam(data, rng, { idPrefix: 'S', tactic, ability: ability + 15, heroes });
      const weak = syntheticTeam(data, rng, { idPrefix: 'W', tactic, ability, heroes });
      const p = place(i, strong, weak, seed);
      return { ...p, tags: { tactic } };
    }
    case 'G4': {
      const pairIdx = i % PAIRS.length;
      const k = Math.floor(i / PAIRS.length);
      const [ta, tb] = PAIRS[pairIdx]!;
      const base = syntheticTeam(data, rng, { idPrefix: 'X', tactic: ta, ability: rng.int(45, 75) });
      const p = place(k, cloneTeam(base, 'A', ta), cloneTeam(base, 'B', tb), seed);
      return { ...p, tags: { a: ta, b: tb } };
    }
    case 'G5': {
      const tactic = rng.pick(TACTICS);
      const ability = rng.int(45, 75);
      const heroes = heroesPick(data, rng);
      const hi = syntheticTeam(data, rng, { idPrefix: 'M', tactic, ability, heroes, mastery: 90 });
      const lo = cloneTeam(hi, 'L');
      for (const pl of lo.players) for (const h of Object.keys(pl.heroMastery)) pl.heroMastery[h] = 40;
      return { ...place(i, hi, lo, seed), tags: { tactic } };
    }
    case 'G6': {
      const tactic = rng.pick(TACTICS);
      const ability = rng.int(45, 75);
      const heroes = heroesPick(data, rng);
      const normal = syntheticTeam(data, rng, { idPrefix: 'N', tactic, ability, heroes });
      const off = cloneTeam(normal, 'O');
      off.players.forEach((pl, k) => {
        pl.primaryRole = ROLES[(k + 2) % ROLES.length]!;
        pl.secondaryRole = ROLES[(k + 3) % ROLES.length]!;
      });
      return { ...place(i, normal, off, seed), tags: { tactic } };
    }
    case 'POOL': {
      const ability = rng.int(45, 75);
      const blue = syntheticTeam(data, rng, { idPrefix: 'B', tactic: rng.pick(TACTICS), ability });
      const red = syntheticTeam(data, rng, { idPrefix: 'R', tactic: rng.pick(TACTICS), ability });
      return { input: { seed, blue, red }, focus: 'BLUE', tags: {} };
    }
  }
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
