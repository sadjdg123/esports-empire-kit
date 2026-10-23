// Training, growth, fatigue and morale (P1, GDD 9). Weekly training runs on
// pay day; match effects run when a match is settled; recovery runs daily.

import { rngFromState, type Rng } from '../core/rng';
import type { ClubId, GameData, GrowthConfig, MatchInput, MatchResult, Player, PlayerAttributes, TrainingFocus } from '../core/types';
import { DEFAULT_MASTERY } from '../core/types';
import { clubById, playerOverall, weekOfSeason } from './game';
import { PLAYER_CLUB_ID, type GameState } from './state';
import { facilityValue } from './facilities';
import { traitEffect } from '../core/personality';
import { chemistryFromTraining } from './chemistry';

const ATTRS: readonly (keyof PlayerAttributes)[] = ['mechanics', 'awareness', 'teamwork', 'mental'];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100 || 0; // no -0: JSON cannot keep it

/** Growth rate for an age, linearly interpolated on the age curve and flat beyond its ends. */
export function ageRate(g: GrowthConfig, age: number): number {
  const c = g.ageCurve;
  if (age <= c[0]!.age) return c[0]!.rate;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]!;
    const b = c[i]!;
    if (age <= b.age) return a.rate + ((b.rate - a.rate) * (age - a.age)) / (b.age - a.age);
  }
  return c[c.length - 1]!.rate;
}

/**
 * A player's growth rate: the age curve, shifted by the growth type (T23). An early bloomer
 * (shift −2) at 25 grows like a normal 27-year-old; a late bloomer (+2) like a normal 23-year-old.
 */
export function ageRateOf(g: GrowthConfig, p: Player): number {
  return ageRate(g, p.age - g.growthTypes[p.growthType ?? 'NORMAL'].ageShift);
}

/** Share of normal growth a player still gets: 1 well below potential, 0 at or above it. */
function headroom(g: GrowthConfig, p: Player): number {
  return clamp(((p.potential ?? 100) - playerOverall(p)) / g.potentialSoftCap, 0, 1);
}

function addAttr(p: Player, k: keyof PlayerAttributes, v: number): void {
  p.attrs[k] = round2(clamp(p.attrs[k] + v, 1, 99));
}

function addMastery(p: Player, heroId: string, v: number): void {
  p.heroMastery[heroId] = round2(clamp((p.heroMastery[heroId] ?? DEFAULT_MASTERY) + v, 0, 100));
}

/**
 * The training focus a club uses this week (settled each Monday). AI clubs, and the player
 * on AUTO, rest when the squad is tired and otherwise rotate through the focuses.
 */
export function trainingFocusOf(state: GameState, data: GameData, clubId: ClubId): TrainingFocus {
  if (clubId === PLAYER_CLUB_ID && state.training !== 'AUTO') return state.training;
  const g = data.growth;
  const club = clubById(state, clubId);
  const roster = club.roster.map((id) => state.players[id]!);
  const avgFatigue = roster.reduce((a, p) => a + (p.fatigue ?? 0), 0) / Math.max(1, roster.length);
  const restAt = clubId === PLAYER_CLUB_ID ? g.autoRestFatigue : club.management === 'PLAYER' ? 100 : data.ai.styles[club.management].restFatigue;
  if (avgFatigue >= restAt) return 'REST';
  return g.aiFocusRotation[weekOfSeason(state) % g.aiFocusRotation.length]!;
}

/** Facility boosts for one club's training: multipliers on attribute growth and on hero mastery growth (T22). */
export interface TrainingBoost { growth: number; mastery: number }
const NO_BOOST: TrainingBoost = { growth: 1, mastery: 1 };

export function trainingBoost(state: GameState, data: GameData, clubId: ClubId): TrainingBoost {
  return { growth: 1 + facilityValue(state, data, clubId, 'TRAINING'), mastery: 1 + facilityValue(state, data, clubId, 'ANALYSIS') };
}

/** The club's boost for one player, with a diligent (or lazy) personality on top (T24). */
export function playerTrainingBoost(data: GameData, p: Player, club: TrainingBoost): TrainingBoost {
  const t = 1 + traitEffect(data.traits, p.traits, 'trainingGrowth');
  return { growth: club.growth * t, mastery: club.mastery * t };
}

/** One week of training for one player. */
export function trainPlayer(p: Player, focus: TrainingFocus, g: GrowthConfig, boost: TrainingBoost = NO_BOOST): void {
  const rate = ageRateOf(g, p);
  if (rate < 0) {
    // Decline hits everyone past their peak, training or not.
    for (const k of ATTRS) addAttr(p, k, g.weeklyGrowthBase * rate);
  } else if (focus !== 'REST') {
    const gain = g.weeklyGrowthBase * rate * headroom(g, p) * boost.growth;
    const weights = g.trainingFocus[focus];
    for (const k of ATTRS) addAttr(p, k, gain * (weights[k] ?? g.offFocusShare));
    const masteryWeight = weights.mastery ?? 0;
    if (masteryWeight > 0) {
      const best = Object.entries(p.heroMastery).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, g.masteryFocusHeroes);
      for (const [heroId] of best) addMastery(p, heroId, g.masteryFocusGain * rate * masteryWeight * boost.mastery);
    }
  }
  p.fatigue = clamp((p.fatigue ?? 0) + (focus === 'REST' ? -g.fatigueRestRecovery : g.fatiguePerTrainingWeek), 0, 100);
}

/** Form drifts randomly and is pulled toward a target set by morale. */
export function updateForm(p: Player, g: GrowthConfig, rng: Rng, randomDelta: number): void {
  const target = ((p.morale ?? g.moraleNeutral) - g.moraleNeutral) * g.moraleFormPer;
  const pulled = p.form + (target - p.form) * g.formPull + rng.int(-randomDelta, randomDelta);
  p.form = clamp(Math.round(pulled), -10, 10) || 0;
}

/** Weekly routine on pay day: every rostered player trains; everyone's form moves. */
export function applyTrainingWeek(state: GameState, data: GameData): void {
  const g = data.growth;
  for (const club of [state.club, ...state.aiClubs]) {
    const focus = trainingFocusOf(state, data, club.id);
    const boost = trainingBoost(state, data, club.id);
    for (const id of [...club.roster].sort()) {
      const p = state.players[id]!;
      trainPlayer(p, focus, g, playerTrainingBoost(data, p, boost));
    }
    chemistryFromTraining(state, data, club, focus);
  }
  // Free agents do not train, but still age.
  for (const id of [...state.market].sort()) {
    const p = state.players[id]!;
    const rate = ageRateOf(g, p);
    if (rate < 0) for (const k of ATTRS) addAttr(p, k, g.weeklyGrowthBase * rate);
  }
  const rng = rngFromState(state.rngState);
  for (const id of Object.keys(state.players).sort()) updateForm(state.players[id]!, g, rng, data.economy.formWeeklyDelta);
  state.rngState = rng.state();
  for (const id of state.club.roster) {
    const p = state.players[id]!;
    p.ovrHistory = [...(p.ovrHistory ?? []), Math.round(playerOverall(p) * 10) / 10].slice(-OVR_HISTORY);
  }
}

const OVR_HISTORY = 40;

/** Daily recovery: fatigue goes down (faster with a better lounge), morale drifts back toward neutral (low morale faster with a leader). */
export function applyDailyRecovery(state: GameState, data: GameData): void {
  const g = data.growth;
  const lounge = new Map<string, number>();
  const lift = new Map<string, number>(); // a leader on the club: low morale climbs back faster (T24)
  for (const club of [state.club, ...state.aiClubs]) {
    const extra = facilityValue(state, data, club.id, 'LOUNGE');
    if (extra) for (const id of club.roster) lounge.set(id, extra);
    const leader = Math.max(0, ...club.roster.map((id) => traitEffect(data.traits, state.players[id]?.traits, 'teamMoraleDrift')));
    if (leader) for (const id of club.roster) lift.set(id, leader);
  }
  for (const id of Object.keys(state.players).sort()) {
    const p = state.players[id]!;
    p.fatigue = round2(Math.max(0, (p.fatigue ?? 0) - g.fatigueDailyRecovery - (lounge.get(id) ?? 0)));
    const m = p.morale ?? g.moraleNeutral;
    const drift = g.moraleDailyDrift + (m < g.moraleNeutral ? lift.get(id) ?? 0 : 0);
    const step = Math.min(drift, Math.abs(g.moraleNeutral - m));
    p.morale = round2(m + Math.sign(g.moraleNeutral - m) * step);
  }
}

/** After a match: fatigue, morale, experience, hero mastery and career stats for both clubs. */
export function applyMatchEffects(state: GameState, data: GameData, input: MatchInput, result: MatchResult): void {
  const g = data.growth;
  const sides = [
    { team: input.blue, won: result.winner === 'BLUE' },
    { team: input.red, won: result.winner === 'RED' },
  ];
  const lines = new Map(result.players.map((r) => [r.playerId, r]));
  for (const { team, won } of sides) {
    const starters = new Set(team.lineup.picks.map((pk) => pk.playerId));
    const masteryBoost = 1 + facilityValue(state, data, team.lineup.clubId, 'ANALYSIS');
    for (const pk of team.lineup.picks) {
      const p = state.players[pk.playerId];
      if (!p) continue;
      p.fatigue = clamp((p.fatigue ?? 0) + g.fatiguePerMatch, 0, 100);
      p.morale = clamp((p.morale ?? g.moraleNeutral) + (won ? g.moraleWin : g.moraleLoss), 0, 100);
      const rate = ageRateOf(g, p);
      if (rate > 0) {
        const gain = g.matchExperience * rate * headroom(g, p);
        for (const k of ATTRS) addAttr(p, k, gain);
      }
      addMastery(p, pk.heroId, g.masteryPerMatch * masteryBoost);
      const line = lines.get(pk.playerId);
      const st = (p.stats ??= { played: 0, wins: 0, kills: 0, deaths: 0, assists: 0 });
      st.played++;
      if (won) st.wins++;
      if (line) { st.kills += line.kills; st.deaths += line.deaths; st.assists += line.assists; }
    }
    for (const id of clubById(state, team.lineup.clubId).roster) {
      if (starters.has(id)) continue;
      const p = state.players[id]!;
      p.morale = clamp((p.morale ?? g.moraleNeutral) + g.moraleBench, 0, 100);
    }
  }
}

/** Condition multiplier the match engine applies for fatigue (1 = fresh). */
export function fatigueMultiplier(data: GameData, p: Player): number {
  const f = data.match.coefficients.fatigue;
  return Math.max(0.5, 1 - Math.max(0, (p.fatigue ?? 0) - f.start) * f.per);
}
