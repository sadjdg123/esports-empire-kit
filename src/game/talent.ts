// Talent supply (P1): new young free agents every season, and old unsigned
// free agents leave the league, so a long save neither ages nor fills up.
// (Full careers and retirement are P2.)

import { rngFromState, type Rng } from '../core/rng';
import { ROLES, type GameData, type Player, type Role } from '../core/types';
import { fairSalary } from './contracts';
import { playerOverall, withP1Defaults, withP2Defaults } from './game';
import type { GameState } from './state';

function uniqueName(state: GameState, data: GameData, rng: Rng): string {
  const t = data.ai.talent;
  const taken = new Set(Object.values(state.players).map((p) => p.name));
  for (let i = 0; i < 50; i++) {
    const name = rng.pick(t.namePrefixes) + rng.pick(t.nameSuffixes);
    if (!taken.has(name)) return name;
  }
  let n = 2;
  const base = rng.pick(t.namePrefixes) + rng.pick(t.nameSuffixes);
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function youngPlayer(state: GameState, data: GameData, rng: Rng, role: Role, index: number): Player {
  const t = data.ai.talent;
  const ovr = rng.int(t.overallMin, t.overallMax);
  const attr = () => Math.max(1, Math.min(99, ovr + rng.int(-6, 6)));
  const heroes = data.heroes.filter((h) => h.preferredRoles.includes(role)).map((h) => h.id);
  const heroMastery: Record<string, number> = {};
  for (const id of heroes) if (rng.chance(0.75) || Object.keys(heroMastery).length === 0) heroMastery[id] = rng.int(30, 60);
  const others = ROLES.filter((r) => r !== role);
  const p: Player = {
    id: `yt_s${state.calendar.season}_${role.toLowerCase()}_${index}`,
    name: uniqueName(state, data, rng),
    age: rng.int(t.ageMin, t.ageMax),
    primaryRole: role,
    ...(rng.chance(0.5) ? { secondaryRole: rng.pick(others) } : {}),
    attrs: { mechanics: attr(), awareness: attr(), teamwork: attr(), mental: attr() },
    heroMastery,
    form: 0,
    salaryPerWeek: 0,
    signingFee: 0,
    clubId: null,
    potential: 0,
    fatigue: 0,
    morale: 70,
  };
  p.potential = Math.max(Math.round(playerOverall(p)) + 5, rng.int(t.potentialMin, t.potentialMax));
  p.salaryPerWeek = fairSalary(data, p);
  p.signingFee = p.salaryPerWeek * data.economy.signingFeeWeeks;
  return withP2Defaults(withP1Defaults(p), data);
}

/** New season: old unsigned free agents leave; a fresh class of young players enters the market. */
export function refreshTalent(state: GameState, data: GameData): { left: number; joined: number } {
  const t = data.ai.talent;
  const leaving = state.market.filter((id) => state.players[id]!.age >= t.freeAgentLeaveAge);
  for (const id of leaving) delete state.players[id];
  state.market = state.market.filter((id) => state.players[id]);
  const rng = rngFromState(state.rngState);
  let joined = 0;
  for (const role of ROLES) {
    for (let i = 0; i < t.intakePerRole; i++) {
      const p = youngPlayer(state, data, rng, role, i);
      state.players[p.id] = p;
      state.market.push(p.id);
      joined++;
    }
  }
  state.rngState = rng.state();
  // Too many free agents: the weakest of those not new this season leave.
  const over = state.market.length - t.marketCap;
  let trimmed = 0;
  if (over > 0) {
    const fresh = new Set(Object.keys(state.players).filter((id) => id.startsWith(`yt_s${state.calendar.season}_`)));
    const out = state.market.filter((id) => !fresh.has(id)).map((id) => state.players[id]!)
      .sort((a, b) => playerOverall(a) - playerOverall(b) || b.age - a.age || a.id.localeCompare(b.id)).slice(0, over).map((p) => p.id);
    for (const id of out) delete state.players[id];
    state.market = state.market.filter((id) => state.players[id]);
    trimmed = out.length;
  }
  return { left: leaving.length + trimmed, joined };
}
