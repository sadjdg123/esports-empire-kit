// Staff (P3, T30): candidates for the three jobs (manager, coach, finance), hiring, firing,
// renewing and wages. Candidates come from their own random stream (seed, season), so a new
// batch never shifts the game's other random outcomes. What staff decide is T31.

import { createRng, hashString, type Rng } from '../core/rng';
import { STAFF_ROLES, STAFF_STYLES, type Authority, type GameData, type Player, type StaffId, type StaffMember, type StaffRole, type StaffSkills } from '../core/types';
import { careerPeak } from './career';
import { seasonWeeks } from './contracts';
import { addLedger, weekOfSeason, type Result } from './game';
import { postMessage } from './messages';
import type { GameState } from './state';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** The skill a role is judged on. */
export function mainSkill(data: GameData, s: StaffMember): number {
  return s.skills[data.staff.roles[s.role].skill];
}

function salaryFor(data: GameData, skill: number): number {
  const m = data.staff.market;
  return roundTo(m.salaryBase + Math.max(0, skill - m.skillMin) * m.salaryPerSkill, 10);
}

function uniqueName(state: GameState, data: GameData, rng: Rng): string {
  const m = data.staff.market;
  const taken = new Set(Object.values(state.staff).map((s) => s.name));
  for (let i = 0; i < 40; i++) {
    const name = rng.pick(m.namePrefixes) + rng.pick(m.nameSuffixes);
    if (!taken.has(name)) return name;
  }
  let n = 2;
  const base = rng.pick(m.namePrefixes) + rng.pick(m.nameSuffixes);
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function candidate(state: GameState, data: GameData, rng: Rng, role: StaffRole, index: number): StaffMember {
  const m = data.staff.market;
  // The role's own skill is the strong one: the other two stay below it.
  const key = data.staff.roles[role].skill;
  const main = clamp(rng.int(m.skillMin, m.skillMax) + m.mainSkillBonus, 0, 100);
  const side = () => rng.int(m.skillMin, Math.max(m.skillMin, main - 5));
  const skills: StaffSkills = { scouting: side(), leading: side(), money: side() };
  skills[key] = main;
  const salary = salaryFor(data, skills[key]);
  return {
    id: `st_s${state.calendar.season}_${role.toLowerCase()}_${index}`,
    name: uniqueName(state, data, rng),
    role, skills, style: rng.pick(STAFF_STYLES), salaryPerWeek: salary, signingFee: salary * m.signingFeeWeeks, origin: 'MARKET',
  };
}

/** A retired player who could coach: leading from how well he read and played the game. */
function retiredCoach(state: GameState, data: GameData, rng: Rng, p: Player): StaffMember {
  const a = p.attrs;
  const skills: StaffSkills = {
    scouting: clamp(Math.round((a.awareness + a.mental) / 2), 0, 100),
    leading: clamp(Math.round((a.awareness + a.teamwork) / 2 + 8), 0, 100),
    money: clamp(rng.int(data.staff.market.skillMin, 60), 0, 100),
  };
  const salary = salaryFor(data, skills.leading);
  return {
    id: `st_s${state.calendar.season}_coach_${p.id}`,
    name: p.name, role: 'COACH', skills, style: (p.traits ?? []).includes('DILIGENT') || (p.traits ?? []).includes('LEADER') ? 'YOUTH' : rng.pick(STAFF_STYLES),
    salaryPerWeek: salary, signingFee: salary * data.staff.market.signingFeeWeeks, origin: 'RETIRED', formerPlayerId: p.id,
  };
}

/** Staff the player has hired, by role. */
export function hiredStaff(state: GameState, role: StaffRole): StaffMember | null {
  const id = state.delegation.roles[role].staffId;
  return id ? state.staff[id] ?? null : null;
}

/** What all hired staff cost each week. */
export function staffWages(state: GameState): number {
  return STAFF_ROLES.reduce((a, r) => a + (hiredStaff(state, r)?.salaryPerWeek ?? 0), 0);
}

/**
 * A new batch of candidates (each off-season, and at the start of a game). Old candidates
 * nobody hired leave; strong players who just retired may ask to coach.
 */
export function refreshStaffMarket(state: GameState, data: GameData, retired: readonly Player[] = []): void {
  const hired = new Set(STAFF_ROLES.map((r) => state.delegation.roles[r].staffId).filter((x): x is string => !!x));
  for (const id of state.staffMarket) if (!hired.has(id)) delete state.staff[id];
  state.staffMarket = [];
  const rng = createRng(hashString(`staff:${state.seed}:${state.calendar.season}`));
  for (const role of STAFF_ROLES) {
    for (let i = 0; i < data.staff.market.perRole; i++) {
      const c = candidate(state, data, rng, role, i);
      state.staff[c.id] = c;
      state.staffMarket.push(c.id);
    }
  }
  const coaches = [...retired].filter((p) => careerPeak(p) >= data.staff.market.retiredCoachMinPeak)
    .sort((a, b) => careerPeak(b) - careerPeak(a) || a.id.localeCompare(b.id)).slice(0, data.staff.market.retiredCoachPerSeason);
  for (const p of coaches) {
    const c = retiredCoach(state, data, rng, p);
    state.staff[c.id] = c;
    state.staffMarket.push(c.id);
    postMessage(state, 'INFO', `${p.name} 想当教练`, `刚退役的 ${p.name} 想留在电竞圈当教练，可以到"负责人"里看看。`);
  }
}

/** Hires a candidate for his role. The role must be free; the new hire starts on "small things alone". */
export function hireStaff(state: GameState, data: GameData, staffId: StaffId): Result<StaffMember> {
  const s = state.staff[staffId];
  if (!s || !state.staffMarket.includes(staffId)) return fail('这个人不在候选名单里');
  const slot = state.delegation.roles[s.role];
  if (slot.staffId) return fail(`${data.staff.roles[s.role].name}已经有人了，先解雇再雇新人`);
  if (state.funds < s.signingFee) return fail(`资金不足：签约费 ${s.signingFee}，现在只有 ${Math.floor(state.funds)}`);
  addLedger(state, { week: weekOfSeason(state), kind: 'STAFF', amount: -s.signingFee, note: `聘请${data.staff.roles[s.role].name} ${s.name}` });
  s.hired = { season: state.calendar.season, until: state.calendar.season + data.staff.market.contractYears - 1 };
  state.staffMarket = state.staffMarket.filter((id) => id !== staffId);
  state.delegation.roles[s.role] = { staffId, authority: slot.authority === 'SELF' ? 'SMALL' : slot.authority };
  return ok(s);
}

/** Weeks left on a staff contract (this season's remaining weeks plus later seasons). */
function remainingWeeks(state: GameState, data: GameData, s: StaffMember): number {
  if (!s.hired) return 0;
  const thisSeason = state.calendar.phase === 'FINISHED' ? 0 : Math.max(0, seasonWeeks(state, data) - weekOfSeason(state));
  return thisSeason + Math.max(0, s.hired.until - state.calendar.season) * seasonWeeks(state, data);
}

export function staffReleaseFee(state: GameState, data: GameData, s: StaffMember): number {
  return Math.round(s.salaryPerWeek * remainingWeeks(state, data, s) * data.staff.market.releaseFeeShare);
}

/** Lets a hired staff member go, paying part of the rest of his contract. The role goes back to the player. */
export function fireStaff(state: GameState, data: GameData, role: StaffRole): Result<number> {
  const s = hiredStaff(state, role);
  if (!s) return fail('这个岗位没有人');
  const fee = staffReleaseFee(state, data, s);
  if (state.funds < fee) return fail(`资金不足：违约金 ${fee}，现在只有 ${Math.floor(state.funds)}`);
  if (fee > 0) addLedger(state, { week: weekOfSeason(state), kind: 'STAFF', amount: -fee, note: `与${data.staff.roles[role].name} ${s.name} 解约` });
  state.delegation.roles[role] = { staffId: null, authority: 'SELF' };
  delete state.staff[s.id];
  return ok(fee);
}

/** Extends a contract by the usual length in its last season, for the signing fee again. */
export function renewStaff(state: GameState, data: GameData, role: StaffRole): Result<number> {
  const s = hiredStaff(state, role);
  if (!s?.hired) return fail('这个岗位没有人');
  if (s.hired.until > state.calendar.season) return fail(`${s.name} 的合同到第 ${s.hired.until} 赛季，最后一个赛季才能续约`);
  if (state.funds < s.signingFee) return fail(`资金不足：续约费 ${s.signingFee}，现在只有 ${Math.floor(state.funds)}`);
  addLedger(state, { week: weekOfSeason(state), kind: 'STAFF', amount: -s.signingFee, note: `与${data.staff.roles[role].name} ${s.name} 续约` });
  s.hired.until = state.calendar.season + data.staff.market.contractYears;
  return ok(s.hired.until);
}

/** New season: staff whose contract ended leave (the role goes back to the player). */
export function rollStaffContracts(state: GameState, data: GameData): void {
  for (const role of STAFF_ROLES) {
    const s = hiredStaff(state, role);
    if (!s?.hired || s.hired.until >= state.calendar.season) continue;
    state.delegation.roles[role] = { staffId: null, authority: 'SELF' };
    delete state.staff[s.id];
    postMessage(state, 'CONTRACT', `${data.staff.roles[role].name} ${s.name} 合同到期离开`, `${data.staff.roles[role].name}的工作回到你手上。可以到"负责人"里雇新人。`);
  }
}

export function setAuthority(state: GameState, role: StaffRole, authority: Authority): Result<Authority> {
  if (authority !== 'SELF' && !state.delegation.roles[role].staffId) return fail('这个岗位还没有人，先雇一个');
  state.delegation.roles[role].authority = authority;
  return ok(authority);
}

export function setDelegationLimits(state: GameState, limit: number, protectTop: number): Result<undefined> {
  if (!Number.isFinite(limit) || limit < 0) return fail('额度不对');
  if (!Number.isInteger(protectTop) || protectTop < 0 || protectTop > 5) return fail('保护人数是 0–5');
  state.delegation.limit = limit;
  state.delegation.protectTop = protectTop;
  return ok(undefined);
}
