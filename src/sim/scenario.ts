// Builders for match inputs: real club lineups and synthetic teams used by
// tests and the balance tool.

import type { Rng } from '../core/rng';
import { ROLES, type GameData, type HeroId, type MatchInput, type Player, type Role, type Tactic, type TeamLineup } from '../core/types';
import { masteryOf } from './units';

export interface TeamInput {
  lineup: TeamLineup;
  players: Player[];
}

export function heroesForRole(data: GameData, role: Role): HeroId[] {
  return data.heroes.filter((h) => h.preferredRoles.includes(role)).map((h) => h.id);
}

function overall(p: Player): number {
  return (p.attrs.mechanics + p.attrs.awareness + p.attrs.teamwork + p.attrs.mental) / 4;
}

/** Best player per role (primary role first, then secondary, then anyone) and their best hero. */
export function autoLineup(data: GameData, clubId: string, roster: readonly Player[], tactic: Tactic): TeamLineup {
  const used = new Set<string>();
  const usedHero = new Set<string>();
  const picks = ROLES.map((role) => {
    const score = (p: Player) => overall(p) * (p.primaryRole === role ? 1 : p.secondaryRole === role ? 0.93 : 0.82);
    const candidates = roster.filter((p) => !used.has(p.id)).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    const player = candidates[0];
    if (!player) throw new Error(`autoLineup: not enough players for ${clubId}`);
    used.add(player.id);
    const heroes = data.heroes.map((h) => h.id).filter((id) => !usedHero.has(id));
    const heroId = heroes.sort((a, b) => masteryOf(player, b) - masteryOf(player, a) || a.localeCompare(b))[0]!;
    usedHero.add(heroId);
    return { role, playerId: player.id, heroId };
  });
  return { clubId, picks, tactic };
}

export function clubTeam(data: GameData, clubId: string, tactic: Tactic): TeamInput {
  const club = data.clubs.find((c) => c.id === clubId);
  if (!club) throw new Error(`clubTeam: unknown club ${clubId}`);
  return { lineup: autoLineup(data, clubId, club.players, tactic), players: club.players };
}

export interface SyntheticOptions {
  idPrefix: string;
  tactic: Tactic;
  ability: number; // mean of all four attributes
  spread?: number; // per-attribute random spread (uniform +-)
  mastery?: number; // mastery on the picked hero
  heroes?: Partial<Record<Role, HeroId>>; // fixed heroes, otherwise random from the role pool
  /** Assign players to roles they are not trained for. */
  offrole?: boolean;
  form?: number;
}

/** Five generated players with controlled ability, plus a lineup. */
export function syntheticTeam(data: GameData, rng: Rng, opts: SyntheticOptions): TeamInput {
  const spread = opts.spread ?? 6;
  const mastery = opts.mastery ?? 70;
  const players: Player[] = [];
  const picks = ROLES.map((role, i) => {
    const heroId = opts.heroes?.[role] ?? rng.pick(heroesForRole(data, role));
    const attr = () => Math.max(1, Math.min(100, Math.round(opts.ability + (rng.next() * 2 - 1) * spread)));
    // Off-role players are trained for the role two steps away in the list.
    const trained = opts.offrole ? ROLES[(i + 2) % ROLES.length]! : role;
    const player: Player = {
      id: `${opts.idPrefix}${i + 1}`,
      name: `${opts.idPrefix}${i + 1}`,
      age: 20,
      primaryRole: trained,
      secondaryRole: opts.offrole ? ROLES[(i + 3) % ROLES.length]! : undefined,
      attrs: { mechanics: attr(), awareness: attr(), teamwork: attr(), mental: attr() },
      heroMastery: { [heroId]: mastery },
      form: opts.form ?? 0,
      salaryPerWeek: 1000,
      signingFee: 4000,
      clubId: null,
    };
    if (player.secondaryRole === undefined) delete player.secondaryRole;
    players.push(player);
    return { role, playerId: player.id, heroId };
  });
  return { lineup: { clubId: opts.idPrefix, picks, tactic: opts.tactic }, players };
}

/** Same players and heroes with new ids (for mirror matches). */
export function cloneTeam(team: TeamInput, idPrefix: string, tactic?: Tactic): TeamInput {
  const map = new Map<string, string>();
  const players = team.players.map((p, i) => {
    const id = `${idPrefix}${i + 1}`;
    map.set(p.id, id);
    return { ...structuredClone(p), id, name: id };
  });
  return {
    players,
    lineup: {
      clubId: idPrefix,
      tactic: tactic ?? team.lineup.tactic,
      picks: team.lineup.picks.map((pk) => ({ ...pk, playerId: map.get(pk.playerId)! })),
    },
  };
}

export function matchInput(seed: number, blue: TeamInput, red: TeamInput): MatchInput {
  return { seed, blue, red };
}
