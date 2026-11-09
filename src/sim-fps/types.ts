// Shooter division (P4, T36): a 5v5 bomb-defusal match. Everything here is independent of
// the MOBA engine: its own roles, attributes, tactics and events.

export type FpsRole = 'ENTRY' | 'AWP' | 'IGL' | 'SUPPORT' | 'LURK';
export const FPS_ROLES: readonly FpsRole[] = ['ENTRY', 'AWP', 'IGL', 'SUPPORT', 'LURK'];
export type FpsAttr = 'aim' | 'reaction' | 'positioning' | 'teamwork' | 'mental';
export const FPS_ATTRS: readonly FpsAttr[] = ['aim', 'reaction', 'positioning', 'teamwork', 'mental'];
export type FpsTactic = 'RUSH' | 'DEFAULT' | 'FAKE' | 'SLOW';
export const FPS_TACTICS: readonly FpsTactic[] = ['RUSH', 'DEFAULT', 'FAKE', 'SLOW'];
export type FpsSide = 'BLUE' | 'RED';
export type FpsSite = 'A' | 'B';

export interface FpsConfig {
  name: string;
  roundsToWin: number;
  halfRounds: number; // rounds before the teams swap attack and defence
  roundSec: number;
  bombSec: number;
  roles: Record<FpsRole, { name: string; description: string }>;
  attrs: Record<FpsAttr, string>;
  tactics: Record<FpsTactic, { name: string; description: string; entryBonus: number; executeSec: number; tradeBonus: number; retakeBonus: number }>;
  tacticEdge: Partial<Record<FpsTactic, Partial<Record<FpsTactic, number>>>>; // duel bonus of the row tactic against the column tactic
  power: {
    weights: Record<FpsAttr, number>;
    roleFocus: Record<FpsRole, Partial<Record<FpsAttr, number>>>; // extra weight of an attribute in that role
    duelScale: number; // rating points that turn an even duel into about 73%
    defenderHold: number;
    postPlantHold: number;
    awpOpening: number;
    offRole: number;
    secondaryRole: number;
    formPerPoint: number;
    numbersPerMan: number;
    tradeBase: number;
    tradePerTeamwork: number;
    tradeAdvantage: number;
    supportTrade: number;
    iglBase: number;
    iglPerPoint: number;
    lurkFlank: number;
    lurkClutch: number;
    clutchMentalPer: number;
    behindMentalPer: number;
    fakeBase: number;
    fakePerPoint: number;
    fakePull: number;
    siteDefenders: number;
    rotateSec: number;
    plantSec: number;
    defuseSec: number;
    duelSecMin: number;
    duelSecMax: number;
  };
  economy: {
    start: number;
    win: number;
    lossBase: number;
    lossStep: number;
    lossMax: number;
    plantBonus: number;
    killBonus: number;
    max: number;
    loadouts: { id: string; name: string; cost: number; power: number }[]; // cheapest first
  };
}

export interface FpsPlayerInput {
  id: string;
  name: string;
  role: FpsRole; // the role played in this match
  primaryRole: FpsRole;
  secondaryRole?: FpsRole;
  attrs: Record<FpsAttr, number>; // 0-100
  form?: number; // -10..+10
}

export interface FpsTeamInput {
  id: string;
  name: string;
  tactic: FpsTactic;
  players: FpsPlayerInput[]; // five, one per role
}

export interface FpsMatchInput {
  seed: number;
  blue: FpsTeamInput; // attacks first
  red: FpsTeamInput;
}

export type FpsEvent =
  | { t: number; type: 'KILL'; killer: string; victim: string; side: FpsSide; where: FpsSite | 'MID'; trade?: boolean; opening?: boolean; flank?: boolean }
  | { t: number; type: 'FAKE'; side: FpsSide; site: FpsSite; worked: boolean }
  | { t: number; type: 'PLANT'; by: string; site: FpsSite }
  | { t: number; type: 'DEFUSE'; by: string }
  | { t: number; type: 'EXPLODE' }
  | { t: number; type: 'TIMEOUT' };

export type FpsRoundReason = 'ELIMINATION' | 'EXPLODE' | 'DEFUSE' | 'TIMEOUT';

export interface FpsRound {
  n: number; // 1-based
  attackers: FpsSide;
  site: FpsSite;
  buy: Record<FpsSide, string>; // loadout id
  winner: FpsSide;
  reason: FpsRoundReason;
  score: Record<FpsSide, number>; // after the round
  events: FpsEvent[];
  clutch?: string; // a player who won the round alone against two or more
}

export interface FpsPlayerStats {
  id: string;
  name: string;
  side: FpsSide;
  role: FpsRole;
  kills: number;
  deaths: number;
  trades: number;
  openings: number;
  plants: number;
  defuses: number;
  clutches: number;
  rating: number; // 0-10, one decimal
}

export interface FpsReport {
  headline: string;
  keyReasons: string[];
  mvp: string;
}

export interface FpsMatchResult {
  winner: FpsSide;
  score: Record<FpsSide, number>;
  rounds: FpsRound[];
  stats: FpsPlayerStats[];
  report: FpsReport;
  checksum: string;
}
