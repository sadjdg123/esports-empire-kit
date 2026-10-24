// Which furniture in the club base shows a bouncing marker (needs the player's attention).
// Pure: reads the game state only (no DOM), so it is tested in Node.

import type { GameData } from '../../core/types';
import { FACILITY_IDS } from '../../core/types';
import {
  PLAYER_CLUB_ID, activeSponsor, expiringPlayers, financeSummary, negotiationFor, nextFacilityLevel, readinessIssues, rosterOf, type GameState,
} from '../../game';
import { TIRED_AT } from './activities';

/** Furniture the player can tap; each opens one window. */
export type Hotspot = 'lineup' | 'training' | 'schedule' | 'contracts' | 'finance' | 'history' | 'report' | 'inbox' | 'market' | 'facilities' | 'staff';
export type Marker = 'bang' | 'sweat' | 'note';

/** Unread mail, a short roster, a lineup that isn't ready, offers, expiring contracts, money trouble, tired players. */
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
  return m;
}
