// Shared types for every module. Frozen after T01: add fields freely,
// but renaming or removing requires an entry in docs/DECISIONS.md.

export type Role = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT';
export const ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

export type Tactic = 'EARLY_AGGRO' | 'STEADY_MACRO' | 'TEAMFIGHT_PUSH' | 'SPLIT_PUSH';
export const TACTICS: readonly Tactic[] = ['EARLY_AGGRO', 'STEADY_MACRO', 'TEAMFIGHT_PUSH', 'SPLIT_PUSH'];

export type Archetype = 'TANK' | 'ASSASSIN' | 'MAGE' | 'MARKSMAN' | 'SUPPORT';
export const ARCHETYPES: readonly Archetype[] = ['TANK', 'ASSASSIN', 'MAGE', 'MARKSMAN', 'SUPPORT'];

export type Side = 'BLUE' | 'RED';
export const SIDES: readonly Side[] = ['BLUE', 'RED'];

export type PlayerId = string;
export type HeroId = string;
export type ClubId = string;

export interface PlayerAttributes {
  mechanics: number; // 1-100
  awareness: number; // 1-100
  teamwork: number; // 1-100
  mental: number; // 1-100
}

export interface Player {
  id: PlayerId;
  name: string;
  age: number;
  primaryRole: Role;
  secondaryRole?: Role;
  attrs: PlayerAttributes;
  heroMastery: Record<HeroId, number>; // 0-100, unlisted heroes count as DEFAULT_MASTERY
  form: number; // -10..+10
  salaryPerWeek: number;
  signingFee: number;
  clubId: ClubId | null;
  // Reserved for P1+, unused in P0:
  potential?: number;
  fatigue?: number;
  morale?: number;
  traits?: string[];
}

export const DEFAULT_MASTERY = 20;

export type SkillEffectType = 'DAMAGE' | 'STUN' | 'SHIELD' | 'HEAL' | 'DASH' | 'SLOW';

export interface SkillEffect {
  type: SkillEffectType;
  // DAMAGE/SHIELD/HEAL: multiplier of the caster's attack.
  // STUN/SLOW: seconds. DASH: map units moved toward the target.
  value: number;
}

export type SkillTarget = 'ENEMY_SINGLE' | 'ENEMY_AREA' | 'ALLY_SINGLE' | 'ALLY_AREA' | 'SELF';

export interface SkillDef {
  id: string;
  name: string;
  description: string; // one-line, player-facing (zh-CN)
  cooldown: number; // seconds
  range: number; // map units
  target: SkillTarget;
  areaRadius?: number;
  effects: SkillEffect[];
}

export interface HeroDef {
  id: HeroId;
  name: string;
  title: string; // short epithet, player-facing
  archetype: Archetype;
  preferredRoles: Role[];
  base: { hp: number; attack: number; armor: number; attackRange: number; attackInterval: number; moveSpeed: number };
  perLevel: { hp: number; attack: number; armor: number };
  skill: SkillDef;
}

export interface Pick {
  role: Role;
  playerId: PlayerId;
  heroId: HeroId;
}

export interface TeamLineup {
  clubId: ClubId;
  picks: Pick[]; // exactly 5, distinct roles
  tactic: Tactic;
}

export interface MatchInput {
  seed: number;
  blue: { lineup: TeamLineup; players: Player[] };
  red: { lineup: TeamLineup; players: Player[] };
}

export type MatchEventType =
  | 'MATCH_START' | 'KILL' | 'ASSIST' | 'DEATH' | 'GANK'
  | 'TEAMFIGHT_START' | 'TEAMFIGHT_END'
  | 'TOWER_DESTROYED' | 'OBJECTIVE_TAKEN' | 'BASE_DAMAGED' | 'BASE_DESTROYED'
  | 'SKILL_KEY' | 'SPLIT_PUSH' | 'RECALL' | 'OVERTIME' | 'MATCH_END';

export interface MatchEvent {
  t: number; // match seconds
  type: MatchEventType;
  side?: Side;
  actors: PlayerId[];
  targets?: PlayerId[];
  nodeId?: string;
  detail?: Record<string, number | string>;
  reason?: string; // machine-readable tag, e.g. 'tactic:EARLY_AGGRO', 'mastery_high', 'offrole'
}

export interface PlayerMatchStats {
  playerId: PlayerId;
  heroId: HeroId;
  side: Side;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damageDealt: number;
  rating: number; // 1-10
}

export interface MatchResult {
  winner: Side;
  durationSec: number;
  players: PlayerMatchStats[];
  goldDiffTimeline: { t: number; diff: number }[]; // every 30s, blue - red
  towers: { BLUE: number; RED: number }; // towers still standing
  events: MatchEvent[];
  mvp: PlayerId;
  checksum: string;
}

// ---------------------------------------------------------------------------
// Render snapshot: read-only view of a match tick for the render layer.

export type SnapshotUnitKind = 'HERO' | 'CREEP' | 'TOWER' | 'BASE' | 'OBJECTIVE';

export interface SnapshotUnit {
  id: string;
  kind: SnapshotUnitKind;
  side: Side | null; // null for neutral objectives
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  playerId?: PlayerId;
  heroId?: HeroId;
  level?: number;
  action?: string;
  stunned?: boolean;
  shield?: number;
}

export interface SnapshotAttack {
  from: string; // unit id
  to: string; // unit id
  kind: 'BASIC' | 'SKILL';
}

export interface RenderSnapshot {
  t: number;
  over: boolean;
  winner: Side | null;
  units: SnapshotUnit[];
  attacks: SnapshotAttack[]; // attacks performed during the last tick
  kills: { BLUE: number; RED: number };
  gold: { BLUE: number; RED: number };
  towersStanding: { BLUE: number; RED: number };
  newEvents: MatchEvent[]; // events emitted during the last tick
}

// ---------------------------------------------------------------------------
// Data files

export type ClubStyle = Tactic | 'RANDOM';

export interface ClubDef {
  id: ClubId;
  name: string;
  shortName: string;
  color: string; // hex, e.g. '#3a7bd5'
  style: ClubStyle;
  description: string;
  players: Player[]; // 5-6, each with clubId === id
}

export interface EconomyConfig {
  startingFunds: number;
  weeklySponsor: number;
  prizeWin: number;
  prizeLoss: number;
  signingFeeWeeks: number; // signing fee = salary * weeks (informational; players carry signingFee)
  releaseFeeWeeks: number; // release fee = salary * weeks
  lowFundsWarningWeeks: number; // warn when funds < weekly salaries * this
  minRoster: number;
  maxRoster: number;
  formWeeklyDelta: number; // max weekly random change of form
}

export type MapNodeType = 'BASE' | 'TOWER' | 'LANE' | 'JUNGLE' | 'RIVER' | 'OBJECTIVE';
export type Lane = 'TOP' | 'MID' | 'BOT';
export const LANES: readonly Lane[] = ['TOP', 'MID', 'BOT'];

export interface MapNode {
  id: string;
  type: MapNodeType;
  x: number;
  y: number;
  side?: Side; // owner for BASE / TOWER / JUNGLE nodes
  lane?: Lane; // for TOWER / LANE nodes
  tier?: 1 | 2; // for TOWER nodes: 1 = outer, 2 = inner
}

export interface MapConfig {
  nodes: MapNode[];
  edges: [string, string][];
  lanes: Record<Lane, string[]>; // node ids from BLUE base to RED base
}

export interface StructureStats {
  hp: number;
  armor: number;
  attack: number; // damage per second vs heroes
  creepAttack: number; // damage per second vs creep waves
  range: number;
}

export interface ObjectiveConfig {
  id: string;
  name: string;
  nodeId: string;
  firstSpawnSec: number;
  respawnSec: number;
  hp: number;
  hpPerMinute: number;
  attack: number;
  range: number;
  goldPerMember: number;
  buff: { kind: 'ATTACK' | 'SIEGE'; value: number; durationSec: number };
}

export interface CoefLinear {
  base: number;
  per: number; // multiplied by the attribute value (1-100)
}

export interface TacticRule {
  actions: string[]; // AI action names, or '*' for all aggressive actions
  factor: number;
  fromSec?: number;
  toSec?: number;
  roles?: Role[];
}

export interface TacticConfig {
  name: string; // zh-CN display name
  description: string; // one-line zh-CN explanation
  rules: TacticRule[];
  retreatThresholdDelta: number;
  engageRatio: number; // fight if local power ratio >= this
  splitRoles: Role[];
}

export interface MatchConfig {
  time: {
    tickSec: number;
    realSecPerTickAt1x: number;
    overtimeStartSec: number;
    overtimeCreepBonusPerMin: number;
    suddenDeathSec: number;
    maxDurationSec: number;
    goldTimelineIntervalSec: number;
  };
  map: MapConfig;
  creeps: {
    firstSpawnSec: number;
    intervalSec: number;
    hp: number;
    armor: number;
    attack: number; // dps vs other creeps / heroes
    structureAttack: number; // dps vs towers and bases
    range: number;
    moveSpeed: number;
    hpPerMinute: number;
    attackPerMinute: number;
    gold: number;
    xp: number;
    shareRadius: number;
  };
  towers: { T1: StructureStats; T2: StructureStats };
  base: StructureStats & { suddenDeathArmor: number };
  objectives: ObjectiveConfig[];
  jungle: { campHp: number; campGold: number; campXp: number; respawnSec: number; firstSpawnSec: number };
  hero: {
    respawnBase: number;
    respawnPerLevel: number;
    maxLevel: number;
    xpPerLevel: number[]; // xp needed to go from level i+1 to i+2
    passiveGoldPerSec: number;
    passiveXpPerSec: number;
    goldStep: number; // every N gold earned...
    goldStepBonus: number; // ...grants +X attack and hp
    killGold: number;
    killGoldPerVictimLevel: number;
    assistGold: number; // split among assisters
    killXp: number;
    killXpPerVictimLevel: number;
    assistWindowSec: number;
    towerGoldPerMember: number;
    baseRegenPerSec: number; // fraction of max hp
    idleRegenPerSec: number;
    recallSec: number;
    slowFactor: number;
    armorConstant: number; // damage taken = raw * C / (C + armor)
  };
  coefficients: {
    mechanicsDamage: CoefLinear;
    skillHit: CoefLinear;
    farm: CoefLinear;
    masteryEffect: CoefLinear;
    masteryCooldown: number; // cooldown reduction per mastery point
    mentalDeficitGold: number;
    mentalPenaltyPer: number; // per (100 - mental)
    formPer: number;
    role: { primary: number; secondary: number; off: number };
    retreatThreshold: CoefLinear; // awareness
    decisionChance: CoefLinear; // awareness: chance to re-evaluate each tick
    decisionNoise: CoefLinear; // noise = base + per * (100 - awareness)
    gankDetect: CoefLinear; // awareness
    teamworkDelay: number; // seconds of group-call delay per (100 - teamwork)
    teamworkFocus: CoefLinear; // chance to focus the team target
  };
  ai: {
    baseUtility: Record<string, Partial<Record<Role, number>>>;
    hysteresis: number;
    engageRadius: number;
    awarenessRadius: number;
    groupStartSec: number;
    groupRampPerMin: number;
    gankMinSec: number;
    recallHpFraction: number;
    teamPlanIntervalSec: number;
    teamfightRadius: number;
    teamfightMinPerSide: number;
    teamfightEndQuietSec: number;
  };
  tactics: Record<Tactic, TacticConfig>;
}

export interface GameData {
  heroes: HeroDef[];
  players: Player[]; // free agents
  clubs: ClubDef[];
  economy: EconomyConfig;
  match: MatchConfig;
  heroById: Record<HeroId, HeroDef>;
}
