// Training, growth, fatigue and morale (P1, GDD 9). Weekly training runs on
// pay day; match effects run when a match is settled; recovery runs daily.

import { rngFromState, type Rng } from '../core/rng';
import type { ClubId, GameData, GrowthConfig, MatchInput, MatchResult, Player, PlayerAttributes, TrainingFocus } from '../core/types';
import { DEFAULT_MASTERY } from '../core/types';
import { clubById, playerOverall, weekOfSeason } from './game';
import { PLAYER_CLUB_ID, type GameState } from './state';

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

/** The training focus a club uses this week. AI clubs rest when tired, otherwise rotate. */
export function trainingFocusOf(state: GameState, data: GameData, clubId: ClubId): TrainingFocus {
  if (clubId === PLAYER_CLUB_ID) return state.training;
  const g = data.growth;
  const club = clubById(state, clubId);
  const roster = club.roster.map((id) => state.players[id]!);
  const avgFatigue = roster.reduce((a, p) => a + (p.fatigue ?? 0), 0) / Math.max(1, roster.length);
  const restAt = club.management === 'PLAYER' ? 100 : data.ai.styles[club.management].restFatigue;
  if (avgFatigue >= restAt) return 'REST';
  return g.aiFocusRotation[weekOfSeason(state) % g.aiFocusRotation.length]!;
}

/** One week of training for one player. */
export function trainPlayer(p: Player, focus: TrainingFocus, g: GrowthConfig): void {
  const rate = ageRate(g, p.age);
  if (rate < 0) {
    // Decline hits everyone past their peak, training or not.
    for (const k of ATTRS) addAttr(p, k, g.weeklyGrowthBase * rate);
  } else if (focus !== 'REST') {
    const gain = g.weeklyGrowthBase * rate * headroom(g, p);
    const weights = g.trainingFocus[focus];
    for (const k of ATTRS) addAttr(p, k, gain * (weights[k] ?? g.offFocusShare));
    const masteryWeight = weights.mastery ?? 0;
    if (masteryWeight > 0) {
      const best = Object.entries(p.heroMastery).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, g.masteryFocusHeroes);
      for (const [heroId] of best) addMastery(p, heroId, g.masteryFocusGain * rate * masteryWeight);
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
    for (const id of [...club.roster].sort()) trainPlayer(state.players[id]!, focus, g);
  }
  // Free agents do not train, but still age.
  for (const id of [...state.market].sort()) {
    const p = state.players[id]!;
    const rate = ageRate(g, p.age);
    if (rate < 0) for (const k of ATTRS) addAttr(p, k, g.weeklyGrowthBase * rate);
  }
  const rng = rngFromState(state.rngState);
  for (const id of Object.keys(state.players).sort()) updateForm(state.players[id]!, g, rng, data.economy.formWeeklyDelta);
  state.rngState = rng.state();
}

/** Daily recovery: fatigue goes down, morale drifts back toward neutral. */
export function applyDailyRecovery(state: GameState, data: GameData): void {
  const g = data.growth;
  for (const id of Object.keys(state.players).sort()) {
    const p = state.players[id]!;
    p.fatigue = round2(Math.max(0, (p.fatigue ?? 0) - g.fatigueDailyRecovery));
    const m = p.morale ?? g.moraleNeutral;
    const step = Math.min(g.moraleDailyDrift, Math.abs(g.moraleNeutral - m));
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
    for (const pk of team.lineup.picks) {
      const p = state.players[pk.playerId];
      if (!p) continue;
      p.fatigue = clamp((p.fatigue ?? 0) + g.fatiguePerMatch, 0, 100);
      p.morale = clamp((p.morale ?? g.moraleNeutral) + (won ? g.moraleWin : g.moraleLoss), 0, 100);
      const rate = ageRate(g, p.age);
      if (rate > 0) {
        const gain = g.matchExperience * rate * headroom(g, p);
        for (const k of ATTRS) addAttr(p, k, gain);
      }
      addMastery(p, pk.heroId, g.masteryPerMatch);
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
