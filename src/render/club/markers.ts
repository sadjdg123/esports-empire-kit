// Which furniture in the club base shows a bouncing marker (needs the player's attention).
// Pure: reads the game state only (no DOM), so it is tested in Node.

import type { GameData } from '../../core/types';
import { FACILITY_IDS } from '../../core/types';
import {
  PLAYER_CLUB_ID, activeSponsor, expiringPlayers, financeSummary, negotiationFor, nextFacilityLevel, openBranches, readinessIssues, rosterOf, type GameState,
} from '../../game';
import { TIRED_AT } from './activities';

/** Furniture the player can tap; each opens one window. */
export type Hotspot = 'lineup' | 'training' | 'schedule' | 'contracts' | 'finance' | 'history' | 'report' | 'inbox' | 'market' | 'facilities' | 'staff' | 'group';
export type Marker = 'bang' | 'sweat' | 'note';

/** Unread mail, a short roster, a lineup that isn't ready, offers, expiring contracts, money trouble, tired players, under-staffed branches. */
export function markersFor(g: GameState, data: GameData): Partial<Record<Hotspot, Marker>> {
  const m: Partial<Record<Hotspot, Marker>> = {};
  const over = g.calendar.phase === 'FINISHED';
  if (g.inbox.some((x) => !x.read)) m.inbox = 'bang';
  if (g.club.roster.length < data.economy.minRoster) m.market = 'bang';
  else if (!over && readinessIssues(g, data).length > 0) m.lineup = 'bang';
  const offers = g.offers.some((o) => o.seller === PLAYER_CLUB_ID && o.status === 'PENDING');
  const expiring = !over && expiringPlayers(g).some((p) => (negotiationFor(g, p.id)?.status ?? 'OPEN') === 'OPEN');
  if (offers || expiring) m.contracts = 'bang';
  if (!over && (!activeSponsor(g) || financeSummary(g, data).lowFunds)) m.finance = 'bang';
  // In the pre-season, with a full squad: a room upgrade the club can afford while keeping
  // twelve weeks of wages in hand puts a note on the toolbox.
  const wages = rosterOf(g).reduce((a, p) => a + p.salaryPerWeek, 0);
  const affordable = FACILITY_IDS.some((id) => { const n = nextFacilityLevel(data, g.club, id); return !!n && n.cost <= g.funds - wages * 12; });
  if (g.calendar.phase === 'PRESEASON' && g.club.roster.length >= data.economy.minRoster && affordable) m.facilities = 'note';
  // On AUTO the squad rests by itself, so tiredness needs no reminder.
  if (g.training !== 'REST' && g.training !== 'AUTO' && rosterOf(g).some((p) => (p.fatigue ?? 0) >= TIRED_AT)) m.training = 'sweat';
  // An open branch that still lacks its minimum squad gets a reminder on the roof sign.
  if (!over && openBranches(g).some((b) => b.roster.length < data.branches.kinds[b.kind].squad)) m.group = 'bang';
  return m;
}

export const SCENE_W = 300;
export const SCENE_H = 200;
export const STUDIO_TW = 20;
export const STUDIO_TH = 10;
export const STUDIO_OX = 114;
export const STUDIO_OY = 66;
export const STUDIO_L = 15;
export const STUDIO_D = 6.0;
export const STUDIO_R1 = 4.6;
export const STUDIO_R2 = 10.2;
export const STUDIO_CJ = 5.25;

export const HOTSPOT_LABELS: Record<Hotspot, string> = {
  lineup: '阵容白板',
  training: '训练电脑',
  schedule: '赛程电视',
  contracts: '经理谈判桌',
  finance: '财务金库',
  history: '荣誉奖杯柜',
  report: '战报书架',
  inbox: '收件邮筒',
  market: '招募告示牌',
  facilities: '设施工具箱',
  staff: '管理层办公桌',
  group: '集团分部牌匾',
};

/** Isometric tile (i, j) to scene pixel (x, y) on the single-floor studio canvas. */
export function clubIso(i: number, j: number): [number, number] {
  return [STUDIO_OX + (i - j) * (STUDIO_TW / 2), STUDIO_OY + (i + j) * (STUDIO_TH / 2)];
}

/** Pure corridor pathfinding between two points in the single-floor 3-room studio. */
export function corridorRoute(
  from: { i: number; j: number },
  to: { i: number; j: number },
): { i: number; j: number }[] {
  if (Math.abs(from.i - to.i) < 0.05 && Math.abs(from.j - to.j) < 0.05) return [];
  const sameRoom =
    (from.i < STUDIO_R1 && to.i < STUDIO_R1) ||
    (from.i >= STUDIO_R1 && from.i < STUDIO_R2 && to.i >= STUDIO_R1 && to.i < STUDIO_R2) ||
    (from.i >= STUDIO_R2 && to.i >= STUDIO_R2);
  if (sameRoom && from.j < STUDIO_D && to.j < STUDIO_D && Math.abs(from.i - to.i) < 1.2) {
    return [{ i: to.i, j: to.j }];
  }
  return [
    { i: from.i, j: STUDIO_CJ },
    { i: to.i, j: STUDIO_CJ },
    { i: to.i, j: to.j },
  ];
}

