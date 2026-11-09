// Group divisions (P4): the shooter and the card division share one small management model
// (players, contracts, a lineup, a league), while each plays matches with its own engine.

import type { CardDeck, CardMatchResult } from '../sim-card/types';
import type { FpsMatchResult, FpsRole, FpsTactic } from '../sim-fps/types';
import type { Fixture } from './state';

export type BranchKind = 'FPS' | 'CARD';
export const BRANCH_KINDS: readonly BranchKind[] = ['FPS', 'CARD'];

export interface BranchKindConfig {
  name: string;
  game: string;
  open: { reputation: number; cost: number };
  squad: number; // players in a lineup
  rosterMax: number;
  matchWeekday: number; // 0 = Monday
  weeklyUpkeep: number;
  leagueShareWeekly: number;
  prizeWin: number;
  prizeLoss: number;
  finalPrize: { champion: number; runnerUp: number };
  sponsorBonus: number; // share added to the group's weekly sponsor money while this division plays
  reputation: { win: number; loss: number; champion: number; runnerUp: number };
  salary: { base: number; perPoint: number; from: number };
  signingFeeWeeks: number;
  contractYears: number;
  marketSize: number;
  age: { min: number; max: number; peak: number; retire: number };
  growth: { perWeek: number; focusBonus: number; declinePerSeason: number; restForm: number };
  teams: { id: string; name: string; shortName: string; color: string; level: number; tactic: string }[];
  namePool: string[];
}

export interface BranchesConfig {
  kinds: Record<BranchKind, BranchKindConfig>;
  aiLevel: { min: number; max: number; driftPerSeason: number; spread: number };
  marketLevel: { min: number; max: number };
  formSwing: number;
  reportsKept: number;
  logKept: number;
  director: {
    candidates: number;
    skillMin: number;
    skillMax: number;
    salaryBase: number;
    salaryPerSkill: number;
    signingFeeWeeks: number;
    perceptionNoise: number;
    mistakeAtZero: number;
    trainSwitchGap: number; // the director changes the training focus when another attribute is this far behind
    namePool: string[];
  };
}

export interface BranchPlayer {
  id: string;
  name: string;
  age: number;
  attrs: Record<string, number>; // the division's own attributes, 0-100
  primaryRole?: FpsRole; // shooter only
  secondaryRole?: FpsRole;
  decks?: Partial<Record<CardDeck, number>>; // card only: proficiency per deck type
  potential: number;
  salaryPerWeek: number;
  signingFee: number;
  teamId: string | null;
  contractUntil?: number; // last season of the contract (player's team only)
  form: number; // -10..+10
  played: number;
  wins: number;
}

export interface BranchTeam {
  id: string;
  name: string;
  shortName: string;
  color: string;
  level: number;
  tactic: string;
  roster: string[];
}

export type BranchLineup =
  | { kind: 'FPS'; tactic: FpsTactic; slots: { playerId: string; role: FpsRole }[] }
  | { kind: 'CARD'; seats: { playerId: string; deck: CardDeck }[] };

export interface BranchResult {
  round: number; // league round, or totalRounds for the final
  blue: string;
  red: string;
  winner: string;
  score: [number, number]; // blue, red
}

/** A short record of one of the player's matches. */
export interface BranchReport {
  season: number;
  round: number;
  final: boolean;
  opponent: string; // team name
  won: boolean;
  score: [number, number]; // mine, theirs
  headline: string;
  keyReasons: string[];
  mvp: string; // player name
}

/** The player's latest match in full, for the replay. */
export interface BranchReplay {
  season: number;
  round: number;
  final: boolean;
  mySide: 'BLUE' | 'RED';
  names: Record<string, string>; // player id -> name
  teams: { BLUE: { name: string; color: string }; RED: { name: string; color: string } };
  fps?: FpsMatchResult;
  card?: CardMatchResult;
}

export interface BranchSeasonRecord {
  season: number;
  rank: number;
  wins: number;
  losses: number;
  champion: string; // team name
  result: 'CHAMPION' | 'FINAL' | 'NONE';
}

export interface BranchDirector {
  id: string;
  name: string;
  skill: number; // 0-100
  salaryPerWeek: number;
  signingFee: number;
  hiredSeason?: number; // set once hired; a director stays until he is let go
}

export interface BranchLogEntry {
  season: number;
  day: number;
  text: string;
  reason: string;
  cost: number;
}

export interface BranchState {
  kind: BranchKind;
  openedSeason: number;
  startSeason: number; // first season it plays in
  players: Record<string, BranchPlayer>;
  market: string[];
  roster: string[];
  teams: BranchTeam[]; // the five AI teams
  lineup: BranchLineup | null;
  training: string; // an attribute, 'REST', or (card) 'DECK_<type>'
  schedule: Fixture[][];
  round: number; // next league round
  results: BranchResult[];
  finalDone: boolean;
  reports: BranchReport[];
  replay: BranchReplay | null;
  history: BranchSeasonRecord[];
  titles: number;
  director: BranchDirector | null;
  managed: boolean; // true = the director runs it
  candidates: BranchDirector[];
  log: BranchLogEntry[];
  nextId: number;
}
