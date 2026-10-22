// Match state shared by the engine, combat and AI modules.

import type { Rng } from '../core/rng';
import type { GameData, Lane, MatchConfig, MatchEvent, MatchInput, Side, SnapshotAttack, Tactic } from '../core/types';
import type { GameMap, Loc } from './map';
import type { Camp, CreepWave, HeroUnit, Objective, Structure } from './units';

export type BrainKind = 'utility' | 'simple';

export interface Buff {
  kind: 'ATTACK' | 'SIEGE';
  value: number;
  until: number;
  source: string;
}

export interface TeamState {
  side: Side;
  tactic: Tactic;
  clubId: string;
  heroIdx: number[];
  kills: number;
  buffs: Buff[];
  siegeLane: Lane;
  groupCallAt: number; // -1 when no group call is active
  objectivesTaken: number;
  towersDestroyed: number;
  goldDiff: number; // this team's gold minus the enemy's, refreshed each tick
}

export interface TeamfightState {
  startT: number;
  startEvent: number;
  x: number;
  y: number;
  kills: Record<Side, number>;
  lastActionT: number;
  participants: number[]; // hero indices
}

/** A queued effect, applied after every unit has chosen its action for the tick. */
export interface PendingOp {
  op: 'DAMAGE' | 'HEAL' | 'SHIELD' | 'STUN' | 'SLOW';
  targetKind: 'HERO' | 'CREEP' | 'STRUCTURE' | 'OBJECTIVE' | 'CAMP';
  target: number; // index into the matching array
  amount: number; // damage/heal/shield amount, or seconds for STUN/SLOW
  sourceHero: number; // -1 when not from a hero
  sourceSide: Side | null;
  skill: boolean;
}

export interface MatchState {
  input: MatchInput;
  data: GameData;
  cfg: MatchConfig;
  map: GameMap;
  rng: Rng;
  brain: BrainKind;
  t: number;
  over: boolean;
  winner: Side | null;
  endReason: string;
  heroes: HeroUnit[];
  creeps: CreepWave[];
  structures: Structure[];
  objectives: Objective[];
  camps: Camp[];
  teams: Record<Side, TeamState>;
  events: MatchEvent[];
  tickEventStart: number;
  attacks: SnapshotAttack[];
  pending: PendingOp[];
  skillCasts: { caster: number; targets: number[] }[]; // damaging skill casts this tick
  goldTimeline: { t: number; diff: number }[];
  nextWaveAt: number;
  waveSeq: number;
  overtimeAnnounced: boolean;
  suddenDeathAnnounced: boolean;
  teamfight: TeamfightState | null;
  baseDamageMarks: Record<Side, number>; // last announced hp quarter for BASE_DAMAGED
  // Per-tick position cache (filled at the start of each tick).
  hx: Float64Array;
  hy: Float64Array;
  hloc: Loc[]; // hero locations at the start of the tick
  cx: number[];
  cy: number[];
}

export function enemyOf(side: Side): Side {
  return side === 'BLUE' ? 'RED' : 'BLUE';
}
