import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import type { Tactic } from '../../src/core/types';
import { createMatch, type MatchState } from '../../src/sim';
import { atNode, nodeIndex } from '../../src/sim/map';
import { cloneTeam, syntheticTeam, type SyntheticOptions } from '../../src/sim/scenario';
import type { BrainKind } from '../../src/sim/state';

export const data = loadGameData();

export function mirrorInput(seed: number, tactic: Tactic = 'STEADY_MACRO', extra: Partial<SyntheticOptions> = {}) {
  const rng = createRng(seed * 7919 + 1);
  const blue = syntheticTeam(data, rng, { idPrefix: 'B', tactic, ability: 60, ...extra });
  const red = cloneTeam(blue, 'R');
  return { seed, blue, red };
}

/** A match where only the given heroes are alive, standing on `nodeId`. */
export function duel(nodeId: string, blueRoles: number[], redRoles: number[], brain: BrainKind = 'simple', extra: Partial<SyntheticOptions> = {}): MatchState {
  const s = createMatch(mirrorInput(1, 'STEADY_MACRO', extra), data, { brain });
  const node = nodeIndex(s.map, nodeId);
  for (const h of s.heroes) {
    const keep = h.side === 'BLUE' ? blueRoles.includes(h.idx) : redRoles.includes(h.idx - 5);
    if (!keep) {
      h.alive = false;
      h.respawnAt = 1e9;
    } else {
      h.loc = atNode(node);
      h.skillReadyAt = 1e9;
    }
  }
  s.nextWaveAt = 1e9; // no creeps
  for (const c of s.camps) c.nextSpawnAt = 1e9;
  for (const o of s.objectives) o.nextSpawnAt = 1e9;
  return s;
}
