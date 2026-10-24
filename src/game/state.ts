// Management game state (P0): one player club, 5 AI clubs, a 10-round league.
// Everything here is plain JSON so it can be saved as-is.

import type { Authority, ClubId, ClubStyle, FacilityId, ManagementStyle, Player, PlayerId, Side, SponsorGoal, StaffId, StaffMember, StaffRole, Tactic, TeamLineup, TrainingFocus } from '../core/types';

/** The player's training choice: a fixed focus, or AUTO (rest when tired, otherwise rotate). */
export type TrainingPlan = TrainingFocus | 'AUTO';

export const PLAYER_CLUB_ID = 'player';

export interface ClubState {
  id: ClubId;
  name: string;
  shortName: string;
  color: string;
  style: ClubStyle | 'PLAYER';
  roster: PlayerId[];
  reputation: number; // 0-100
  management: ManagementStyle | 'PLAYER';
  funds: number; // AI clubs only; the player's money is GameState.funds
  facilities: Record<FacilityId, number>; // room levels, 1-3 (P2)
}

export type SeasonPhase = 'PRESEASON' | 'REGULAR' | 'PLAYOFFS' | 'FINISHED';

export interface Calendar {
  season: number; // 1-based
  phase: SeasonPhase;
  day: number; // days since the start of this season (0-based)
}

export type InboxKind = 'INFO' | 'MATCH' | 'OFFER' | 'CONTRACT' | 'FINANCE' | 'SEASON';

export interface InboxMessage {
  id: number;
  season: number;
  day: number;
  kind: InboxKind;
  title: string;
  body: string;
  read: boolean;
  /** Machine-readable payload for actionable messages (offers, renewals). */
  data?: Record<string, string | number>;
}

export interface SeasonRecord {
  season: number;
  table: { clubId: ClubId; name: string; wins: number; losses: number }[];
  champion: ClubId | null;
  playerRank: number;
  playerPlayoff: 'CHAMPION' | 'FINAL' | 'SEMI' | 'NONE';
  fundsEnd: number;
}

export interface PlayoffMatch {
  stage: 'SEMI' | 'FINAL';
  index: number;
  blue: ClubId;
  red: ClubId;
  seed: number;
  winner: ClubId | null;
  day: number; // day of the season the game is played
}

/** The player club's main sponsor deal. */
export interface SponsorContract {
  sponsorId: string;
  name: string;
  weekly: number;
  winBonus: number;
  untilSeason: number; // last season of the deal
  goals?: SponsorGoal[]; // T27
}

/** A transfer bid. Player bids are answered at once; AI bids for the player's players wait in the inbox. */
export interface TransferOffer {
  id: number;
  season: number;
  day: number;
  buyer: ClubId;
  seller: ClubId;
  playerId: PlayerId;
  fee: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
}

/** A contract renewal talk with one of the player's players (one per player per season). */
export interface Negotiation {
  playerId: PlayerId;
  season: number;
  ask: number; // weekly salary the player wants
  countered: boolean; // the one counter offer has been used
  status: 'OPEN' | 'AGREED' | 'REFUSED';
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

export type LedgerKind = 'SALARY' | 'SPONSOR' | 'PRIZE' | 'SIGNING' | 'RELEASE' | 'TRANSFER' | 'LEAGUE' | 'MERCH' | 'TRAINING' | 'FACILITY' | 'UPKEEP' | 'STAFF';

export interface LedgerEntry {
  week: number; // round index the entry belongs to (0-based); -1 = before the season
  kind: LedgerKind;
  amount: number; // + income, - expense
  note: string;
}

export interface StoredReport {
  round: number; // league round, or totalRounds + 0/1 for semi-final/final
  stage?: 'LEAGUE' | 'SEMI' | 'FINAL';
  season?: number;
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
  // P1
  calendar: Calendar;
  training: TrainingPlan; // the player's weekly training; AUTO decides each Monday (F1)
  inbox: InboxMessage[];
  nextMessageId: number;
  history: SeasonRecord[];
  playoffs: PlayoffMatch[];
  offers: TransferOffer[];
  negotiations: Negotiation[];
  sponsor: SponsorContract | null;
  // P2
  chemistry: Record<string, number>; // pairKey(a, b) -> 0-100, how well two players play together
  hallOfFame: HallOfFameEntry[];
  awards: SeasonAward[];
  // P3
  staff: Record<StaffId, StaffMember>; // candidates and the player's hires
  staffMarket: StaffId[]; // candidates this off-season
  delegation: Delegation;
  pending: PendingDecision[]; // waiting for the player's yes or no
  decisionLog: DecisionEntry[]; // newest last, capped (staff.json delegation.logMax)
  nextDecisionId: number;
}

/** Who runs what on the player's club, and how freely (P3). */
export interface Delegation {
  roles: Record<StaffRole, { staffId: StaffId | null; authority: Authority }>;
  limit: number; // under SMALL, deals up to this much are done without asking
  protectTop: number; // the strongest starters staff may not sell
}

/** Something a staff member wants to do that needs the player's approval (T32). */
export interface PendingDecision {
  id: number;
  role: StaffRole;
  staffId: StaffId;
  kind: string; // e.g. 'SIGN', 'SELL', 'RENEW', 'FACILITY'
  text: string; // what, in a few words
  reason: string;
  cost: number; // money it moves (negative = spend)
  season: number;
  day: number;
  expiresDay: number;
  payload: Record<string, string | number>; // what to do when approved
  big: boolean; // pauses the calendar (selling a core player, going over budget)
}

/** One line of the decision log (T31): what was done, why, what it cost, and later how it went. */
export interface DecisionEntry {
  id: number;
  season: number;
  day: number;
  role: StaffRole;
  staffName: string;
  kind: string;
  text: string;
  reason: string;
  cost: number;
  status: 'DONE' | 'ADVICE' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  result?: string;
}

/** A retired player worth remembering (T27). */
export interface HallOfFameEntry {
  playerId: PlayerId;
  name: string;
  retiredSeason: number;
  seasons: number;
  titles: number;
  played: number;
  peakOvr: number;
  mainClub: string; // the club the player played most seasons for
  mvps?: number; // season MVP awards
}

/** The best player of a season (T27). */
export interface SeasonAward {
  season: number;
  mvpId: PlayerId;
  mvpName: string;
  clubId: ClubId;
  clubName: string;
}

/** Key of the chemistry between two players (order does not matter). */
export function pairKey(a: PlayerId, b: PlayerId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
