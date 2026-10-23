// Club facilities (P2, T22): five rooms, levels 1-3. Upgrading costs money once and a
// weekly upkeep after that; each level makes one part of running the club better.
// AI clubs upgrade too, within their budget, in the off-season.

import { FACILITY_IDS, type ClubId, type FacilityDef, type FacilityId, type FacilityLevel, type GameData } from '../core/types';
import { addLedger, clubById, weekOfSeason, type Result } from './game';
import { PLAYER_CLUB_ID, type ClubState, type GameState } from './state';

export const MAX_FACILITY_LEVEL = 3;

export function facilityDef(data: GameData, id: FacilityId): FacilityDef {
  return data.facilities.rooms.find((r) => r.id === id)!;
}

export function facilityLevel(club: ClubState, id: FacilityId): number {
  return club.facilities?.[id] ?? 1;
}

/** The room's settings at the club's current level. */
export function facilityStep(data: GameData, club: ClubState, id: FacilityId): FacilityLevel {
  const levels = facilityDef(data, id).levels;
  return levels[Math.min(levels.length, facilityLevel(club, id)) - 1]!;
}

/** The room's effect for a club (0 at level 1). */
export function facilityValue(state: GameState, data: GameData, clubId: ClubId, id: FacilityId): number {
  return facilityStep(data, clubById(state, clubId), id).value;
}

/** What all rooms cost to keep running each week. */
export function facilityUpkeep(data: GameData, club: ClubState): number {
  return FACILITY_IDS.reduce((a, id) => a + facilityStep(data, club, id).upkeep, 0);
}

/** The next level of a room, or null when it is at the top. */
export function nextFacilityLevel(data: GameData, club: ClubState, id: FacilityId): FacilityLevel | null {
  return facilityDef(data, id).levels[facilityLevel(club, id)] ?? null;
}

/** Reputation the sponsor tiers count for a club: its own, plus what its office is worth. */
export function sponsorStanding(state: GameState, data: GameData, clubId: ClubId = PLAYER_CLUB_ID): number {
  const club = clubById(state, clubId);
  return club.reputation + (facilityStep(data, club, 'OFFICE').sponsorReputation ?? 0);
}

/** Upgrades one room by a level, paying for it. */
export function upgradeFacility(state: GameState, data: GameData, id: FacilityId, clubId: ClubId = PLAYER_CLUB_ID): Result<number> {
  const club = clubById(state, clubId);
  const next = nextFacilityLevel(data, club, id);
  const name = facilityDef(data, id).name;
  if (!next) return { ok: false, error: `${name}已经是最高级了` };
  const funds = clubId === PLAYER_CLUB_ID ? state.funds : club.funds;
  if (funds < next.cost) return { ok: false, error: `钱不够：升级${name}要 ${next.cost}，现在只有 ${Math.floor(funds)}` };
  const level = facilityLevel(club, id) + 1;
  if (clubId === PLAYER_CLUB_ID) addLedger(state, { week: weekOfSeason(state), kind: 'FACILITY', amount: -next.cost, note: `${name}升到 ${level} 级` });
  else club.funds -= next.cost;
  club.facilities = { ...club.facilities, [id]: level };
  return { ok: true, value: level };
}

/**
 * Off-season upgrades for AI clubs: each club spends up to a share of the money it can spare
 * (beyond a reserve of a few weeks of wages) on the rooms its management style cares about most.
 */
export function aiUpgradeFacilities(state: GameState, data: GameData, reserveWeeks: (club: ClubState) => number): void {
  for (const club of state.aiClubs) {
    if (club.management === 'PLAYER') continue;
    const wages = club.roster.reduce((a, id) => a + (state.players[id]?.salaryPerWeek ?? 0), 0) + facilityUpkeep(data, club);
    let budget = Math.max(0, club.funds - wages * reserveWeeks(club)) * data.facilities.aiSpareShare;
    const order = data.facilities.aiPriority[club.management] ?? [...FACILITY_IDS];
    for (const id of order) {
      const next = nextFacilityLevel(data, club, id);
      if (!next || next.cost > budget) continue;
      if (upgradeFacility(state, data, id, club.id).ok) budget -= next.cost;
    }
  }
}
