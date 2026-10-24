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
  ovrHistory?: number[]; // weekly overall while on the player's club (latest last, capped), for the player card
  // P2 (T21; filled with defaults when missing):
  traits?: string[]; // personality trait ids (traits.json), 0-2 per player
  growthType?: GrowthType; // when a career peaks
  career?: CareerSeason[]; // one entry per finished season on a club
  retired?: boolean;
  retiring?: boolean; // T23: stops when this season ends (announced a few weeks before)
}

/** When a career peaks: early, normal or late bloomer (growth.json growthTypes). */
export type GrowthType = 'EARLY' | 'NORMAL' | 'LATE';
export const GROWTH_TYPES: readonly GrowthType[] = ['EARLY', 'NORMAL', 'LATE'];

/** One finished season of a player's career. */
export interface CareerSeason {
  season: number;
  clubId: ClubId;
  clubName: string;
  played: number;
  wins: number;
  champion: boolean;
  ovr: number; // overall at the end of the season, one decimal
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
  blue: { lineup: TeamLineup; players: Player[]; chemistry?: number };
  red: { lineup: TeamLineup; players: Player[]; chemistry?: number };
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

export type SnapshotUnitKind = 'HERO' | 'CREEP' | 'TOWER' | 'BASE' | 'OBJECTIVE' | 'CAMP'; // CAMP: jungle monsters (V3)

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
  prizeWin: number;
  prizeLoss: number;
  signingFeeWeeks: number; // signing fee = salary * weeks (informational; players carry signingFee)
  lowFundsWarningWeeks: number; // warn when funds < weekly salaries * this
  minRoster: number;
  maxRoster: number;
  formWeeklyDelta: number; // max weekly random change of form
  contracts: ContractConfig;
  finance: FinanceConfig;
}

export interface SponsorDef {
  id: string;
  name: string;
  weekly: number;
  winBonus: number; // per match won
  signingBonus: number; // paid once on signing
  goals?: SponsorGoal[]; // season targets with a bonus, paid when the season ends (T27)
}

/** A sponsor's season target (T27): reach the playoffs, finish top 2, reach the final, win it all, or win N league games. */
export interface SponsorGoal {
  kind: 'PLAYOFFS' | 'TOP2' | 'FINAL' | 'CHAMPION' | 'WINS';
  value?: number; // WINS: league wins needed
  bonus: number;
}

/** Season MVP and hall of fame rules (T27, season.json awards). */
export interface AwardsConfig {
  mvpMinPlayed: number; // games in the season to be considered
  mvpWinRateWeight: number; // MVP score = overall + win rate x this (+ champion bonus)
  mvpChampionBonus: number;
  hallOfFame: { titles: number; mvps: number; regularSeasons: number; regularMinPlayed: number };
}

/** Income sources, running costs and reputation (P1). */
export interface FinanceConfig {
  sponsorTiers: { tier: number; minReputation: number; sponsors: SponsorDef[] }[];
  sponsorMaxYears: number;
  emergencySponsor: SponsorDef; // offered whenever funds are below the warning line
  leagueShareWeekly: number; // every club, regular season and playoffs
  playoffPrize: { champion: number; final: number; semi: number };
  merchBase: number; // weekly merchandise = (base + reputation * perReputation) * win-rate factor
  merchPerReputation: number;
  merchWinRateEffect: number; // factor = 1 + (season win rate - 0.5) * effect
  trainingCostPerPlayer: number; // per rostered player per training (non-rest) week
  reputation: { win: number; loss: number; streakLength: number; streakLoss: number; playoffs: number; final: number; champion: number; seasonPull: number; neutral: number };
  forecastWeeks: number;
  emergencySigningMaxSalary: number; // short of minRoster players, a club may sign on credit up to this salary (or the cheapest third of the market)
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
    /** Effect of full chemistry (100) between the five starters (T25); 0 chemistry does nothing. Each at most ±5% (Q7). */
    chemistry: { mechanics: number; teamwork: number };
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

export type AutoPauseEvent = 'MATCH_DAY' | 'OFFER' | 'CONTRACT_EXPIRING' | 'LOW_FUNDS' | 'SEASON_END' | 'DECISION';

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
  awards: AwardsConfig;
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
  aiFocusRotation: TrainingFocus[];
  /** The player's automatic training rests the week the squad's average fatigue reaches this. */
  autoRestFatigue: number;
  /** Share of players of each growth type and how far its age curve is shifted (years; T23). */
  growthTypes: Record<GrowthType, { weight: number; ageShift: number }>;
  retirement: RetirementConfig;
  chemistry: ChemistryConfig;
}

/** How chemistry between two teammates (0-100) grows and fades (T25). */
export interface ChemistryConfig {
  perMatch: number; // both started the same match
  perTeamworkWeek: number; // on the same club in a week that trained teamwork
  decayApart: number; // at the start of a season, for two players no longer on the same club
}

/** When players stop (T23). Checked once a season, a few weeks before it ends. */
export interface RetirementConfig {
  fromAge: number; // nobody younger retires
  alwaysAt: number; // everyone this old retires after the season
  chance: number[]; // chance at fromAge, fromAge+1, ... (the last value holds until alwaysAt)
  declinePoints: number; // this far below the career peak counts as clearly past it ...
  declineBonus: number; // ... and adds this to the chance
  typeBonus: Record<GrowthType, number>; // early bloomers stop sooner, late bloomers later
  noticeWeeks: number; // weeks before the season ends that it is decided and announced
}

/** A club room that can be upgraded (P2, T22). */
export type FacilityId = 'TRAINING' | 'LOUNGE' | 'OFFICE' | 'ANALYSIS' | 'STREAM';
export const FACILITY_IDS: readonly FacilityId[] = ['TRAINING', 'LOUNGE', 'OFFICE', 'ANALYSIS', 'STREAM'];

export interface FacilityLevel {
  cost: number; // to reach this level from the one below (level 1 is free)
  upkeep: number; // per week while at this level
  value: number; // the room's effect at this level (meaning per room, see facilities.json)
  sponsorReputation?: number; // OFFICE: reputation the sponsor tiers ask for less
}

export interface FacilityDef {
  id: FacilityId;
  name: string;
  effect: string; // what `value` changes, for people reading the data
  levels: FacilityLevel[]; // index 0 = level 1
}

export interface FacilitiesConfig {
  rooms: FacilityDef[];
  aiSpareShare: number; // AI clubs spend up to this share of their spare money on upgrades in the off-season
  aiPriority: Record<ManagementStyle, FacilityId[]>; // which rooms each AI style upgrades first
}

/** A personality trait (P2, T24). Effects are small: match performance at most ±5% each (D50). */
export interface TraitDef {
  id: string;
  name: string;
  description: string;
  weight: number; // how common it is
  tone: 'good' | 'bad' | 'mixed'; // tag colour in the interface (T24)
  excludes?: string[]; // traits that cannot come together with this one
  effects: Record<string, number>;
}

export interface TraitsConfig {
  countWeights: number[]; // chance of 0, 1, 2 ... traits
  traits: TraitDef[];
}

/** How an AI club of one management style runs its business (T17). */
export interface AiStyleConfig {
  wageShare: number; // payroll budget = expected weekly income * this
  reserveWeeks: number; // keeps this many weeks of payroll in the bank before spending
  rosterTarget: number;
  youthWeight: number; // value of (potential - overall) for players up to 22
  ageWeight: number; // penalty per year above 27
  upgradeMargin: number; // signs or buys only players this much better than the current starter
  restFatigue: number; // whole team rests at this average fatigue
  rotateFatigue: number; // a starter this tired sits out if a same-role substitute exists
}

export interface TalentConfig {
  intakePerRole: number; // new young free agents per role each season
  ageMin: number;
  ageMax: number;
  overallMin: number;
  overallMax: number;
  potentialMin: number;
  potentialMax: number;
  freeAgentLeaveAge: number; // unsigned free agents this old leave the league at the new season
  marketCap: number; // after the new class joins, the weakest older free agents leave beyond this many
  namePrefixes: string[];
  nameSuffixes: string[];
}

export interface AiConfig {
  styles: Record<ManagementStyle, AiStyleConfig>;
  slumpLosses: number; // after this many league losses in a row, an AI club tries another tactic
  talent: TalentConfig;
}

// ---------------------------------------------------------------------------
// Staff and delegation (P3)

/** A hired manager's job: players (MANAGER), training / lineup / tactics (COACH), money (FINANCE). */
export type StaffRole = 'MANAGER' | 'COACH' | 'FINANCE';
export const STAFF_ROLES: readonly StaffRole[] = ['MANAGER', 'COACH', 'FINANCE'];
/** How a staff member leans: careful with money and risk, bold, or betting on youth. */
export type StaffStyle = 'CAUTIOUS' | 'BOLD' | 'YOUTH';
export const STAFF_STYLES: readonly StaffStyle[] = ['CAUTIOUS', 'BOLD', 'YOUTH'];
/** How much a role may do alone: only advise (SELF), small things within the limit (SMALL), everything (FULL). */
export type Authority = 'SELF' | 'SMALL' | 'FULL';
export const AUTHORITIES: readonly Authority[] = ['SELF', 'SMALL', 'FULL'];
export type StaffId = string;

export interface StaffSkills {
  scouting: number; // judging players: signings, renewals, transfers (0-100)
  leading: number; // running the team: training, lineup, tactics
  money: number; // budgets, sponsors, facilities
}

export interface StaffMember {
  id: StaffId;
  name: string;
  role: StaffRole;
  skills: StaffSkills;
  style: StaffStyle;
  salaryPerWeek: number;
  signingFee: number;
  origin: 'MARKET' | 'RETIRED'; // retired players can become coaches
  formerPlayerId?: PlayerId;
  hired?: { season: number; until: number }; // on the player's club, with the last season of the contract
}

/** staff.json (P3). Values marked 〔待确认〕 in the task book. */
export interface StaffConfig {
  roles: Record<StaffRole, { name: string; description: string; skill: keyof StaffSkills }>;
  styles: Record<StaffStyle, { name: string; description: string }>;
  authorityNames: Record<Authority, string>;
  market: {
    perRole: number; // candidates per role each off-season
    skillMin: number;
    skillMax: number;
    mainSkillBonus: number; // the role's own skill is this much higher on average
    salaryBase: number;
    salaryPerSkill: number; // weekly salary = base + (main skill - skillMin) * this, rounded
    signingFeeWeeks: number;
    contractYears: number;
    releaseFeeShare: number; // share of the remaining contract paid when firing
    retiredCoachMinPeak: number; // retirees with a career peak this high may become coach candidates
    retiredCoachPerSeason: number;
    namePrefixes: string[];
    nameSuffixes: string[];
  };
  delegation: {
    defaultLimit: number; // largest single deal done without asking, under SMALL
    protectTop: number; // the strongest starters nobody may sell without the player
    pendingExpireWeeks: number;
    logMax: number; // decision log entries kept
  };
  /** How staff decide (T31). Skill s (0-100) scales mistakes and misjudgement by (1 - s/100). */
  decisions: {
    mistakeAtZero: number; // chance of a mistake for each decision at skill 0
    perceptionNoise: number; // a manager misjudges a player's overall by up to this much at skill 0
    reserveWeeks: Record<StaffStyle, number>; // weeks of running costs kept in the bank
    salaryCap: Record<StaffStyle, number>; // a signing's salary at most this x a fifth of the weekly income
    restFatigue: number; // the coach rests the squad at this average fatigue
    upgradeMargin: number; // signs a better player only if he looks this much better than the starter
    sellOverValue: number; // accepts a bid of at least this times the market value
    youthAgeMax: number;
    youthPotentialWeight: number; // youth-minded managers add this x (potential - overall) for young players
    rosterTarget: number; // contracts the manager wants to keep
    facilityShare: number; // finance spends at most this share of the spare money on one upgrade
    facilityOrder: Record<StaffStyle, FacilityId[]>;
    trainLagGap: number; // the coach trains mechanics unless another attribute is this far below it
    cautiousSalaryWeight: number; // a cautious manager takes this many ability points off per 1000 of weekly salary
    tacticCounter: Partial<Record<Tactic, Tactic>>; // a clear counter to an opponent's usual tactic (from the balance report)
    defaultTactic: Tactic; // against an opponent whose tactic is not known
  };
}

export interface GameData {
  heroes: HeroDef[];
  players: Player[]; // free agents
  clubs: ClubDef[];
  economy: EconomyConfig;
  match: MatchConfig;
  season: SeasonConfig;
  growth: GrowthConfig;
  ai: AiConfig;
  facilities: FacilitiesConfig;
  traits: TraitsConfig;
  staff: StaffConfig;
  heroById: Record<HeroId, HeroDef>;
}
