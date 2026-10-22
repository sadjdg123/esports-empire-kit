// Management game state (P0): one player club, 5 AI clubs, a 10-round league.
// Everything here is plain JSON so it can be saved as-is.

import type { ClubId, ClubStyle, Player, PlayerId, Side, Tactic, TeamLineup } from '../core/types';

export const PLAYER_CLUB_ID = 'player';

export interface ClubState {
  id: ClubId;
  name: string;
  shortName: string;
  color: string;
  style: ClubStyle | 'PLAYER';
  roster: PlayerId[];
}

export interface Fixture {
  round: number; // 0-based
  index: number; // position within the round
  blue: ClubId;
  red: ClubId;
  seed: number;
}

export interface FixtureResult {
  round: number;
  index: number;
  blue: ClubId;
  red: ClubId;
  winner: ClubId;
  winnerSide: Side;
  durationSec: number;
  kills: { blue: number; red: number };
  blueTactic: Tactic;
  redTactic: Tactic;
  checksum: string;
}

export type LedgerKind = 'SALARY' | 'SPONSOR' | 'PRIZE' | 'SIGNING' | 'RELEASE';

export interface LedgerEntry {
  week: number; // round index the entry belongs to (0-based); -1 = before the season
  kind: LedgerKind;
  amount: number; // + income, - expense
  note: string;
}

export interface StoredReport {
  round: number;
  opponent: ClubId;
  won: boolean;
  headline: string;
  keyReasons: { text: string; eventRefs: number[] }[];
  mvp: PlayerId;
  ratings: { playerId: PlayerId; rating: number }[];
  durationSec: number;
  kills: { mine: number; theirs: number };
  goldDiffTimeline: { t: number; diff: number }[]; // from the player's point of view
}

export interface GameState {
  seed: number;
  week: number; // next round to play (0-based); equals totalRounds when the season is over
  totalRounds: number;
  startingFunds: number;
  funds: number;
  club: ClubState; // the player's club
  lineup: TeamLineup | null;
  aiClubs: ClubState[];
  players: Record<PlayerId, Player>;
  market: PlayerId[]; // free agents, in stable order
  schedule: Fixture[][]; // rounds -> fixtures
  results: FixtureResult[];
  ledger: LedgerEntry[];
  reports: StoredReport[];
  rngState: number[];
}
