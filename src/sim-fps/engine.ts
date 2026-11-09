// Shooter division (P4, T36): the bomb-defusal match engine. Pure and deterministic: the same
// seed and input always give the same rounds. A round is played as a chain of duels around
// one bomb site; roles, tactics, money and nerves all shift the odds of each duel.

import { createRng, hashString, type Rng } from '../core/rng';
import {
  FPS_ATTRS, type FpsConfig, type FpsEvent, type FpsMatchInput, type FpsMatchResult, type FpsPlayerInput, type FpsPlayerStats, type FpsRound,
  type FpsRoundReason, type FpsSide, type FpsSite, type FpsTeamInput,
} from './types';
import { buildFpsReport } from './report';

const other = (s: FpsSide): FpsSide => (s === 'BLUE' ? 'RED' : 'BLUE');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** How well a player fits the role he is playing. */
export function fpsRoleFit(cfg: FpsConfig, p: FpsPlayerInput): number {
  return p.role === p.primaryRole ? 1 : p.role === p.secondaryRole ? cfg.power.secondaryRole : cfg.power.offRole;
}

/** A player's strength in his role, 0-100 before equipment. */
export function fpsRating(cfg: FpsConfig, p: FpsPlayerInput): number {
  const focus = cfg.power.roleFocus[p.role];
  let sum = 0, weight = 0;
  for (const a of FPS_ATTRS) {
    const w = cfg.power.weights[a] + (focus[a] ?? 0);
    sum += w * p.attrs[a];
    weight += w;
  }
  return (sum / weight) * fpsRoleFit(cfg, p) * (1 + (p.form ?? 0) * cfg.power.formPerPoint);
}

/** A player's plain ability, the same in every role (used by the management side). */
export function fpsOverall(cfg: FpsConfig, attrs: FpsPlayerInput['attrs']): number {
  let sum = 0, weight = 0;
  for (const a of FPS_ATTRS) { sum += cfg.power.weights[a] * attrs[a]; weight += cfg.power.weights[a]; }
  return sum / weight;
}

interface Unit {
  p: FpsPlayerInput;
  side: FpsSide;
  rating: number;
  alive: boolean;
  stats: FpsPlayerStats;
}

interface TeamState {
  side: FpsSide;
  input: FpsTeamInput;
  units: Unit[];
  bank: number;
  lossStreak: number;
  score: number;
  igl: number; // how much of the tactic the caller gets out of the team, around 1
}

function makeTeam(cfg: FpsConfig, side: FpsSide, input: FpsTeamInput): TeamState {
  const units = input.players.map((p): Unit => ({
    p, side, rating: fpsRating(cfg, p), alive: true,
    stats: { id: p.id, name: p.name, side, role: p.role, kills: 0, deaths: 0, trades: 0, openings: 0, plants: 0, defuses: 0, clutches: 0, rating: 0 },
  }));
  const caller = input.players.find((p) => p.role === 'IGL');
  const call = caller ? ((caller.attrs.teamwork + caller.attrs.mental) / 2) * fpsRoleFit(cfg, caller) : 0;
  return { side, input, units, bank: cfg.economy.start, lossStreak: 0, score: 0, igl: cfg.power.iglBase + cfg.power.iglPerPoint * call };
}

/** Plays one match. */
export function runFpsMatch(input: FpsMatchInput, cfg: FpsConfig): FpsMatchResult {
  const rng = createRng(input.seed);
  const teams: Record<FpsSide, TeamState> = { BLUE: makeTeam(cfg, 'BLUE', input.blue), RED: makeTeam(cfg, 'RED', input.red) };
  const rounds: FpsRound[] = [];
  const regulation = cfg.halfRounds * 2;
  while (teams.BLUE.score < cfg.roundsToWin && teams.RED.score < cfg.roundsToWin) {
    const n = rounds.length + 1;
    let attackers: FpsSide = n <= cfg.halfRounds ? 'BLUE' : 'RED';
    if (n === cfg.halfRounds + 1) for (const t of [teams.BLUE, teams.RED]) { t.bank = cfg.economy.start; t.lossStreak = 0; }
    if (n > regulation) { // a decider: full money, sides by the coin
      attackers = rng.chance(0.5) ? 'BLUE' : 'RED';
      for (const t of [teams.BLUE, teams.RED]) t.bank = cfg.economy.max;
    }
    rounds.push(playRound(cfg, rng, teams, n, attackers));
  }
  const winner: FpsSide = teams.BLUE.score > teams.RED.score ? 'BLUE' : 'RED';
  const stats = [...teams.BLUE.units, ...teams.RED.units].map((u) => {
    const s = u.stats;
    const impact = s.kills + 0.3 * s.trades + 0.4 * s.openings + 0.3 * s.plants + 0.5 * s.defuses + s.clutches - 0.6 * s.deaths;
    return { ...s, rating: Math.round(clamp(5 + 4 * (impact / rounds.length - 0.3), 0, 10) * 10) / 10 };
  });
  const score = { BLUE: teams.BLUE.score, RED: teams.RED.score };
  const checksum = hashString(JSON.stringify(rounds.map((r) => [r.winner, r.reason, r.site, r.events.length, r.events.map((e) => e.t)]))).toString(16).padStart(8, '0');
  return { winner, score, rounds, stats, report: buildFpsReport(cfg, input, { winner, score, rounds, stats }), checksum };
}

function buy(cfg: FpsConfig, t: TeamState): { id: string; power: number } {
  const options = cfg.economy.loadouts;
  let pick = options[0]!;
  for (const o of options) if (o.cost <= t.bank) pick = o;
  t.bank -= pick.cost;
  return pick;
}

function playRound(cfg: FpsConfig, rng: Rng, teams: Record<FpsSide, TeamState>, n: number, attackers: FpsSide): FpsRound {
  const P = cfg.power;
  const att = teams[attackers];
  const def = teams[other(attackers)];
  for (const u of [...att.units, ...def.units]) u.alive = true;
  const gear = { [att.side]: buy(cfg, att), [def.side]: buy(cfg, def) } as Record<FpsSide, { id: string; power: number }>;
  const events: FpsEvent[] = [];
  const aTactic = cfg.tactics[att.input.tactic];
  const dTactic = cfg.tactics[def.input.tactic];
  const edge = (me: TeamState, them: TeamState) => (cfg.tacticEdge[me.input.tactic]?.[them.input.tactic] ?? 0) * me.igl;
  const alive = (t: TeamState) => t.units.filter((u) => u.alive);
  const kills: Record<FpsSide, number> = { BLUE: 0, RED: 0 };
  let clutcher: Unit | null = null;
  let t = 0;

  /** Everything that tilts a duel for one side right now. */
  const bonus = (u: Unit, me: TeamState, them: TeamState): number => {
    let b = edge(me, them);
    b += P.numbersPerMan * (alive(me).length - alive(them).length);
    const behind = Math.max(0, them.score - me.score);
    b -= behind * P.behindMentalPer * (1 - u.p.attrs.mental / 100) * 2;
    if (alive(me).length === 1 && alive(them).length >= 2) {
      clutcher ??= u;
      b += P.clutchMentalPer * (u.p.attrs.mental - 50) + (u.p.role === 'LURK' ? P.lurkClutch : 0);
      b += P.numbersPerMan * (alive(them).length - 1) * 0.5; // the others come one at a time
    }
    return b;
  };
  /** One duel; returns the winner. `extraA` / `extraB` are situational bonuses. */
  const duel = (a: Unit, b: Unit, extraA: number, extraB: number, where: FpsSite | 'MID', tag: { trade?: boolean; opening?: boolean; flank?: boolean } = {}): Unit => {
    const ta = teams[a.side], tb = teams[b.side];
    const ra = a.rating * gear[a.side].power * (1 + bonus(a, ta, tb) + extraA);
    const rb = b.rating * gear[b.side].power * (1 + bonus(b, tb, ta) + extraB);
    const pA = 1 / (1 + Math.exp(-(ra - rb) / P.duelScale));
    const [win, lose] = rng.chance(pA) ? [a, b] : [b, a];
    t += rng.int(P.duelSecMin, P.duelSecMax);
    lose.alive = false;
    win.stats.kills++; lose.stats.deaths++;
    kills[win.side]++;
    if (tag.trade && win === a) win.stats.trades++;
    if (tag.opening) win.stats.openings++;
    events.push({ t, type: 'KILL', killer: win.p.id, victim: lose.p.id, side: win.side, where, ...(tag.trade && win === a ? { trade: true } : {}), ...(tag.opening ? { opening: true } : {}), ...(tag.flank && win === a ? { flank: true } : {}) });
    return win;
  };
  /** A team-mate of the fallen tries to trade the kill back. */
  const trade = (killer: Unit, fallenTeam: TeamState, tacticTrade: number, where: FpsSite | 'MID', pool: Unit[]): void => {
    const mates = pool.filter((u) => u.alive && u.side === fallenTeam.side);
    if (mates.length === 0 || !killer.alive) return;
    const trader = mates.find((u) => u.p.role === 'SUPPORT') ?? rng.pick(mates);
    const chance = P.tradeBase + P.tradePerTeamwork * (trader.p.attrs.teamwork - 50) + (trader.p.role === 'SUPPORT' ? P.supportTrade : 0) + tacticTrade;
    if (rng.chance(clamp(chance, 0.05, 0.9))) duel(trader, killer, P.tradeAdvantage, 0, where, { trade: true });
  };

  // Where the defenders stand: two on each site, one in the middle.
  const dOrder = [...def.units];
  if (rng.chance(0.5)) dOrder.reverse();
  const posts: Record<FpsSite | 'MID', Unit[]> = { A: dOrder.slice(0, P.siteDefenders), B: dOrder.slice(P.siteDefenders, P.siteDefenders * 2), MID: dOrder.slice(P.siteDefenders * 2) };
  let site: FpsSite = rng.chance(0.5) ? 'A' : 'B';
  const otherSite = (s: FpsSite): FpsSite => (s === 'A' ? 'B' : 'A');

  // A fake: show up at one site, hit the other. A good caller sells it; sharp defenders read it.
  if (att.input.tactic === 'FAKE') {
    const read = alive(def).reduce((a, u) => a + u.p.attrs.positioning, 0) / 5;
    const sell = att.igl * 50;
    const worked = rng.chance(clamp(P.fakeBase + P.fakePerPoint * (sell - read), 0.1, 0.85));
    const shown = site;
    site = otherSite(site);
    events.push({ t: Math.round(aTactic.executeSec * 0.6), type: 'FAKE', side: att.side, site: shown, worked });
    if (worked) { // defenders leave the real target
      const pulled = posts[site].splice(0, Math.min(P.fakePull - 1, posts[site].length));
      posts[shown].push(...pulled, ...posts.MID.splice(0));
    } else { // they smell it and stack the real target
      posts[site].push(...posts.MID.splice(0));
    }
  }

  // Before the hit: a fight for the middle (a rush skips it).
  t = Math.round(aTactic.executeSec * (0.4 + rng.next() * 0.2));
  if (att.input.tactic !== 'RUSH' && posts.MID.length > 0 && rng.chance(0.5)) {
    const a = alive(att).find((u) => u.p.role === 'LURK') ?? rng.pick(alive(att));
    const d = posts.MID[0]!;
    const w = duel(a, d, 0, P.defenderHold, 'MID');
    trade(w, w === a ? def : att, (w === a ? dTactic : aTactic).tradeBonus, 'MID', w === a ? posts.MID : alive(att));
  }

  // The hit on the site.
  t = Math.max(t, Math.round(aTactic.executeSec + rng.int(-4, 4)));
  const hitAt = t;
  let present = posts[site].filter((u) => u.alive);
  let midCame = false, farCame = false, flankUsed = false, opening = true;
  let planted = false;
  let reason: FpsRoundReason | null = null;
  let winner: FpsSide | null = null;
  const attackOrder = () => {
    const a = alive(att);
    const entry = a.find((u) => u.p.role === 'ENTRY');
    const rest = a.filter((u) => u !== entry && u.p.role !== 'LURK');
    const lurk = a.filter((u) => u.p.role === 'LURK');
    return [...(entry ? [entry] : []), ...rest, ...lurk];
  };
  while (!winner) {
    if (!midCame && t >= hitAt + P.rotateSec) { midCame = true; present.push(...posts.MID.filter((u) => u.alive)); }
    if (!farCame && t >= hitAt + P.rotateSec * 2) { farCame = true; present.push(...posts[otherSite(site)].filter((u) => u.alive)); }
    present = present.filter((u) => u.alive);
    if (alive(att).length === 0) { winner = def.side; reason = 'ELIMINATION'; break; }
    if (alive(def).length === 0) { winner = att.side; reason = 'ELIMINATION'; break; }
    if (t >= cfg.roundSec) { events.push({ t: Math.max(t, cfg.roundSec), type: 'TIMEOUT' }); winner = def.side; reason = 'TIMEOUT'; break; }
    if (present.length === 0) { // the site is clear: plant
      t += P.plantSec;
      const planter = alive(att).find((u) => u.p.role === 'SUPPORT') ?? alive(att)[0]!;
      planter.stats.plants++;
      events.push({ t, type: 'PLANT', by: planter.p.id, site });
      planted = true;
      break;
    }
    // The lurker catches a rotating defender from behind, once.
    const lurker = alive(att).find((u) => u.p.role === 'LURK');
    const rotating = alive(def).filter((u) => !present.includes(u));
    if (!flankUsed && !opening && lurker && rotating.length > 0 && rng.chance(P.lurkFlank)) {
      flankUsed = true;
      duel(lurker, rng.pick(rotating), P.tradeAdvantage, 0, 'MID', { flank: true });
      continue;
    }
    const a = attackOrder()[0]!;
    const awp = present.find((u) => u.p.role === 'AWP');
    const d = opening && awp ? awp : rng.pick(present);
    const w = duel(a, d, aTactic.entryBonus, P.defenderHold + (opening && d.p.role === 'AWP' ? P.awpOpening : 0), site, opening ? { opening: true } : {});
    opening = false;
    if (w === a) trade(w, def, dTactic.tradeBonus, site, present);
    else trade(w, att, aTactic.tradeBonus, site, alive(att));
  }

  // After the plant: the defenders must retake before the bomb goes off.
  if (planted) {
    const boom = t + cfg.bombSec;
    if (!farCame) t += Math.round(P.rotateSec * 0.6); // the far players are still on their way
    while (!winner) {
      if (alive(def).length === 0) { winner = att.side; reason = 'ELIMINATION'; break; }
      if (alive(att).length === 0) {
        if (t + P.defuseSec <= boom) {
          t += P.defuseSec;
          const hero = alive(def)[0]!;
          hero.stats.defuses++;
          events.push({ t, type: 'DEFUSE', by: hero.p.id });
          winner = def.side; reason = 'DEFUSE';
        } else { events.push({ t: Math.max(t, boom), type: 'EXPLODE' }); winner = att.side; reason = 'EXPLODE'; }
        break;
      }
      if (t >= boom) { events.push({ t: Math.max(t, boom), type: 'EXPLODE' }); winner = att.side; reason = 'EXPLODE'; break; }
      const d = rng.pick(alive(def));
      const a = rng.pick(alive(att));
      const w = duel(d, a, dTactic.retakeBonus, P.postPlantHold, site);
      if (w === d) trade(w, att, aTactic.tradeBonus, site, alive(att));
      else trade(w, def, dTactic.tradeBonus, site, alive(def));
    }
  }

  const won = teams[winner!];
  const lost = teams[other(winner!)];
  won.score++;
  const c = clutcher as Unit | null;
  const clutch = c && c.side === won.side && c.alive && alive(won).length === 1 ? c : null;
  if (clutch) clutch.stats.clutches++;
  // Money for the next round.
  const E = cfg.economy;
  won.bank += E.win; won.lossStreak = 0;
  lost.bank += Math.min(E.lossMax, E.lossBase + E.lossStep * lost.lossStreak); lost.lossStreak++;
  if (planted) att.bank += E.plantBonus;
  for (const tm of [att, def]) tm.bank = Math.min(E.max, tm.bank + E.killBonus * kills[tm.side]);
  return {
    n, attackers, site, buy: { BLUE: gear.BLUE.id, RED: gear.RED.id }, winner: winner!, reason: reason!,
    score: { BLUE: teams.BLUE.score, RED: teams.RED.score }, events, ...(clutch ? { clutch: clutch.p.id } : {}),
  };
}
