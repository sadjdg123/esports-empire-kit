// Loads and validates every JSON data file into a GameData object.
// Validation is hand-written so error messages point at the exact field.

import heroesJson from '../data/heroes.json';
import playersJson from '../data/players.json';
import clubsJson from '../data/clubs.json';
import economyJson from '../data/economy.json';
import matchJson from '../data/match.json';
import seasonJson from '../data/season.json';
import growthJson from '../data/growth.json';
import {
  ARCHETYPES, LANES, MANAGEMENT_STYLES, ROLES, TACTICS, TRAINING_FOCI,
  type ClubDef, type EconomyConfig, type GameData, type GrowthConfig, type HeroDef, type MatchConfig,
  type Player, type Role, type SeasonConfig, type TeamLineup, type TrainingFocus,
} from './types';

export interface RawGameData {
  heroes: unknown;
  players: unknown;
  clubs: unknown;
  economy: unknown;
  match: unknown;
  season: unknown;
  growth: unknown;
}

export class DataValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Data validation failed (${issues.length} issue(s)):\n  - ${issues.slice(0, 30).join('\n  - ')}`);
    this.name = 'DataValidationError';
    this.issues = issues;
  }
}

type Obj = Record<string, unknown>;

class Checker {
  readonly issues: string[] = [];

  fail(path: string, msg: string): void {
    this.issues.push(`${path}: ${msg}`);
  }

  obj(v: unknown, path: string): Obj | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.fail(path, 'expected an object');
      return null;
    }
    return v as Obj;
  }

  arr(v: unknown, path: string, minLen = 0): unknown[] | null {
    if (!Array.isArray(v)) {
      this.fail(path, 'expected an array');
      return null;
    }
    if (v.length < minLen) this.fail(path, `expected at least ${minLen} item(s), got ${v.length}`);
    return v;
  }

  num(o: Obj, key: string, path: string, min = -Infinity, max = Infinity, integer = false): number {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.fail(`${path}.${key}`, `expected a number, got ${JSON.stringify(v)}`);
      return 0;
    }
    if (v < min || v > max) this.fail(`${path}.${key}`, `expected ${min}..${max}, got ${v}`);
    if (integer && !Number.isInteger(v)) this.fail(`${path}.${key}`, `expected an integer, got ${v}`);
    return v;
  }

  optNum(o: Obj, key: string, path: string, min = -Infinity, max = Infinity): void {
    if (o[key] !== undefined) this.num(o, key, path, min, max);
  }

  str(o: Obj, key: string, path: string): string {
    const v = o[key];
    if (typeof v !== 'string' || v.length === 0) {
      this.fail(`${path}.${key}`, `expected a non-empty string, got ${JSON.stringify(v)}`);
      return '';
    }
    return v;
  }

  oneOf<T extends string>(o: Obj, key: string, path: string, allowed: readonly T[]): T | null {
    const v = o[key];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.fail(`${path}.${key}`, `expected one of ${allowed.join('/')}, got ${JSON.stringify(v)}`);
      return null;
    }
    return v as T;
  }

  unique(ids: string[], path: string, what: string): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) this.fail(path, `duplicate ${what} "${id}"`);
      seen.add(id);
    }
  }
}

const SKILL_TARGETS = ['ENEMY_SINGLE', 'ENEMY_AREA', 'ALLY_SINGLE', 'ALLY_AREA', 'SELF'] as const;
const EFFECT_TYPES = ['DAMAGE', 'STUN', 'SHIELD', 'HEAL', 'DASH', 'SLOW'] as const;
const NODE_TYPES = ['BASE', 'TOWER', 'LANE', 'JUNGLE', 'RIVER', 'OBJECTIVE'] as const;

function checkHeroes(c: Checker, raw: unknown): void {
  const list = c.arr(raw, 'heroes.json', 1);
  if (!list) return;
  const ids: string[] = [];
  list.forEach((h, i) => {
    const p = `heroes.json[${i}]`;
    const o = c.obj(h, p);
    if (!o) return;
    ids.push(c.str(o, 'id', p));
    c.str(o, 'name', p);
    c.str(o, 'title', p);
    c.oneOf(o, 'archetype', p, ARCHETYPES);
    const roles = c.arr(o.preferredRoles, `${p}.preferredRoles`, 1);
    roles?.forEach((r, j) => { if (!ROLES.includes(r as Role)) c.fail(`${p}.preferredRoles[${j}]`, `unknown role ${JSON.stringify(r)}`); });
    const base = c.obj(o.base, `${p}.base`);
    if (base) {
      c.num(base, 'hp', `${p}.base`, 1);
      c.num(base, 'attack', `${p}.base`, 0);
      c.num(base, 'armor', `${p}.base`, 0);
      c.num(base, 'attackRange', `${p}.base`, 1);
      c.num(base, 'attackInterval', `${p}.base`, 0.1);
      c.num(base, 'moveSpeed', `${p}.base`, 1);
    }
    const per = c.obj(o.perLevel, `${p}.perLevel`);
    if (per) {
      c.num(per, 'hp', `${p}.perLevel`, 0);
      c.num(per, 'attack', `${p}.perLevel`, 0);
      c.num(per, 'armor', `${p}.perLevel`, 0);
    }
    const sk = c.obj(o.skill, `${p}.skill`);
    if (sk) {
      const sp = `${p}.skill`;
      c.str(sk, 'id', sp);
      c.str(sk, 'name', sp);
      c.str(sk, 'description', sp);
      c.num(sk, 'cooldown', sp, 1);
      c.num(sk, 'range', sp, 0);
      c.oneOf(sk, 'target', sp, SKILL_TARGETS);
      c.optNum(sk, 'areaRadius', sp, 1);
      const effects = c.arr(sk.effects, `${sp}.effects`, 1);
      effects?.forEach((e, j) => {
        const eo = c.obj(e, `${sp}.effects[${j}]`);
        if (!eo) return;
        c.oneOf(eo, 'type', `${sp}.effects[${j}]`, EFFECT_TYPES);
        c.num(eo, 'value', `${sp}.effects[${j}]`, 0);
      });
    }
  });
  c.unique(ids, 'heroes.json', 'hero id');
}

function checkPlayer(c: Checker, raw: unknown, p: string, heroIds: Set<string>, expectedClub: string | null): string {
  const o = c.obj(raw, p);
  if (!o) return '';
  const id = c.str(o, 'id', p);
  c.str(o, 'name', p);
  c.num(o, 'age', p, 14, 45, true);
  c.oneOf(o, 'primaryRole', p, ROLES);
  if (o.secondaryRole !== undefined) {
    c.oneOf(o, 'secondaryRole', p, ROLES);
    if (o.secondaryRole === o.primaryRole) c.fail(`${p}.secondaryRole`, 'must differ from primaryRole');
  }
  const attrs = c.obj(o.attrs, `${p}.attrs`);
  if (attrs) {
    for (const k of ['mechanics', 'awareness', 'teamwork', 'mental']) c.num(attrs, k, `${p}.attrs`, 1, 100);
  }
  const mastery = c.obj(o.heroMastery, `${p}.heroMastery`);
  if (mastery) {
    for (const [hid, v] of Object.entries(mastery)) {
      if (!heroIds.has(hid)) c.fail(`${p}.heroMastery.${hid}`, 'unknown hero id');
      if (typeof v !== 'number' || v < 0 || v > 100) c.fail(`${p}.heroMastery.${hid}`, `expected 0..100, got ${JSON.stringify(v)}`);
    }
  }
  c.num(o, 'form', p, -10, 10);
  c.num(o, 'salaryPerWeek', p, 0);
  c.num(o, 'signingFee', p, 0);
  c.optNum(o, 'potential', p, 1, 100);
  c.optNum(o, 'fatigue', p, 0, 100);
  c.optNum(o, 'morale', p, 0, 100);
  c.optNum(o, 'contractUntil', p, 1, 100);
  if (expectedClub !== null && o.contractUntil === undefined) c.fail(`${p}.contractUntil`, 'club players need a contract');
  if (o.stats !== undefined) {
    const st = c.obj(o.stats, `${p}.stats`);
    if (st) for (const k of ['played', 'wins', 'kills', 'deaths', 'assists']) c.num(st, k, `${p}.stats`, 0);
  }
  if (o.clubId !== expectedClub) c.fail(`${p}.clubId`, `expected ${JSON.stringify(expectedClub)}, got ${JSON.stringify(o.clubId)}`);
  return id;
}

function checkPlayersAndClubs(c: Checker, rawPlayers: unknown, rawClubs: unknown, heroIds: Set<string>): void {
  const playerIds: string[] = [];
  const players = c.arr(rawPlayers, 'players.json', 1);
  players?.forEach((pl, i) => playerIds.push(checkPlayer(c, pl, `players.json[${i}]`, heroIds, null)));

  const clubs = c.arr(rawClubs, 'clubs.json', 1);
  const clubIds: string[] = [];
  clubs?.forEach((cl, i) => {
    const p = `clubs.json[${i}]`;
    const o = c.obj(cl, p);
    if (!o) return;
    const id = c.str(o, 'id', p);
    clubIds.push(id);
    c.str(o, 'name', p);
    c.str(o, 'shortName', p);
    c.str(o, 'description', p);
    const color = c.str(o, 'color', p);
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) c.fail(`${p}.color`, `expected #rrggbb, got ${color}`);
    c.oneOf(o, 'style', p, [...TACTICS, 'RANDOM'] as const);
    c.oneOf(o, 'management', p, MANAGEMENT_STYLES);
    c.num(o, 'funds', p, 0);
    c.num(o, 'reputation', p, 0, 100);
    const roster = c.arr(o.players, `${p}.players`, 5);
    if (!roster) return;
    if (roster.length > 6) c.fail(`${p}.players`, `expected at most 6 players, got ${roster.length}`);
    const roles = new Set<unknown>();
    roster.forEach((pl, j) => {
      playerIds.push(checkPlayer(c, pl, `${p}.players[${j}]`, heroIds, id));
      roles.add((pl as Obj | null)?.primaryRole);
    });
    for (const r of ROLES) if (!roles.has(r)) c.fail(`${p}.players`, `no player with primaryRole ${r}`);
  });
  c.unique(playerIds.filter(Boolean), 'players.json + clubs.json', 'player id');
  c.unique(clubIds.filter(Boolean), 'clubs.json', 'club id');
}

function checkEconomy(c: Checker, raw: unknown): void {
  const o = c.obj(raw, 'economy.json');
  if (!o) return;
  const p = 'economy.json';
  for (const k of ['startingFunds', 'weeklySponsor', 'prizeWin', 'prizeLoss', 'signingFeeWeeks', 'releaseFeeWeeks', 'lowFundsWarningWeeks', 'formWeeklyDelta']) c.num(o, k, p, 0);
  const min = c.num(o, 'minRoster', p, 5, 20, true);
  const max = c.num(o, 'maxRoster', p, 5, 20, true);
  if (max < min) c.fail(`${p}.maxRoster`, 'must be >= minRoster');
}

function checkNumbers(c: Checker, raw: unknown, path: string, keys: string[], min = 0): Obj | null {
  const o = c.obj(raw, path);
  if (o) for (const k of keys) c.num(o, k, path, min);
  return o;
}

function checkMatch(c: Checker, raw: unknown, heroIds: Set<string>): void {
  void heroIds;
  const p = 'match.json';
  const o = c.obj(raw, p);
  if (!o) return;
  checkNumbers(c, o.time, `${p}.time`, ['tickSec', 'realSecPerTickAt1x', 'overtimeStartSec', 'overtimeCreepBonusPerMin', 'suddenDeathSec', 'maxDurationSec', 'goldTimelineIntervalSec']);

  // Map
  const map = c.obj(o.map, `${p}.map`);
  if (map) {
    const nodes = c.arr(map.nodes, `${p}.map.nodes`, 2) ?? [];
    const ids: string[] = [];
    nodes.forEach((n, i) => {
      const np = `${p}.map.nodes[${i}]`;
      const no = c.obj(n, np);
      if (!no) return;
      ids.push(c.str(no, 'id', np));
      c.oneOf(no, 'type', np, NODE_TYPES);
      c.num(no, 'x', np, 0, 1000);
      c.num(no, 'y', np, 0, 1000);
      if (no.type === 'TOWER') {
        c.oneOf(no, 'side', np, ['BLUE', 'RED'] as const);
        c.oneOf(no, 'lane', np, LANES);
        if (no.tier !== 1 && no.tier !== 2) c.fail(`${np}.tier`, 'expected 1 or 2');
      }
      if (no.type === 'BASE') c.oneOf(no, 'side', np, ['BLUE', 'RED'] as const);
    });
    c.unique(ids, `${p}.map.nodes`, 'node id');
    const idSet = new Set(ids);
    const edges = c.arr(map.edges, `${p}.map.edges`, 1) ?? [];
    edges.forEach((e, i) => {
      if (!Array.isArray(e) || e.length !== 2) { c.fail(`${p}.map.edges[${i}]`, 'expected [from, to]'); return; }
      for (const end of e) if (!idSet.has(end as string)) c.fail(`${p}.map.edges[${i}]`, `unknown node ${JSON.stringify(end)}`);
      if (e[0] === e[1]) c.fail(`${p}.map.edges[${i}]`, 'self loop');
    });
    const lanes = c.obj(map.lanes, `${p}.map.lanes`);
    if (lanes) {
      for (const lane of LANES) {
        const path = c.arr(lanes[lane], `${p}.map.lanes.${lane}`, 3);
        path?.forEach((nid, i) => { if (!idSet.has(nid as string)) c.fail(`${p}.map.lanes.${lane}[${i}]`, `unknown node ${JSON.stringify(nid)}`); });
      }
    }
  }

  checkNumbers(c, o.creeps, `${p}.creeps`, ['firstSpawnSec', 'intervalSec', 'hp', 'armor', 'attack', 'structureAttack', 'range', 'moveSpeed', 'hpPerMinute', 'attackPerMinute', 'gold', 'xp', 'shareRadius']);
  const towers = c.obj(o.towers, `${p}.towers`);
  const structKeys = ['hp', 'armor', 'attack', 'creepAttack', 'range'];
  if (towers) for (const t of ['T1', 'T2']) checkNumbers(c, towers[t], `${p}.towers.${t}`, structKeys);
  checkNumbers(c, o.base, `${p}.base`, [...structKeys, 'suddenDeathArmor']);
  const objectives = c.arr(o.objectives, `${p}.objectives`, 0) ?? [];
  objectives.forEach((ob, i) => {
    const op = `${p}.objectives[${i}]`;
    const oo = checkNumbers(c, ob, op, ['firstSpawnSec', 'respawnSec', 'hp', 'hpPerMinute', 'attack', 'range', 'goldPerMember']);
    if (!oo) return;
    c.str(oo, 'id', op);
    c.str(oo, 'name', op);
    c.str(oo, 'nodeId', op);
    const buff = c.obj(oo.buff, `${op}.buff`);
    if (buff) {
      c.oneOf(buff, 'kind', `${op}.buff`, ['ATTACK', 'SIEGE'] as const);
      c.num(buff, 'value', `${op}.buff`, 0);
      c.num(buff, 'durationSec', `${op}.buff`, 1);
    }
  });
  checkNumbers(c, o.jungle, `${p}.jungle`, ['campHp', 'campGold', 'campXp', 'respawnSec', 'firstSpawnSec']);
  const hero = checkNumbers(c, o.hero, `${p}.hero`, [
    'respawnBase', 'respawnPerLevel', 'maxLevel', 'passiveGoldPerSec', 'passiveXpPerSec', 'goldStep', 'goldStepBonus',
    'killGold', 'killGoldPerVictimLevel', 'assistGold', 'killXp', 'killXpPerVictimLevel', 'assistWindowSec', 'towerGoldPerMember',
    'baseRegenPerSec', 'idleRegenPerSec', 'recallSec', 'slowFactor', 'armorConstant', 'structureDamage',
  ]);
  if (hero) {
    const xp = c.arr(hero.xpPerLevel, `${p}.hero.xpPerLevel`, 1);
    if (xp && typeof hero.maxLevel === 'number' && xp.length !== hero.maxLevel - 1) {
      c.fail(`${p}.hero.xpPerLevel`, `expected ${hero.maxLevel - 1} entries (maxLevel - 1), got ${xp.length}`);
    }
  }
  const coef = c.obj(o.coefficients, `${p}.coefficients`);
  if (coef) {
    for (const k of ['mechanicsDamage', 'skillHit', 'farm', 'masteryEffect', 'retreatThreshold', 'decisionChance', 'decisionNoise', 'gankDetect', 'teamworkFocus']) {
      checkNumbers(c, coef[k], `${p}.coefficients.${k}`, ['base', 'per'], -10);
    }
    for (const k of ['masteryCooldown', 'mentalDeficitGold', 'mentalPenaltyPer', 'formPer', 'teamworkDelay']) c.num(coef, k, `${p}.coefficients`, 0);
    checkNumbers(c, coef.role, `${p}.coefficients.role`, ['primary', 'secondary', 'off']);
    checkNumbers(c, coef.fatigue, `${p}.coefficients.fatigue`, ['start', 'per']);
  }
  const ai = c.obj(o.ai, `${p}.ai`);
  if (ai) {
    c.obj(ai.baseUtility, `${p}.ai.baseUtility`);
    checkNumbers(c, ai.momentum, `${p}.ai.momentum`, ['thresholdGold', 'spanGold', 'aheadPress', 'behindCaution', 'engageShift']);
    for (const k of ['hysteresis', 'engageRadius', 'awarenessRadius', 'groupStartSec', 'farmDecayStartSec', 'farmDecayEndSec', 'farmDecayMin', 'groupRampPerMin', 'gankMinSec', 'recallHpFraction', 'teamPlanIntervalSec', 'teamfightRadius', 'teamfightMinPerSide', 'teamfightEndQuietSec']) {
      c.num(ai, k, `${p}.ai`, 0);
    }
  }
  const tactics = c.obj(o.tactics, `${p}.tactics`);
  if (tactics) {
    for (const t of TACTICS) {
      const tp = `${p}.tactics.${t}`;
      const to = c.obj(tactics[t], tp);
      if (!to) continue;
      c.str(to, 'name', tp);
      c.str(to, 'description', tp);
      c.num(to, 'retreatThresholdDelta', tp, -1, 1);
      c.num(to, 'engageRatio', tp, 0.1, 10);
      c.arr(to.splitRoles, `${tp}.splitRoles`);
      c.num(to, 'farmGold', tp, 0.1, 5);
      c.num(to, 'siegeDamage', tp, 0.1, 5);
      const curve = c.arr(to.powerCurve, `${tp}.powerCurve`) ?? [];
      curve.forEach((w, i) => {
        const wo = c.obj(w, `${tp}.powerCurve[${i}]`);
        if (!wo) return;
        c.num(wo, 'damage', `${tp}.powerCurve[${i}]`, 0.1, 5);
        c.optNum(wo, 'fromSec', `${tp}.powerCurve[${i}]`, 0);
        c.optNum(wo, 'toSec', `${tp}.powerCurve[${i}]`, 0);
      });
      const rules = c.arr(to.rules, `${tp}.rules`) ?? [];
      rules.forEach((r, i) => {
        const ro = c.obj(r, `${tp}.rules[${i}]`);
        if (!ro) return;
        c.arr(ro.actions, `${tp}.rules[${i}].actions`, 1);
        c.num(ro, 'factor', `${tp}.rules[${i}]`, 0);
        c.optNum(ro, 'fromSec', `${tp}.rules[${i}]`, 0);
        c.optNum(ro, 'toSec', `${tp}.rules[${i}]`, 0);
      });
    }
  }
}

function checkSeason(c: Checker, raw: unknown): void {
  const p = 'season.json';
  const o = checkNumbers(c, raw, p, ['preseasonWeeks', 'daysPerWeek', 'matchWeekday', 'payWeekday', 'playoffTeams', 'secondsPerDayAt1x', 'startReputation', 'maxSeasonsHistory']);
  if (!o) return;
  if (typeof o.daysPerWeek === 'number') {
    for (const k of ['matchWeekday', 'payWeekday']) if (typeof o[k] === 'number' && (o[k] as number) >= (o.daysPerWeek as number)) c.fail(`${p}.${k}`, 'must be less than daysPerWeek');
  }
  if (o.playoffTeams !== 4 && o.playoffTeams !== 2) c.fail(`${p}.playoffTeams`, 'expected 2 or 4');
  c.arr(o.speeds, `${p}.speeds`, 1);
  const pauses = c.arr(o.autoPause, `${p}.autoPause`) ?? [];
  const allowed = ['MATCH_DAY', 'OFFER', 'CONTRACT_EXPIRING', 'LOW_FUNDS', 'SEASON_END'];
  pauses.forEach((e, i) => { if (!allowed.includes(e as string)) c.fail(`${p}.autoPause[${i}]`, `unknown event ${JSON.stringify(e)}`); });
}

function checkGrowth(c: Checker, raw: unknown): void {
  const p = 'growth.json';
  const o = checkNumbers(c, raw, p, [
    'weeklyGrowthBase', 'offFocusShare', 'masteryFocusHeroes', 'masteryFocusGain', 'masteryPerMatch', 'matchExperience', 'potentialSoftCap',
    'fatiguePerMatch', 'fatiguePerTrainingWeek', 'fatigueRestRecovery', 'fatigueDailyRecovery', 'moraleNeutral', 'moraleDailyDrift', 'moraleFormPer',
    'formPull', 'aiRestFatigue',
  ]);
  if (!o) return;
  for (const k of ['moraleWin', 'moraleLoss', 'moraleBench']) c.num(o, k, p, -100, 100);
  const focus = c.obj(o.trainingFocus, `${p}.trainingFocus`);
  if (focus) for (const f of TRAINING_FOCI) if (!focus[f]) c.fail(`${p}.trainingFocus`, `missing focus ${f}`);
  const rotation = c.arr(o.aiFocusRotation, `${p}.aiFocusRotation`, 1) ?? [];
  rotation.forEach((f, i) => { if (!TRAINING_FOCI.includes(f as TrainingFocus)) c.fail(`${p}.aiFocusRotation[${i}]`, `unknown focus ${String(f)}`); });
  const curve = c.arr(o.ageCurve, `${p}.ageCurve`, 2) ?? [];
  curve.forEach((pt, i) => { const po = c.obj(pt, `${p}.ageCurve[${i}]`); if (po) { c.num(po, 'age', `${p}.ageCurve[${i}]`, 10, 60); c.num(po, 'rate', `${p}.ageCurve[${i}]`, -10, 10); } });
}

/** Validates raw JSON values; returns a list of human-readable issues (empty = valid). */
export function validateRawData(raw: RawGameData): string[] {
  const c = new Checker();
  checkHeroes(c, raw.heroes);
  const heroIds = new Set(
    Array.isArray(raw.heroes) ? raw.heroes.map((h) => (h as Obj | null)?.id).filter((id): id is string => typeof id === 'string') : [],
  );
  checkPlayersAndClubs(c, raw.players, raw.clubs, heroIds);
  checkEconomy(c, raw.economy);
  checkMatch(c, raw.match, heroIds);
  checkSeason(c, raw.season);
  checkGrowth(c, raw.growth);
  return c.issues;
}

/** Loads the bundled data (or the given raw data), validates it and builds lookup tables. */
export function loadGameData(raw: RawGameData = defaultRawData()): GameData {
  const issues = validateRawData(raw);
  if (issues.length > 0) throw new DataValidationError(issues);
  const heroes = raw.heroes as HeroDef[];
  const heroById: Record<string, HeroDef> = {};
  for (const h of heroes) heroById[h.id] = h;
  return {
    heroes,
    players: raw.players as Player[],
    clubs: raw.clubs as ClubDef[],
    economy: raw.economy as EconomyConfig,
    match: raw.match as MatchConfig,
    season: raw.season as SeasonConfig,
    growth: raw.growth as GrowthConfig,
    heroById,
  };
}

/** Fresh deep copy of the bundled JSON, safe to mutate (e.g. in tests). */
export function defaultRawData(): RawGameData {
  return structuredClone({ heroes: heroesJson, players: playersJson, clubs: clubsJson, economy: economyJson, match: matchJson, season: seasonJson, growth: growthJson });
}

/** Checks a lineup against the provided roster. Returns issues (empty = valid). */
export function validateLineup(lineup: TeamLineup, roster: readonly Player[], data: GameData): string[] {
  const issues: string[] = [];
  if (!TACTICS.includes(lineup.tactic)) issues.push(`unknown tactic ${lineup.tactic}`);
  if (lineup.picks.length !== 5) issues.push(`expected 5 picks, got ${lineup.picks.length}`);
  const roles = new Set<Role>();
  const players = new Set<string>();
  const rosterIds = new Set(roster.map((p) => p.id));
  lineup.picks.forEach((pick, i) => {
    if (!ROLES.includes(pick.role)) issues.push(`picks[${i}]: unknown role ${pick.role}`);
    if (roles.has(pick.role)) issues.push(`picks[${i}]: duplicate role ${pick.role}`);
    roles.add(pick.role);
    if (players.has(pick.playerId)) issues.push(`picks[${i}]: player ${pick.playerId} picked twice`);
    players.add(pick.playerId);
    if (!rosterIds.has(pick.playerId)) issues.push(`picks[${i}]: player ${pick.playerId} not in roster`);
    if (!data.heroById[pick.heroId]) issues.push(`picks[${i}]: unknown hero ${pick.heroId}`);
  });
  return issues;
}
