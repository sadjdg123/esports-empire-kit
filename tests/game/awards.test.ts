import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import type { CareerSeason, Player, SponsorGoal } from '../../src/core/types';
import {
  advanceDay, commitMatchDay, hallOfFameEntry, newGame, paySponsorGoals, remember, retirePlayers, signSponsor, signValueSquad,
  sponsorGoalMet, type GameState,
} from '../../src/game';

const data = loadGameData();
const hof = data.season.awards.hallOfFame;

function club(seed = 3): GameState {
  const s = newGame('名人堂', '#3a7bd5', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  return s;
}
function playSeason(s: GameState): void {
  for (let g = 0; g < 400 && s.calendar.phase !== 'FINISHED'; g++) {
    if (advanceDay(s, data).pause === 'MATCH_DAY') { const c = commitMatchDay(s, data); if (!c.ok) throw new Error(c.error); }
  }
}
const season = (n: number, over: Partial<CareerSeason> = {}): CareerSeason => ({ season: n, clubId: 'c', clubName: '测试队', played: 10, wins: 5, champion: false, ovr: 70, ...over });
const veteran = (s: GameState, career: CareerSeason[]): Player => ({ ...structuredClone(s.players[s.club.roster[0]!]!), career });

describe('sponsor goals (T27)', () => {
  const r = (rank: number, wins: number, playoff: 'CHAMPION' | 'FINAL' | 'SEMI' | 'NONE' = 'NONE') => ({ rank, wins, playoff });
  it('each kind of goal is judged on the season result', () => {
    const g = (kind: SponsorGoal['kind'], value?: number): SponsorGoal => ({ kind, bonus: 1, ...(value ? { value } : {}) });
    expect(sponsorGoalMet(data, g('PLAYOFFS'), r(data.season.playoffTeams, 0))).toBe(true);
    expect(sponsorGoalMet(data, g('PLAYOFFS'), r(data.season.playoffTeams + 1, 0))).toBe(false);
    expect(sponsorGoalMet(data, g('TOP2'), r(2, 0))).toBe(true);
    expect(sponsorGoalMet(data, g('TOP2'), r(3, 0))).toBe(false);
    expect(sponsorGoalMet(data, g('FINAL'), r(4, 0, 'FINAL'))).toBe(true);
    expect(sponsorGoalMet(data, g('FINAL'), r(1, 0, 'CHAMPION'))).toBe(true);
    expect(sponsorGoalMet(data, g('FINAL'), r(1, 0, 'SEMI'))).toBe(false);
    expect(sponsorGoalMet(data, g('CHAMPION'), r(1, 0, 'FINAL'))).toBe(false);
    expect(sponsorGoalMet(data, g('WINS', 6), r(5, 6))).toBe(true);
    expect(sponsorGoalMet(data, g('WINS', 6), r(5, 5))).toBe(false);
  });

  it('the goals come with the contract and their bonus goes into the books', () => {
    const s = club();
    const def = data.economy.finance.sponsorTiers[0]!.sponsors.find((x) => x.goals?.length)!;
    s.sponsor = null; // the squad helper may already have signed one
    expect(signSponsor(s, data, def.id, 1).ok).toBe(true);
    expect(s.sponsor!.goals).toEqual(def.goals);
    const before = s.funds;
    const paid = paySponsorGoals(s, data, r(1, 10, 'CHAMPION'));
    const expected = def.goals!.reduce((a, g) => a + g.bonus, 0);
    expect(paid).toBe(expected);
    expect(s.funds).toBe(before + expected);
    expect(s.ledger.filter((e) => e.kind === 'SPONSOR' && e.note.includes('目标奖金'))).toHaveLength(def.goals!.length);
    expect(paySponsorGoals(s, data, r(6, 0))).toBe(0);
  });

  it('is settled by itself at the end of a season', () => {
    const s = club(5);
    s.sponsor = { sponsorId: 'x', name: '测试赞助', weekly: 0, winBonus: 0, untilSeason: 1, goals: [{ kind: 'WINS', value: 1, bonus: 12345 }, { kind: 'CHAMPION', bonus: 1 }] };
    playSeason(s);
    const h = s.history.at(-1)!;
    const wins = h.table.find((x) => x.clubId === s.club.id)!.wins;
    const got = s.ledger.filter((e) => e.note.includes('目标奖金')).reduce((a, e) => a + e.amount, 0);
    expect(got).toBe((wins >= 1 ? 12345 : 0) + (h.champion === s.club.id ? 1 : 0));
    expect(h.fundsEnd).toBe(s.funds); // the bonus is in the season's closing funds
  }, 120_000);
});

describe('season MVP (T27)', () => {
  it('one MVP per season, someone who played enough of it', () => {
    const s = club(6);
    playSeason(s);
    expect(s.awards).toHaveLength(1);
    const a = s.awards[0]!;
    expect(a.season).toBe(1);
    const p = s.players[a.mvpId]!;
    expect(p.career!.at(-1)!.played).toBeGreaterThanOrEqual(data.season.awards.mvpMinPlayed);
    expect(s.inbox.some((m) => m.title.includes('MVP'))).toBe(true);
  }, 120_000);
});

describe('hall of fame (T27)', () => {
  it('many titles, an MVP, or many seasons as a regular: in; a short ordinary career: out', () => {
    const s = club();
    expect(hallOfFameEntry(s, data, veteran(s, [season(1), season(2)]))).toBeNull();
    const titles = Array.from({ length: hof.titles }, (_, i) => season(i + 1, { champion: true }));
    expect(hallOfFameEntry(s, data, veteran(s, titles))?.titles).toBe(hof.titles);
    expect(hallOfFameEntry(s, data, veteran(s, titles.slice(1)))).toBeNull();
    const regulars = Array.from({ length: hof.regularSeasons }, (_, i) => season(i + 1));
    expect(hallOfFameEntry(s, data, veteran(s, regulars))).not.toBeNull();
    expect(hallOfFameEntry(s, data, veteran(s, regulars.slice(1)))).toBeNull();
    const bench = regulars.map((c) => ({ ...c, played: hof.regularMinPlayed - 1 }));
    expect(hallOfFameEntry(s, data, veteran(s, bench))).toBeNull();
    const benchTitles = titles.map((c) => ({ ...c, played: hof.regularMinPlayed - 1 })); // on the bench of the champion
    expect(hallOfFameEntry(s, data, veteran(s, benchTitles))).toBeNull();
    const mvp = veteran(s, [season(1)]);
    s.awards.push({ season: 1, mvpId: mvp.id, mvpName: mvp.name, clubId: 'c', clubName: '测试队' });
    expect(hallOfFameEntry(s, data, mvp)?.mvps).toBe(1);
  });

  it('records the main club and peak, once, when a great player retires', () => {
    const s = club();
    const id = s.club.roster[0]!;
    const p = s.players[id]!;
    p.career = [season(1, { clubName: '甲', champion: true, ovr: 88 }), season(2, { clubName: '乙', champion: true }), season(3, { clubName: '乙', champion: true }), season(4, { clubName: '乙' })];
    p.retiring = true;
    retirePlayers(s, data);
    const e = s.hallOfFame.find((h) => h.playerId === id)!;
    expect(e).toMatchObject({ titles: 3, mainClub: '乙', seasons: 4 });
    expect(e.peakOvr).toBeGreaterThanOrEqual(88);
    expect(s.inbox.some((m) => m.title.includes('名人堂'))).toBe(true);
    remember(s, data, p);
    expect(s.hallOfFame.filter((h) => h.playerId === id)).toHaveLength(1);
  });
});
