// Personality traits and growth type for a player (P2, T21).
// Decided by a hash of the player id, not by the game's random numbers: the same player
// always has the same personality, and giving players one does not shift any other
// random outcome (matches, talent intake...).

import type { GrowthConfig, GrowthType, TraitsConfig } from './types';
import { GROWTH_TYPES } from './types';

/** A stable number in [0, 1) for a text. */
function unit(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function weighted<T>(items: readonly T[], weight: (t: T) => number, r: number): T | null {
  const total = items.reduce((a, t) => a + weight(t), 0);
  if (total <= 0) return null;
  let x = r * total;
  for (const t of items) {
    x -= weight(t);
    if (x < 0) return t;
  }
  return items[items.length - 1] ?? null;
}

export function personalityFor(id: string, traits: TraitsConfig, growth: GrowthConfig): { traits: string[]; growthType: GrowthType } {
  const counts = traits.countWeights.map((_, i) => i);
  const count = weighted(counts, (n) => traits.countWeights[n]!, unit(`${id}#count`)) ?? 0;
  const chosen: string[] = [];
  for (let k = 0; k < count; k++) {
    const blocked = new Set(chosen.flatMap((c) => [c, ...(traits.traits.find((t) => t.id === c)?.excludes ?? [])]));
    const open = traits.traits.filter((t) => !blocked.has(t.id) && !(t.excludes ?? []).some((x) => chosen.includes(x)));
    const pick = weighted(open, (t) => t.weight, unit(`${id}#trait${k}`));
    if (pick) chosen.push(pick.id);
  }
  const growthType = weighted(GROWTH_TYPES, (g) => growth.growthTypes[g].weight, unit(`${id}#growth`)) ?? 'NORMAL';
  return { traits: chosen, growthType };
}

/** The sum of one effect over a player's traits (T24); 0 when none of them has it. */
export function traitEffect(traits: TraitsConfig, ids: readonly string[] | undefined, effect: string): number {
  let v = 0;
  for (const id of ids ?? []) v += traits.traits.find((t) => t.id === id)?.effects[effect] ?? 0;
  return v;
}
