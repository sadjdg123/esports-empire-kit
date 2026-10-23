import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import {
  PLAYER_CLUB_ID, acceptRenewal, advanceDay, aiRosterTarget, aiSignFreeAgents, autoManage, emergencySalaryCap, askingPrice, bidForPlayer, commitMatchDay, counterRenewal, declineRenewal,
  expiringPlayers, fairSalary, generateAiOffers, marketValue, newGame, openNegotiation, playerOverall, releaseFeeFor,
  releasePlayer, respondToOffer, signPlayer, signValueSquad, type GameState,
} from '../../src/game';

const data = loadGameData();

function ready(seed = 1): GameState {
  const s = newGame('合同测试', '#3a7bd5', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  return s;
}

/** Plays day by day until the given phase (and season) is reached. */
function playUntil(s: GameState, phase: string, season = s.calendar.season): void {
  for (let guard = 0; guard < 2000; guard++) {
    if (s.calendar.phase === phase && s.calendar.season === season) return;
    if (advanceDay(s, data).pause === 'MATCH_DAY') {
      const c = commitMatchDay(s, data);
      if (!c.ok) throw new Error(c.error);
    }
  }
  throw new Error(`never reached ${phase} of season ${season}`);
}

const totalMoney = (s: GameState) => s.funds + s.aiClubs.reduce((a, c) => a + c.funds, 0);

describe('salary and value', () => {
  it('the fair-salary formula is close to the salaries in the data', () => {
    const all = [...data.players, ...data.clubs.flatMap((c) => c.players)];
    const close = all.filter((p) => Math.abs(fairSalary(data, p) / p.salaryPerWeek - 1) <= 0.35);
    expect(close.length / all.length).toBeGreaterThanOrEqual(0.8);
  });

  it('young high-potential players are worth more than veterans of the same ability', () => {
    const base = structuredClone(data.players[0]!);
    const young = { ...structuredClone(base), age: 18, potential: playerOverall(base) + 20, form: 0 };
    const old = { ...structuredClone(base), age: 31, potential: playerOverall(base), form: 0 };
    expect(marketValue(data, young)).toBeGreaterThan(marketValue(data, old) * 1.5);
  });
});

describe('contracts', () => {
  it('signing sets the contract length; the release fee follows what is left of it', () => {
    const s = newGame('t', '#fff', 2, data);
    const [a, b] = s.market;
    expect(signPlayer(s, data, a!, 0).ok).toBe(false);
    expect(signPlayer(s, data, a!, 1).ok).toBe(true);
    expect(signPlayer(s, data, b!, 3).ok).toBe(true);
    expect(s.players[a!]!.contractUntil).toBe(1);
    expect(s.players[b!]!.contractUntil).toBe(3);
    const short = { ...s.players[a!]!, salaryPerWeek: 1000 };
    const long = { ...s.players[b!]!, salaryPerWeek: 1000 };
    expect(releaseFeeFor(s, data, long)).toBeGreaterThan(releaseFeeFor(s, data, short) * 2);
    const before = s.funds;
    const fee = releaseFeeFor(s, data, s.players[b!]!);
    expect(releasePlayer(s, data, b!).ok).toBe(true);
    expect(s.funds).toBe(before - fee);
    expect(s.players[b!]!.contractUntil).toBeUndefined();
  });

  it('renewal: only in the last season, one counter offer, accept or refuse', () => {
    const s = ready(3);
    const [p1, p2, p3, p4] = s.club.roster.map((id) => s.players[id]!);
    for (const p of [p1!, p2!, p3!]) p.contractUntil = 1;
    p4!.contractUntil = 2;
    expect(openNegotiation(s, data, p4!.id).ok).toBe(false);

    const n1 = openNegotiation(s, data, p1!.id);
    expect(n1.ok).toBe(true);
    const ask = n1.ok ? n1.value.ask : 0;
    expect(acceptRenewal(s, data, p1!.id, 2).ok).toBe(true);
    expect(p1!.contractUntil).toBe(3);
    expect(p1!.salaryPerWeek).toBe(ask);

    const low = counterRenewal(s, data, p2!.id, 100, 2);
    expect(low.ok && low.value.accepted).toBe(false);
    expect(counterRenewal(s, data, p2!.id, 999999, 2).ok).toBe(false); // only one counter
    expect(declineRenewal(s, data, p2!.id).ok).toBe(true);

    const n3 = openNegotiation(s, data, p3!.id);
    const fair = counterRenewal(s, data, p3!.id, n3.ok ? n3.value.ask : 0, 1);
    expect(fair.ok && fair.value.accepted).toBe(true);
    expect(p3!.contractUntil).toBe(2);
  });

  it('expired contracts leave at the new season; AI clubs keep at least 5 players for 3 seasons', () => {
    const s = ready(4);
    const leaving = s.players[s.club.roster[0]!]!;
    leaving.contractUntil = 1;
    const staying = s.players[s.club.roster[1]!]!;
    staying.contractUntil = 1;
    expect(acceptRenewal(s, data, staying.id, 1).ok).toBe(true);
    playUntil(s, 'PRESEASON', 2);
    expect(s.club.roster).not.toContain(leaving.id);
    expect(s.market).toContain(leaving.id);
    expect(s.players[leaving.id]!.clubId).toBeNull();
    expect(s.club.roster).toContain(staying.id);
    expect(s.lineup).toBeNull(); // the leaving starter was in it
    s.funds = Math.max(s.funds, 200000);
    expect(autoManage(s, data).ok).toBe(true);
    expect(s.inbox.some((m) => m.kind === 'CONTRACT' && m.title.includes(leaving.name))).toBe(true);
    for (let season = 2; season <= 3; season++) {
      for (const c of s.aiClubs) expect(c.roster.length).toBeGreaterThanOrEqual(data.economy.minRoster);
      for (const id of s.club.roster) expect(s.players[id]!.contractUntil).toBeDefined();
      s.funds = Math.max(s.funds, 200000); // finances are T16; keep the club playable
      const auto = autoManage(s, data);
      if (!auto.ok) throw new Error(auto.error);
      playUntil(s, 'PRESEASON', season + 1);
    }
    for (const c of s.aiClubs) {
      expect(c.roster.length).toBeGreaterThanOrEqual(data.economy.minRoster);
      // AI clubs pay wages (T16) and may sign cheap players on credit to field a team (T17), like the player.
      expect(c.funds).toBeGreaterThan(-data.clubs.find((d) => d.id === c.id)!.funds);
    }
    expect(expiringPlayers(s).every((p) => p.contractUntil === s.calendar.season)).toBe(true);
  }, 120_000);

  it('AI clubs never sign players they cannot pay for, except cheap ones to field a team (the player\'s rule)', () => {
    const s = newGame('t', '#fff', 8, data);
    const club = s.aiClubs[0]!;
    const out = club.roster.splice(0, club.roster.length - 3);
    for (const id of out) { s.players[id]!.clubId = null; s.market.push(id); }
    club.funds = 0;
    const cap = emergencySalaryCap(s, data);
    aiSignFreeAgents(s, data);
    expect(club.roster.length).toBe(data.economy.minRoster); // only up to a playable team
    for (const id of club.roster.slice(3)) expect(s.players[id]!.salaryPerWeek).toBeLessThanOrEqual(cap);
    club.funds = 1_000_000;
    aiSignFreeAgents(s, data);
    expect(club.roster.length).toBe(aiRosterTarget(s, data, club));
    expect(club.roster.length).toBeGreaterThanOrEqual(data.ai.styles[club.management as 'STEADY'].rosterTarget);
    expect(club.funds).toBeGreaterThan(0);
  });
});

describe('transfers', () => {
  it('buying: low bids are refused, fair bids accepted, money is conserved, only in the window', () => {
    const s = ready(5);
    const seller = s.aiClubs.find((c) => c.roster.length > data.economy.minRoster) ?? s.aiClubs[0]!;
    if (seller.roster.length <= data.economy.minRoster) seller.roster.push(s.market.pop()!);
    const target = seller.roster.map((id) => s.players[id]!).sort((a, b) => playerOverall(a) - playerOverall(b))[0]!;
    target.clubId = seller.id;
    s.funds = 10_000_000;
    const money = totalMoney(s);
    const price = askingPrice(s, data, target.id);
    const low = bidForPlayer(s, data, target.id, Math.floor(price * 0.5));
    expect(low.ok && low.value.accepted).toBe(false);
    const fair = bidForPlayer(s, data, target.id, price);
    expect(fair.ok && fair.value.accepted).toBe(true);
    expect(s.club.roster).toContain(target.id);
    expect(s.players[target.id]!.clubId).toBe(PLAYER_CLUB_ID);
    expect(totalMoney(s)).toBe(money);
    playUntil(s, 'REGULAR');
    const other = s.aiClubs[0]!.roster[0]!;
    expect(bidForPlayer(s, data, other, 9_000_000).ok).toBe(false);
  });

  it('AI clubs bid for strong players they can afford; accepting moves the player and the money', () => {
    const s = ready(6);
    const star = s.players[s.club.roster[0]!]!;
    star.attrs = { mechanics: 95, awareness: 95, teamwork: 95, mental: 95 };
    for (const c of s.aiClubs) c.funds = 0;
    for (let i = 0; i < 20; i++) expect(generateAiOffers(s, data)).toEqual([]); // nobody can pay
    for (const c of s.aiClubs) c.funds = 5_000_000;
    let offers: ReturnType<typeof generateAiOffers> = [];
    for (let i = 0; i < 20 && offers.length === 0; i++) offers = generateAiOffers(s, data);
    expect(offers.length).toBeGreaterThan(0);
    const o = offers[0]!;
    expect(o.playerId).toBe(star.id);
    expect(s.inbox.some((m) => m.kind === 'OFFER' && m.data?.offerId === o.id)).toBe(true);
    const money = totalMoney(s);
    expect(respondToOffer(s, data, o.id, true).ok).toBe(true);
    expect(s.players[star.id]!.clubId).toBe(o.buyer);
    expect(totalMoney(s)).toBe(money);
    expect(respondToOffer(s, data, o.id, true).ok).toBe(false);
  });

  it('is deterministic: the same seed gives the same offers and contracts', () => {
    const run = () => { const s = ready(7); playUntil(s, 'PRESEASON', 2); return JSON.stringify([s.offers, s.market, s.aiClubs, s.players]); };
    expect(run()).toBe(run());
  }, 120_000);
});
