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
  // P1 (optional in data files; filled with defaults when missing):
  potential?: number; // hidden ceiling for growth, 0-100
  fatigue?: number; // 0-100, high = tired
  morale?: number; // 0-100
  contractUntil?: number; // last season (1-based) of the current contract; absent for free agents
  stats?: CareerStats;
  // Reserved for P2+:
  traits?: string[];
}

export interface CareerStats {
  played: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

/** How an AI club runs its business (GDD 11). */
export type ManagementStyle = 'RICH' | 'YOUTH' | 'STEADY' | 'AGGRESSIVE' | 'FALLEN';
export const MANAGEMENT_STYLES: readonly ManagementStyle[] = ['RICH', 'YOUTH', 'STEADY', 'AGGRESSIVE', 'FALLEN'];

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
  management: ManagementStyle;
  funds: number;
  reputation: number; // 0-100
}

export interface EconomyConfig {
  startingFunds: number;
  weeklySponsor: number;
  prizeWin: number;
  prizeLoss: number;
  signingFeeWeeks: number; // signing fee = salary * weeks (informational; players carry signingFee)
  lowFundsWarningWeeks: number; // warn when funds < weekly salaries * this
  minRoster: number;
  maxRoster: number;
  formWeeklyDelta: number; // max weekly random change of form
  contracts: ContractConfig;
}

/** Salaries, market values, renewals and transfers (P1). */
export interface ContractConfig {
  // fair weekly salary = salaryBase + max(0, overall - salaryFloor)^salaryExp * salaryPer (+ youth premium)
  salaryBase: number;
  salaryFloor: number;
  salaryExp: number;
  salaryPer: number;
  youthAge: number; // players up to this age are also paid for their potential
  youthPremiumPerPotential: number; // per point of (potential - overall)
  // market value = fair salary * valueWeeks * age/potential multiplier * form multiplier
  valueWeeks: number;
  valuePotentialPer: number;
  valueDeclineAge: number;
  valueDeclinePerYear: number;
  valueMinMult: number;
  valueFormPer: number;
  minYears: number;
  maxYears: number;
  defaultYears: number;
  askMoralePer: number; // renewal ask rises by this share per morale point below neutral
  askMinOfCurrent: number; // never asks for less than this share of the current salary
  counterAcceptRatio: number; // a counter offer >= ask * ratio is accepted...
  counterMoralePer: number; // ...the ratio drops by this per morale point above neutral
  refuseMoralePenalty: number;
  releaseFeeShare: number; // release fee = salary * remaining contract weeks * share
  aiSellMult: number; // AI sells a bench player for >= value * this
  aiSellCoreMult: number; // ...and a starter for >= value * this
  aiOfferChancePerWeek: number;
  aiOfferMin: number;
  aiOfferMax: number;
  aiOfferMinGain: number; // AI bids only for players this much better than its starter
  aiReserveWeeks: number; // AI keeps this many weeks of payroll in the bank
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
  /** Team damage multipliers by time window: the tactic's tempo (early vs late power). */
  powerCurve: { fromSec?: number; toSec?: number; damage: number }[];
  /** Multiplier on creep and jungle gold (farming focus). */
  farmGold: number;
  /** Multiplier on hero damage against towers and bases (siege focus). */
  siegeDamage: number;
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
    structureDamage: number; // heroes deal this fraction of their damage to towers and bases
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
    fatigue: { start: number; per: number }; // performance -per for each fatigue point above start
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
    farmDecayStartSec: number; // farming utility starts to fall off here...
    farmDecayEndSec: number; // ...reaching farmDecayMin here
    farmDecayMin: number;
    /** Gold-lead behaviour: ahead teams press, behind teams defend. */
    momentum: { thresholdGold: number; spanGold: number; aheadPress: number; behindCaution: number; engageShift: number };
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

export type AutoPauseEvent = 'MATCH_DAY' | 'OFFER' | 'CONTRACT_EXPIRING' | 'LOW_FUNDS' | 'SEASON_END';

export interface SeasonConfig {
  preseasonWeeks: number; // transfer window before the regular season
  daysPerWeek: number;
  matchWeekday: number; // 0-based day of the week league matches are played
  payWeekday: number; // day salaries and sponsors are settled
  playoffTeams: number; // top N play semi-finals and a final
  secondsPerDayAt1x: number;
  speeds: number[];
  autoPause: AutoPauseEvent[];
  startReputation: number;
  maxSeasonsHistory: number;
}

export type TrainingFocus = 'MECHANICS' | 'AWARENESS' | 'TEAMWORK' | 'MENTAL' | 'MASTERY' | 'REST';
export const TRAINING_FOCI: readonly TrainingFocus[] = ['MECHANICS', 'AWARENESS', 'TEAMWORK', 'MENTAL', 'MASTERY', 'REST'];

export interface GrowthConfig {
  trainingFocus: Record<TrainingFocus, Partial<Record<keyof PlayerAttributes | 'mastery', number>>>;
  weeklyGrowthBase: number; // attribute points per week for the focused attribute at age rate 1
  offFocusShare: number; // share of that growth the other attributes get
  masteryFocusHeroes: number; // MASTERY focus trains this many of each player's best heroes
  masteryFocusGain: number; // mastery points per week per trained hero at age rate 1
  masteryPerMatch: number; // mastery points for the hero played in a match
  ageCurve: { age: number; rate: number }[];
  matchExperience: number;
  potentialSoftCap: number;
  fatiguePerMatch: number;
  fatiguePerTrainingWeek: number;
  fatigueRestRecovery: number;
  fatigueDailyRecovery: number;
  moraleWin: number;
  moraleLoss: number;
  moraleBench: number;
  moraleDailyDrift: number;
  moraleNeutral: number;
  moraleFormPer: number; // form target per morale point above neutral
  formPull: number; // weekly share of the gap between form and its morale target that closes
  aiRestFatigue: number; // AI clubs rest when their average fatigue reaches this
  aiFocusRotation: TrainingFocus[];
}

export interface GameData {
  heroes: HeroDef[];
  players: Player[]; // free agents
  clubs: ClubDef[];
  economy: EconomyConfig;
  match: MatchConfig;
  season: SeasonConfig;
  growth: GrowthConfig;
  heroById: Record<HeroId, HeroDef>;
}
