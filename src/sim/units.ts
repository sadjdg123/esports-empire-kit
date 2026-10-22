// Unit records for a match and their movement. Units are plain objects so the
// whole match state stays serialisable and easy to inspect.

import type { HeroDef, Lane, Player, Role, Side } from '../core/types';
import { atNode, moveAlongPath, moveToward, type GameMap, type Loc } from './map';

export interface CreepWave {
  id: string;
  kind: 'CREEP';
  side: Side;
  lane: Lane;
  loc: Loc;
  nextIdx: number; // index into the lane path (in travel order) of the next node
  hp: number;
  maxHp: number;
  attack: number;
  structureAttack: number;
  alive: boolean;
  lastHitBy: number; // hero index or -1
}

export interface CreepSpawnStats {
  hp: number;
  attack: number;
  structureAttack: number;
}

/** Lane node path in the travel direction of the given side. */
export function lanePathFor(map: GameMap, lane: Lane, side: Side): number[] {
  const path = map.lanes[lane];
  return side === 'BLUE' ? path : [...path].reverse();
}

export function spawnWave(map: GameMap, id: string, side: Side, lane: Lane, stats: CreepSpawnStats): CreepWave {
  const path = lanePathFor(map, lane, side);
  return {
    id,
    kind: 'CREEP',
    side,
    lane,
    loc: atNode(path[0]!),
    nextIdx: 1,
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack,
    structureAttack: stats.structureAttack,
    alive: true,
    lastHitBy: -1,
  };
}

export function moveWave(map: GameMap, wave: CreepWave, distance: number): void {
  const path = lanePathFor(map, wave.lane, wave.side);
  const res = moveAlongPath(map, wave.loc, path, wave.nextIdx, distance);
  wave.loc = res.loc;
  wave.nextIdx = res.nextIdx;
}

// ---------------------------------------------------------------------------
// Heroes

export interface HeroUnit {
  idx: number; // position in MatchState.heroes
  id: string; // unit id, e.g. 'BLUE:TOP'
  kind: 'HERO';
  side: Side;
  role: Role;
  player: Player;
  hero: HeroDef;
  loc: Loc;
  alive: boolean;
  respawnAt: number;
  hp: number;
  maxHp: number;
  shield: number;
  shieldUntil: number;
  level: number;
  xp: number;
  gold: number; // total earned (no shop: gold converts to stats)
  skillReadyAt: number;
  stunnedUntil: number;
  slowedUntil: number;
  // Precomputed per-match player coefficients.
  coef: HeroCoefficients;
  // AI state
  action: string;
  actionSince: number;
  actionTarget: number; // hero index / lane index / objective index depending on action
  recallDoneAt: number;
  alertUntil: number; // noticed an incoming gank until this time
  noticedGankers: number[];
  ganking: number; // target hero idx when executing a gank, -1 otherwise
  gankHit: boolean; // GANK event already emitted for the current gank
  groupJoinAt: number; // when the delayed group call reaches this hero
  lastDamagedAt: number;
  lastDealtHeroDamageAt: number;
  damagers: { hero: number; t: number }[];
  // stats
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
}

export interface HeroCoefficients {
  damage: number; // mechanics x form x role
  skillHit: number;
  farm: number;
  masteryEffect: number;
  cooldownMult: number;
  performance: number; // form x role
  retreatThreshold: number;
  decisionChance: number;
  decisionNoise: number;
  gankDetect: number;
  groupDelay: number;
  focusChance: number;
  mentalPenalty: number; // multiplier applied while team is far behind
  mastery: number;
  roleFit: 'primary' | 'secondary' | 'off';
}

export function moveHero(map: GameMap, hero: HeroUnit, target: Loc, distance: number): void {
  hero.loc = moveToward(map, hero.loc, target, distance);
}
