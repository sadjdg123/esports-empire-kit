// Pure choreography state calculation for Shooter (FPS) and Card division replays (V8).
// Reads BranchReplay data only (no DOM, no RNG, no mutation of simulation results) so that
// every frame's score, alive/dead status, bomb state, life totals, and special effects are
// 100% deterministic and verified in Node unit tests.

import type { GameData } from '../../core/types';
import type { BranchReplay } from '../../game';
import type { CardDeck, CardGame, CardNote, CardSeries, CardSide } from '../../sim-card';
import type { FpsRole, FpsRound, FpsSide, FpsSite } from '../../sim-fps';

export const FPS_CANVAS_W = 260;
export const FPS_CANVAS_H = 156;
export const CARD_CANVAS_W = 260;
export const CARD_CANVAS_H = 156;

export interface FpsUnitPose {
  id: string;
  name: string;
  side: FpsSide;
  role: FpsRole;
  x: number;
  y: number;
  alive: boolean;
  facing: 'left' | 'right';
  pose: 'stand' | 'walk' | 'shoot' | 'down' | 'cheer' | 'plant' | 'defuse';
  hasBomb: boolean;
}

export interface FpsShotFx {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  tag: string;
  progress: number;
}

export interface FpsSceneState {
  roundNumber: number;
  attackers: FpsSide;
  targetSite: FpsSite;
  score: Record<FpsSide, number>;
  done: boolean;
  winner: FpsSide;
  reason: FpsRound['reason'];
  bomb: {
    state: 'CARRIED' | 'PLANTED' | 'DEFUSED' | 'EXPLODED';
    site: FpsSite;
    x: number;
    y: number;
    byName?: string;
  };
  fakeBanner: { site: FpsSite; worked: boolean } | null;
  activeBanner: string | null;
  shot: FpsShotFx | null;
  units: FpsUnitPose[];
}

const SITE_POS: Record<FpsSite | 'MID', { x: number; y: number }> = {
  A: { x: 132, y: 42 },
  MID: { x: 130, y: 84 },
  B: { x: 132, y: 126 },
};

const SPAWN_POS: Record<FpsSide, { x: number; y: number }[]> = {
  BLUE: [
    { x: 26, y: 38 },
    { x: 22, y: 62 },
    { x: 28, y: 84 },
    { x: 22, y: 106 },
    { x: 26, y: 128 },
  ],
  RED: [
    { x: 234, y: 38 },
    { x: 238, y: 62 },
    { x: 232, y: 84 },
    { x: 238, y: 106 },
    { x: 234, y: 128 },
  ],
};

// Offsets around a site/zone so 5v5 players spread cleanly across the lane.
const ATTACK_OFFSETS: [number, number][] = [
  [-20, -7],
  [-44, -5],
  [-32, 5],
  [-66, -2],
  [-52, 9],
];
const DEFEND_OFFSETS: [number, number][] = [
  [20, -7],
  [44, -5],
  [32, 5],
  [66, -2],
  [52, 9],
];

/** Pure calculation of the FPS round visual state at event index `step` (0..round.events.length) and intra-step `subProgress` (0..1). */
export function computeFpsSceneState(
  replay: BranchReplay,
  roundIndex: number,
  step: number,
  subProgress = 1,
): FpsSceneState {
  const fps = replay.fps!;
  const clampedIdx = Math.max(0, Math.min(fps.rounds.length - 1, roundIndex));
  const round = fps.rounds[clampedIdx]!;
  const clampedStep = Math.max(0, Math.min(round.events.length, step));
  const sub = Math.max(0, Math.min(1, subProgress));
  const shown = round.events.slice(0, clampedStep);
  const done = clampedStep >= round.events.length;
  const beforeScore = clampedIdx > 0 ? fps.rounds[clampedIdx - 1]!.score : { BLUE: 0, RED: 0 };
  const score = done ? round.score : beforeScore;

  const dead = new Set<string>();
  const deathPos = new Map<string, { x: number; y: number }>();
  const lastZone = new Map<string, FpsSite | 'MID'>();
  let plantedSite: FpsSite | null = null;
  let planterId: string | null = null;
  let defuserId: string | null = null;
  let exploded = false;
  let fakeBanner: { site: FpsSite; worked: boolean } | null = null;

  const nameOf = (id: string) => replay.names[id] ?? id;

  // Build ordered rosters for BLUE and RED
  const blueRoster = fps.stats.filter((p) => p.side === 'BLUE');
  const redRoster = fps.stats.filter((p) => p.side === 'RED');
  const slotOf = new Map<string, number>();
  blueRoster.forEach((p, idx) => slotOf.set(p.id, idx));
  redRoster.forEach((p, idx) => slotOf.set(p.id, idx));
  const sideOf = new Map<string, FpsSide>();
  fps.stats.forEach((p) => sideOf.set(p.id, p.side));

  const posAtZone = (id: string, zone: FpsSite | 'MID'): { x: number; y: number } => {
    const side = sideOf.get(id) ?? 'BLUE';
    const slot = (slotOf.get(id) ?? 0) % 5;
    const isAtk = side === round.attackers;
    const base = SITE_POS[zone];
    const [ox, oy] = (isAtk ? ATTACK_OFFSETS[slot] : DEFEND_OFFSETS[slot])!;
    const dist = Math.abs(ox);
    const signedOx = side === 'BLUE' ? -dist : dist;
    return {
      x: Math.max(18, Math.min(FPS_CANVAS_W - 18, base.x + signedOx)),
      y: Math.max(35, Math.min(FPS_CANVAS_H - 20, base.y + oy)),
    };
  };

  shown.forEach((ev) => {
    if (ev.type === 'FAKE') {
      fakeBanner = { site: ev.site, worked: ev.worked };
    } else if (ev.type === 'KILL') {
      lastZone.set(ev.killer, ev.where);
      lastZone.set(ev.victim, ev.where);
      dead.add(ev.victim);
      deathPos.set(ev.victim, posAtZone(ev.victim, ev.where));
    } else if (ev.type === 'PLANT') {
      plantedSite = ev.site;
      planterId = ev.by;
      lastZone.set(ev.by, ev.site);
    } else if (ev.type === 'DEFUSE') {
      defuserId = ev.by;
      if (plantedSite) lastZone.set(ev.by, plantedSite);
    } else if (ev.type === 'EXPLODE') {
      exploded = true;
    }
  });

  const currentEvent = clampedStep > 0 ? shown[clampedStep - 1]! : null;
  let activeBanner: string | null = null;
  let shot: FpsShotFx | null = null;

  if (currentEvent) {
    switch (currentEvent.type) {
      case 'FAKE':
        activeBanner = `🎭 ${currentEvent.site}点佯攻 · ${currentEvent.worked ? '调虎离山！' : '防守未动'}`;
        break;
      case 'KILL': {
        const tag = currentEvent.opening ? '⚡首杀' : currentEvent.trade ? '⚔️补枪' : currentEvent.flank ? '🗡️绕后' : '💥击倒';
        activeBanner = `${tag} · ${nameOf(currentEvent.killer)} 击倒 ${nameOf(currentEvent.victim)}`;
        const kp = posAtZone(currentEvent.killer, currentEvent.where);
        const vp = deathPos.get(currentEvent.victim) ?? posAtZone(currentEvent.victim, currentEvent.where);
        shot = {
          fromX: kp.x,
          fromY: kp.y - 6,
          toX: vp.x,
          toY: vp.y - 6,
          color: replay.teams[currentEvent.side].color,
          tag,
          progress: sub,
        };
        break;
      }
      case 'PLANT':
        activeBanner = `💣 ${nameOf(currentEvent.by)} 在 ${currentEvent.site} 点安放装置！`;
        break;
      case 'DEFUSE':
        activeBanner = `🔧 ${nameOf(currentEvent.by)} 成功拆除装置！`;
        break;
      case 'EXPLODE':
        activeBanner = '💥 装置引爆！进攻方得分';
        break;
      case 'TIMEOUT':
        activeBanner = '⏰ 回合时间耗尽！防守方得分';
        break;
    }
  }

  const progress = round.events.length > 0 ? clampedStep / round.events.length : 1;
  const prevUnits = sub < 1 && clampedStep > 0
    ? new Map(computeFpsSceneState(replay, clampedIdx, clampedStep - 1, 1).units.map((u) => [u.id, u]))
    : null;
  const ease = 1 - (1 - sub) * (1 - sub);

  const units: FpsUnitPose[] = fps.stats.map((p) => {
    const slot = (slotOf.get(p.id) ?? 0) % 5;
    const spawn = SPAWN_POS[p.side][slot]!;
    const alive = !dead.has(p.id);
    const isAtk = p.side === round.attackers;

    // Default target zone for this player if they haven't been in an event yet
    let defaultZone: FpsSite | 'MID' = round.site;
    if (!isAtk) {
      defaultZone = slot < 2 ? 'A' : slot === 2 ? 'MID' : 'B';
      if (plantedSite || progress >= 0.45) defaultZone = plantedSite ?? round.site;
      else if (fakeBanner?.worked) defaultZone = fakeBanner.site;
    } else if (p.role === 'LURK') {
      defaultZone = 'MID';
    } else if (fakeBanner && progress < 0.35 && slot === 0) {
      defaultZone = fakeBanner.site;
    }

    const zone = lastZone.get(p.id) ?? defaultZone;
    const target = deathPos.get(p.id) ?? posAtZone(p.id, zone);
    const advance = clampedStep === 0 ? 0.22 : Math.min(1, 0.48 + progress * 0.52);
    const destX = !alive ? target.x : Math.round(spawn.x + (target.x - spawn.x) * advance);
    const destY = !alive ? target.y : Math.round(spawn.y + (target.y - spawn.y) * advance);

    let x = destX;
    let y = destY;
    let moving = false;
    if (sub < 1) {
      const from = clampedStep === 0 ? spawn : prevUnits?.get(p.id);
      if (from) {
        x = Math.round(from.x + (destX - from.x) * ease);
        y = Math.round(from.y + (destY - from.y) * ease);
        moving = Math.hypot(destX - from.x, destY - from.y) >= 2 && sub < 0.95;
      }
    }

    let pose: FpsUnitPose['pose'] = 'stand';
    if (!alive) {
      pose = 'down';
    } else if (done && p.side === round.winner) {
      pose = 'cheer';
    } else if (currentEvent?.type === 'KILL' && currentEvent.killer === p.id) {
      pose = 'shoot';
    } else if (currentEvent?.type === 'PLANT' && currentEvent.by === p.id) {
      pose = 'plant';
    } else if (currentEvent?.type === 'DEFUSE' && currentEvent.by === p.id) {
      pose = 'defuse';
    } else if (moving || (clampedStep > 0 && !done)) {
      pose = 'walk';
    }

    const bombCarrier = !plantedSite && isAtk && alive && (p.role === 'IGL' || p.role === 'SUPPORT' || slot === 2);

    return {
      id: p.id,
      name: p.name,
      side: p.side,
      role: p.role,
      x,
      y,
      alive,
      facing: p.side === 'BLUE' ? 'right' : 'left',
      pose,
      hasBomb: bombCarrier,
    };
  });

  const bombSite = plantedSite ?? round.site;
  const bombCoords = SITE_POS[bombSite];
  const bombState: FpsSceneState['bomb']['state'] = exploded
    ? 'EXPLODED'
    : defuserId
      ? 'DEFUSED'
      : plantedSite
        ? 'PLANTED'
        : 'CARRIED';

  return {
    roundNumber: round.n,
    attackers: round.attackers,
    targetSite: round.site,
    score: { ...score },
    done,
    winner: round.winner,
    reason: round.reason,
    bomb: {
      state: bombState,
      site: bombSite,
      x: bombCoords.x,
      y: bombCoords.y,
      byName: defuserId ? nameOf(defuserId) : planterId ? nameOf(planterId) : undefined,
    },
    fakeBanner,
    activeBanner,
    shot,
    units,
  };
}

// ---------------------------------------------------------------------------
// Card Division Pure Choreography

export interface CardSceneState {
  seatNumber: number; // 1-based
  gameNumber: number; // 1-based within seat
  seriesScore: Record<CardSide, number>;
  bluePlayer: { id: string; name: string; deck: CardDeck; deckName: string; life: number; maxLife: number };
  redPlayer: { id: string; name: string; deck: CardDeck; deckName: string; life: number; maxLife: number };
  displayBlueLife: number;
  displayRedLife: number;
  subProgress: number;
  activeSide: CardSide;
  turnNumber: number;
  damage: number;
  healed: number;
  notes: CardNote[];
  done: boolean;
  winner: CardSide;
  byTime: boolean;
  bannerText: string | null;
  bannerTone: 'normal' | 'combo' | 'read' | 'misplay' | 'lethal';
}

export function cardStartLife(g: CardGame, data: GameData): Record<CardSide, number> {
  const base = data.card.life;
  const extra = data.card.skill.secondPlayerLife;
  return {
    BLUE: base + (g.first === 'BLUE' ? 0 : extra),
    RED: base + (g.first === 'RED' ? 0 : extra),
  };
}

export function flattenCardGames(seriesList: CardSeries[]): { s: CardSeries; g: CardGame; i: number }[] {
  return seriesList.flatMap((s) => s.games.map((g, i) => ({ s, g, i })));
}

/** Pure calculation of the Card duel state at game index `gameFlatIndex`, turn step `step`, and intra-turn `subProgress` (0..1). */
export function computeCardSceneState(
  replay: BranchReplay,
  data: GameData,
  gameFlatIndex: number,
  step: number,
  subProgress = 1,
): CardSceneState {
  const card = replay.card!;
  const allGames = flattenCardGames(card.series);
  const clampedIdx = Math.max(0, Math.min(allGames.length - 1, gameFlatIndex));
  const { s, g, i } = allGames[clampedIdx]!;
  const clampedStep = Math.max(0, Math.min(g.turns.length, step));
  const sub = Math.max(0, Math.min(1, subProgress));
  const done = clampedStep >= g.turns.length;

  const initialLife = cardStartLife(g, data);
  const currentTurn = clampedStep > 0 ? g.turns[clampedStep - 1]! : null;
  const prevLife = clampedStep >= 2 ? g.turns[clampedStep - 2]!.life : initialLife;
  const life = currentTurn ? currentTurn.life : initialLife;
  const maxLife = data.card.life + data.card.skill.secondPlayerLife;

  const hpProg = sub >= 1 ? 1 : sub <= 0.22 ? 0 : Math.min(1, (sub - 0.22) / 0.58);
  const hpEase = 1 - (1 - hpProg) * (1 - hpProg);
  const displayBlueLife = prevLife.BLUE + (life.BLUE - prevLife.BLUE) * hpEase;
  const displayRedLife = prevLife.RED + (life.RED - prevLife.RED) * hpEase;

  // Match score across series up to this game
  const upToSeries = done && i === s.games.length - 1 ? s.seat + 1 : s.seat;
  const seriesScore: Record<CardSide, number> = { BLUE: 0, RED: 0 };
  for (const sr of card.series.slice(0, upToSeries)) {
    seriesScore[sr.winner]++;
  }

  const nameOf = (id: string) => replay.names[id] ?? id;
  const blueName = nameOf(s.blue);
  const redName = nameOf(s.red);

  const notes = currentTurn ? currentTurn.notes : [];
  let bannerText: string | null = null;
  let bannerTone: CardSceneState['bannerTone'] = 'normal';

  if (currentTurn) {
    const actor = currentTurn.side === 'BLUE' ? blueName : redName;
    if (notes.includes('LETHAL')) {
      bannerTone = 'lethal';
      bannerText = `⚔️ 致命斩杀！${actor} 打出 ${currentTurn.damage} 点终结伤害！`;
    } else if (notes.includes('COMBO')) {
      bannerTone = 'combo';
      bannerText = `✨ 组合技爆发！${actor} 连环出牌轰出 ${currentTurn.damage} 伤！`;
    } else if (notes.includes('COMBO_STOPPED')) {
      bannerTone = 'read';
      bannerText = `🚫 组合技被拦！对手精准破坏关键牌！`;
    } else if (notes.includes('READ')) {
      bannerTone = 'read';
      bannerText = `👁️ 读牌识破！对手预判防住攻势！`;
    } else if (notes.includes('MISPLAY')) {
      bannerTone = 'misplay';
      bannerText = `💦 ${actor} 算错费用出牌失误！`;
    } else if (notes.includes('STABILIZE')) {
      bannerTone = 'read';
      bannerText = `🛡️ ${actor} 稳住阵脚，回复 ${currentTurn.healed} 点生命！`;
    } else {
      bannerText = `回合 ${currentTurn.turn} · ${actor} 出牌${currentTurn.damage > 0 ? `造成 ${currentTurn.damage} 伤` : ''}${currentTurn.healed > 0 ? ` 回 ${currentTurn.healed} 血` : ''}`;
    }
  }

  return {
    seatNumber: s.seat + 1,
    gameNumber: i + 1,
    seriesScore,
    bluePlayer: {
      id: s.blue,
      name: blueName,
      deck: s.decks.BLUE,
      deckName: data.card.decks[s.decks.BLUE].name,
      life: life.BLUE,
      maxLife,
    },
    redPlayer: {
      id: s.red,
      name: redName,
      deck: s.decks.RED,
      deckName: data.card.decks[s.decks.RED].name,
      life: life.RED,
      maxLife,
    },
    displayBlueLife,
    displayRedLife,
    subProgress: sub,
    activeSide: currentTurn ? currentTurn.side : g.first,
    turnNumber: currentTurn ? currentTurn.turn : 0,
    damage: currentTurn ? currentTurn.damage : 0,
    healed: currentTurn ? currentTurn.healed : 0,
    notes,
    done,
    winner: g.winner,
    byTime: g.byTime,
    bannerText,
    bannerTone,
  };
}
