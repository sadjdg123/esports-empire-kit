// Card division (P4, T37): the match engine. Pure and deterministic. A game is played turn by
// turn: each deck type has its own curve of pressure, defence and healing; the player's skill,
// how well he knows the deck, his reads and his mistakes move the numbers.

import { createRng, hashString, type Rng } from '../core/rng';
import {
  CARD_ATTRS, type CardConfig, type CardDeck, type CardGame, type CardMatchInput, type CardMatchResult, type CardNote, type CardPlayerInput,
  type CardPlayerStats, type CardSeries, type CardSide, type CardTurn,
} from './types';
import { buildCardReport } from './report';

const other = (s: CardSide): CardSide => (s === 'BLUE' ? 'RED' : 'BLUE');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const DEFAULT_PROFICIENCY = 30;

/** A player's plain ability, the same with every deck (used by the management side). */
export function cardOverall(cfg: CardConfig, attrs: CardPlayerInput['attrs']): number {
  let sum = 0, weight = 0;
  for (const a of CARD_ATTRS) { sum += cfg.skill.weights[a] * attrs[a]; weight += cfg.skill.weights[a]; }
  return sum / weight;
}

export function cardProficiency(p: Pick<CardPlayerInput, 'decks'>, deck: CardDeck): number {
  return p.decks[deck] ?? DEFAULT_PROFICIENCY;
}

/** A player's strength with the deck he brought, 0-100. */
export function cardStrength(cfg: CardConfig, p: CardPlayerInput): number {
  const share = cfg.skill.proficiencyShare;
  return (cardOverall(cfg, p.attrs) * (1 - share) + cardProficiency(p, p.deck) * share) * (1 + (p.form ?? 0) * cfg.skill.formPerPoint);
}

interface Seat { p: CardPlayerInput; side: CardSide; strength: number; stats: CardPlayerStats }

function playGame(cfg: CardConfig, rng: Rng, seats: Record<CardSide, Seat>, first: CardSide, behind: Record<CardSide, number>): CardGame {
  const S = cfg.skill;
  const life: Record<CardSide, number> = { BLUE: cfg.life, RED: cfg.life };
  life[other(first)] += S.secondPlayerLife; // going second starts with a little more
  const turns: CardTurn[] = [];
  // The luck of the draw for this game: a good or a bad hand for each player.
  const hand: Record<CardSide, number> = { BLUE: 1 + (rng.next() + rng.next() - 1) * S.drawLuck, RED: 1 + (rng.next() + rng.next() - 1) * S.drawLuck };
  /** How well this player is playing this turn: 1 is par. */
  const level = (seat: Seat, turn: number): number => {
    let f = 1 + (seat.strength - 60) * S.perPoint;
    if (turn >= S.lateTurn) f += (seat.p.attrs.macro - 50) * S.lateMacroPer;
    f -= behind[seat.side] * S.behindMentalPer * (1 - seat.p.attrs.mental / 100);
    return Math.max(0.3, f);
  };
  for (let turn = 1; turn <= cfg.maxTurns; turn++) {
    for (const side of [first, other(first)]) {
      const me = seats[side], foe = seats[other(side)];
      const mine = cfg.decks[me.p.deck], theirs = cfg.decks[foe.p.deck];
      const notes: CardNote[] = [];
      const i = turn - 1;
      // Healing first (control stabilises).
      const healed = Math.min(Math.max(0, cfg.life - life[side]), Math.round((mine.heal[i] ?? 0) * level(me, turn)));
      if (healed > 0) { life[side] += healed; if (life[side] - healed <= cfg.life * 0.4) notes.push('STABILIZE'); }
      // A combo deck goes for the kill from its key turn on.
      let damage = 0;
      if (me.p.deck === 'COMBO' && turn >= cfg.combo.turn) {
        const go = cfg.combo.base + cfg.combo.perTurn * (turn - cfg.combo.turn) + cfg.combo.perSkill * (me.strength - 60);
        if (rng.chance(clamp(go, 0.05, 0.9))) {
          const stop = cfg.combo.disrupt[foe.p.deck] + cfg.combo.disruptPerRead * (foe.p.attrs.read - 50);
          if (rng.chance(clamp(stop, 0, 0.8))) { notes.push('COMBO_STOPPED'); foe.stats.reads++; }
          else { damage = life[other(side)]; notes.push('COMBO'); me.stats.combos++; }
        }
      }
      if (damage === 0) {
        let pressure = (mine.pressure[i] ?? 0) * level(me, turn) * (cfg.edge[me.p.deck][foe.p.deck] ?? 1) * hand[side] * (1 + (rng.next() * 2 - 1) * S.swing);
        if (rng.chance(clamp(S.misplayBase - S.misplayPerCalc * me.p.attrs.calc, 0.01, 0.5))) { pressure *= S.misplayFactor; notes.push('MISPLAY'); me.stats.misplays++; }
        const guard = (theirs.guard[i] ?? 0) * level(foe, turn);
        // A read: the defender saw it coming and takes only part of it.
        if (pressure >= 2 && rng.chance(clamp(S.readBase + S.readPer * (foe.p.attrs.read - 50), 0.01, 0.6))) { pressure *= S.readGuard; notes.push('READ'); foe.stats.reads++; }
        damage = Math.max(0, Math.round(pressure - guard));
      }
      damage = Math.min(damage, life[other(side)]);
      life[other(side)] -= damage;
      me.stats.damage += damage;
      if (life[other(side)] <= 0) notes.push('LETHAL');
      turns.push({ turn, side, damage, healed, life: { ...life }, notes });
      if (life[other(side)] <= 0) return { first, winner: side, turns, byTime: false };
    }
  }
  const winner: CardSide = life.BLUE !== life.RED ? (life.BLUE > life.RED ? 'BLUE' : 'RED') : rng.chance(0.5) ? 'BLUE' : 'RED';
  return { first, winner, turns, byTime: true };
}

/** Plays a team match: seat against seat, each a series of games. */
export function runCardMatch(input: CardMatchInput, cfg: CardConfig): CardMatchResult {
  const rng = createRng(input.seed);
  const seat = (p: CardPlayerInput, side: CardSide): Seat => ({
    p, side, strength: cardStrength(cfg, p),
    stats: { id: p.id, name: p.name, side, deck: p.deck, gamesWon: 0, gamesLost: 0, seriesWon: false, played: false, damage: 0, reads: 0, misplays: 0, combos: 0, rating: 0 },
  });
  const blue = input.blue.players.map((p) => seat(p, 'BLUE'));
  const red = input.red.players.map((p) => seat(p, 'RED'));
  const score: Record<CardSide, number> = { BLUE: 0, RED: 0 };
  const series: CardSeries[] = [];
  for (let k = 0; k < cfg.teamSize && score.BLUE < cfg.seriesToWin && score.RED < cfg.seriesToWin; k++) {
    const seats: Record<CardSide, Seat> = { BLUE: blue[k]!, RED: red[k]! };
    seats.BLUE.stats.played = seats.RED.stats.played = true;
    const won: Record<CardSide, number> = { BLUE: 0, RED: 0 };
    const games: CardGame[] = [];
    let first: CardSide = rng.chance(0.5) ? 'BLUE' : 'RED';
    while (won.BLUE < cfg.gamesToWin && won.RED < cfg.gamesToWin) {
      const behind = { BLUE: Math.max(0, won.RED - won.BLUE), RED: Math.max(0, won.BLUE - won.RED) };
      const g = playGame(cfg, rng, seats, first, behind);
      games.push(g);
      won[g.winner]++;
      seats[g.winner].stats.gamesWon++;
      seats[other(g.winner)].stats.gamesLost++;
      first = other(g.winner); // the loser starts the next game
    }
    const winner: CardSide = won.BLUE > won.RED ? 'BLUE' : 'RED';
    seats[winner].stats.seriesWon = true;
    score[winner]++;
    series.push({ seat: k, blue: seats.BLUE.p.id, red: seats.RED.p.id, decks: { BLUE: seats.BLUE.p.deck, RED: seats.RED.p.deck }, games, winner });
  }
  const winner: CardSide = score.BLUE > score.RED ? 'BLUE' : 'RED';
  const stats = [...blue, ...red].map((s) => {
    const st = s.stats;
    const games = st.gamesWon + st.gamesLost;
    const rating = !st.played ? 0 : clamp(5 + 3 * ((st.gamesWon - st.gamesLost) / Math.max(1, games)) + (st.seriesWon ? 1 : -0.5) + 0.2 * st.reads - 0.2 * st.misplays + 0.3 * st.combos, 0, 10);
    return { ...st, rating: Math.round(rating * 10) / 10 };
  });
  const checksum = hashString(JSON.stringify(series.map((s) => [s.winner, s.games.map((g) => [g.winner, g.turns.length, g.turns.map((t) => t.damage)])]))).toString(16).padStart(8, '0');
  return { winner, score, series, stats, report: buildCardReport(cfg, input, { winner, score, series, stats }), checksum };
}
