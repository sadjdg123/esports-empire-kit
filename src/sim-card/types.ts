// Card division (P4, T37): a team match of one-on-one card games. Independent of the other
// engines: its own attributes, deck types and events.

export type CardDeck = 'AGGRO' | 'MIDRANGE' | 'CONTROL' | 'COMBO';
export const CARD_DECKS: readonly CardDeck[] = ['AGGRO', 'MIDRANGE', 'CONTROL', 'COMBO'];
export type CardAttr = 'calc' | 'read' | 'macro' | 'mental';
export const CARD_ATTRS: readonly CardAttr[] = ['calc', 'read', 'macro', 'mental'];
export type CardSide = 'BLUE' | 'RED';

export interface CardConfig {
  name: string;
  teamSize: number;
  gamesToWin: number; // games to win a series
  seriesToWin: number; // series to win the match
  life: number;
  maxTurns: number; // turns per player
  attrs: Record<CardAttr, string>;
  decks: Record<CardDeck, { name: string; description: string; pressure: number[]; guard: number[]; heal: number[] }>;
  combo: { turn: number; base: number; perTurn: number; perSkill: number; disrupt: Record<CardDeck, number>; disruptPerRead: number };
  edge: Record<CardDeck, Partial<Record<CardDeck, number>>>; // pressure multiplier of the row deck against the column deck
  skill: {
    weights: Record<CardAttr, number>;
    proficiencyShare: number; // how much of a player's strength comes from knowing the deck
    perPoint: number; // pressure and guard change per point of strength away from 60
    secondPlayerLife: number; // extra life for the player going second
    drawLuck: number; // a whole game's good or bad hand: +- this share
    swing: number; // luck of the draw: +- this share each turn
    misplayBase: number;
    misplayPerCalc: number;
    misplayFactor: number;
    readBase: number;
    readPer: number;
    readGuard: number;
    lateTurn: number;
    lateMacroPer: number;
    behindMentalPer: number;
    formPerPoint: number;
  };
}

export interface CardPlayerInput {
  id: string;
  name: string;
  attrs: Record<CardAttr, number>; // 0-100
  decks: Partial<Record<CardDeck, number>>; // proficiency 0-100, unlisted decks count as 30
  deck: CardDeck; // the deck brought to this match
  form?: number;
}

export interface CardTeamInput {
  id: string;
  name: string;
  players: CardPlayerInput[]; // in playing order, one per seat
}

export interface CardMatchInput {
  seed: number;
  blue: CardTeamInput;
  red: CardTeamInput;
}

export type CardNote = 'MISPLAY' | 'READ' | 'STABILIZE' | 'COMBO' | 'COMBO_STOPPED' | 'LETHAL';

/** One player's turn. */
export interface CardTurn {
  turn: number; // 1-based, per player
  side: CardSide;
  damage: number;
  healed: number;
  life: Record<CardSide, number>; // after the turn
  notes: CardNote[];
}

export interface CardGame {
  first: CardSide;
  winner: CardSide;
  turns: CardTurn[];
  byTime: boolean; // decided on life after the last turn
}

export interface CardSeries {
  seat: number; // 0-based
  blue: string; // player ids
  red: string;
  decks: Record<CardSide, CardDeck>;
  games: CardGame[];
  winner: CardSide;
}

export interface CardPlayerStats {
  id: string;
  name: string;
  side: CardSide;
  deck: CardDeck;
  gamesWon: number;
  gamesLost: number;
  seriesWon: boolean;
  played: boolean;
  damage: number;
  reads: number;
  misplays: number;
  combos: number;
  rating: number; // 0-10
}

export interface CardReport {
  headline: string;
  keyReasons: string[];
  mvp: string;
}

export interface CardMatchResult {
  winner: CardSide;
  score: Record<CardSide, number>; // series won
  series: CardSeries[];
  stats: CardPlayerStats[];
  report: CardReport;
  checksum: string;
}
