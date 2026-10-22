// Unit records for a match and their movement and stat formulas. Units are
// plain objects so the whole match state stays serialisable and easy to inspect.

import { DEFAULT_MASTERY, type HeroDef, type Lane, type MatchConfig, type Player, type Role, type Side } from '../core/types';
import { atNode, graphDistance, moveAlongPath, moveToward, type GameMap, type Loc } from './map';

export interface CreepWave {
  id: string;
  kind: 'CREEP';
  side: Side;
  lane: Lane;
  loc: Loc;
  nextIdx: number; // index into the lane path (in travel order) of the next node
  hp: number;
  maxHp: number;
  armor: number;
  attack: number;
  structureAttack: number;
  alive: boolean;
  engaged: boolean; // attacked (or was blocked) this tick, so it does not move
}

export interface CreepSpawnStats {
  hp: number;
  armor: number;
  attack: number;
  structureAttack: number;
}

/** Lane node path in the travel direction of the given side. */
export function lanePathFor(map: GameMap, lane: Lane, side: Side): number[] {
  const path = map.lanes[lane];
  return side === 'BLUE' ? path : [...path].reverse();
}

export function spawnWave(map: GameMap, id: string, side: Side, lane: Lane, stats: CreepSpawnStats): CreepWave {
  const path = lanePathFor(map, lane, side);
  return {
    id,
    kind: 'CREEP',
    side,
    lane,
    loc: atNode(path[0]!),
    nextIdx: 1,
    hp: stats.hp,
    maxHp: stats.hp,
    armor: stats.armor,
    attack: stats.attack,
    structureAttack: stats.structureAttack,
    alive: true,
    engaged: false,
  };
}

export function moveWave(map: GameMap, wave: CreepWave, distance: number): void {
  const path = lanePathFor(map, wave.lane, wave.side);
  const res = moveAlongPath(map, wave.loc, path, wave.nextIdx, distance);
  wave.loc = res.loc;
  wave.nextIdx = res.nextIdx;
}

/** Distance a wave has travelled from its own base along its lane. */
export function waveAdvance(map: GameMap, wave: CreepWave): number {
  const path = lanePathFor(map, wave.lane, wave.side);
  let d = 0;
  for (let i = 1; i < wave.nextIdx && i < path.length; i++) {
    d += graphDistance(map, atNode(path[i - 1]!), atNode(path[i]!));
  }
  const prev = path[Math.min(wave.nextIdx, path.length) - 1]!;
  return d + graphDistance(map, atNode(prev), wave.loc);
}

// ---------------------------------------------------------------------------
// Structures, neutral objectives and jungle camps

export interface Structure {
  id: string;
  kind: 'TOWER' | 'BASE';
  side: Side;
  node: number;
  lane: Lane | null;
  tier: 0 | 1 | 2; // 0 = base
  hp: number;
  maxHp: number;
  armor: number;
  attack: number;
  creepAttack: number;
  range: number;
  alive: boolean;
  /** Hero (index) that recently hit an allied hero inside this structure's range. */
  aggroHero: number;
  aggroUntil: number;
  lastHitSide: Side | null;
}

export interface Objective {
  cfgIdx: number;
  id: string;
  name: string;
  node: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  nextSpawnAt: number;
  attackers: { hero: number; t: number }[];
  lastHitSide: Side | null;
  tickDamage: Record<Side, number>; // damage taken from each side during the current tick
}

export interface Camp {
  id: string;
  node: number;
  side: Side;
  alive: boolean;
  hp: number;
  nextSpawnAt: number;
  lastHitHero: number;
  tickHit: { BLUE: number; RED: number; dmgBLUE: number; dmgRED: number }; // per-side hitter and damage this tick
}

// ---------------------------------------------------------------------------
// Heroes

export interface HeroCoefficients {
  damage: number; // mechanics x form x role
  skillHit: number;
  farm: number;
  masteryEffect: number;
  cooldownMult: number;
  performance: number; // form x role
  retreatThreshold: number;
  decisionChance: number;
  decisionNoise: number;
  gankDetect: number;
  groupDelay: number;
  focusChance: number;
  mentalPenalty: number; // multiplier applied while the team is far behind in gold
  mastery: number;
  roleFit: 'primary' | 'secondary' | 'off';
}

export interface HeroUnit {
  idx: number; // position in MatchState.heroes
  id: string; // unit id, e.g. 'BLUE:TOP'
  kind: 'HERO';
  side: Side;
  role: Role;
  player: Player;
  hero: HeroDef;
  coef: HeroCoefficients;
  loc: Loc;
  alive: boolean;
  respawnAt: number;
  hp: number;
  maxHp: number;
  attack: number;
  armor: number;
  shield: number;
  shieldUntil: number;
  level: number;
  xp: number;
  gold: number; // total earned; no shop, gold converts to stats
  skillReadyAt: number;
  stunnedUntil: number;
  slowedUntil: number;
  // AI state
  action: string;
  actionSince: number;
  actionTarget: number; // meaning depends on the action (hero / lane / objective / structure index)
  recallDoneAt: number; // > 0 while channelling a recall
  alertUntil: number; // noticed an incoming gank until this time
  gankTarget: number; // hero index while executing a gank, -1 otherwise
  gankHit: boolean; // GANK event already emitted for the current gank
  groupJoinAt: number; // when the delayed group call reaches this hero
  lastDamagedAt: number;
  lastHeroDamageAt: number; // last time this hero hit an enemy hero
  damagers: { hero: number; t: number }[];
  lastSplitEventAt: number;
  gankSeen: number[]; // per enemy hero: actionSince of the gank already rolled for detection
  // stats
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  heroDamage: number;
  skillHits: number;
}

function lin(c: { base: number; per: number }, v: number): number {
  return c.base + c.per * v;
}

export function roleFitOf(player: Player, role: Role): 'primary' | 'secondary' | 'off' {
  if (player.primaryRole === role) return 'primary';
  if (player.secondaryRole === role) return 'secondary';
  return 'off';
}

export function masteryOf(player: Player, heroId: string): number {
  return player.heroMastery[heroId] ?? DEFAULT_MASTERY;
}

export function computeCoefficients(cfg: MatchConfig, player: Player, role: Role, heroId: string): HeroCoefficients {
  const k = cfg.coefficients;
  const a = player.attrs;
  const roleFit = roleFitOf(player, role);
  const roleMult = k.role[roleFit];
  const formMult = 1 + player.form * k.formPer;
  const performance = roleMult * formMult;
  const mastery = masteryOf(player, heroId);
  return {
    damage: lin(k.mechanicsDamage, a.mechanics) * performance,
    skillHit: Math.min(0.98, lin(k.skillHit, a.mechanics) * performance),
    farm: lin(k.farm, a.mechanics) * performance,
    masteryEffect: lin(k.masteryEffect, mastery),
    cooldownMult: Math.max(0.5, 1 - mastery * k.masteryCooldown),
    performance,
    retreatThreshold: lin(k.retreatThreshold, a.awareness),
    decisionChance: Math.min(1, lin(k.decisionChance, a.awareness)),
    decisionNoise: k.decisionNoise.base + k.decisionNoise.per * (100 - a.awareness),
    gankDetect: Math.min(0.97, lin(k.gankDetect, a.awareness) * performance),
    groupDelay: k.teamworkDelay * (100 - a.teamwork),
    focusChance: Math.min(1, lin(k.teamworkFocus, a.teamwork)),
    mentalPenalty: Math.max(0.5, 1 - (100 - a.mental) * k.mentalPenaltyPer),
    mastery,
    roleFit,
  };
}

/** Recomputes max hp / attack / armor from level and gold, keeping the hp fraction. */
export function refreshHeroStats(cfg: MatchConfig, h: HeroUnit): void {
  const lv = h.level - 1;
  const steps = Math.floor(h.gold / cfg.hero.goldStep);
  const goldMult = 1 + steps * cfg.hero.goldStepBonus;
  const maxHp = (h.hero.base.hp + h.hero.perLevel.hp * lv) * goldMult;
  const frac = h.maxHp > 0 ? h.hp / h.maxHp : 1;
  h.maxHp = maxHp;
  h.hp = Math.min(maxHp, frac * maxHp);
  h.attack = (h.hero.base.attack + h.hero.perLevel.attack * lv) * goldMult;
  h.armor = h.hero.base.armor + h.hero.perLevel.armor * lv;
}

export function createHero(cfg: MatchConfig, idx: number, side: Side, role: Role, player: Player, hero: HeroDef, baseNode: number): HeroUnit {
  const h: HeroUnit = {
    idx,
    id: `${side}:${role}`,
    kind: 'HERO',
    side,
    role,
    player,
    hero,
    coef: computeCoefficients(cfg, player, role, hero.id),
    loc: atNode(baseNode),
    alive: true,
    respawnAt: 0,
    hp: 1,
    maxHp: 1,
    attack: 0,
    armor: 0,
    shield: 0,
    shieldUntil: 0,
    level: 1,
    xp: 0,
    gold: 0,
    skillReadyAt: 0,
    stunnedUntil: 0,
    slowedUntil: 0,
    action: 'IDLE',
    actionSince: 0,
    actionTarget: -1,
    recallDoneAt: 0,
    alertUntil: 0,
    gankTarget: -1,
    gankHit: false,
    groupJoinAt: 0,
    lastDamagedAt: -999,
    lastHeroDamageAt: -999,
    damagers: [],
    lastSplitEventAt: -999,
    gankSeen: new Array<number>(10).fill(-1),
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    heroDamage: 0,
    skillHits: 0,
  };
  refreshHeroStats(cfg, h);
  h.hp = h.maxHp;
  return h;
}

export function heroMoveSpeed(cfg: MatchConfig, h: HeroUnit, t: number): number {
  return h.hero.base.moveSpeed * (h.slowedUntil > t ? cfg.hero.slowFactor : 1);
}

export function moveHero(map: GameMap, hero: HeroUnit, target: Loc, distance: number): void {
  hero.loc = moveToward(map, hero.loc, target, distance);
}

/** Adds xp and handles level-ups. Returns true if the hero levelled up. */
export function grantXp(cfg: MatchConfig, h: HeroUnit, xp: number): boolean {
  h.xp += xp;
  let levelled = false;
  while (h.level < cfg.hero.maxLevel) {
    const need = cfg.hero.xpPerLevel[h.level - 1]!;
    if (h.xp < need) break;
    h.xp -= need;
    const frac = h.hp / h.maxHp;
    h.level++;
    refreshHeroStats(cfg, h);
    h.hp = Math.min(h.maxHp, frac * h.maxHp + 0.05 * h.maxHp);
    levelled = true;
  }
  if (h.level >= cfg.hero.maxLevel) h.xp = 0;
  return levelled;
}

export function grantGold(cfg: MatchConfig, h: HeroUnit, gold: number): void {
  const before = Math.floor(h.gold / cfg.hero.goldStep);
  h.gold += gold;
  if (Math.floor(h.gold / cfg.hero.goldStep) !== before) refreshHeroStats(cfg, h);
}
