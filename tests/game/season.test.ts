import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import {
  PLAYER_CLUB_ID, advanceDay, advanceToNextMatch, autoManage, advanceUntilPause, commitMatchDay, describeDate, newGame, playerMatchToday,
  seasonLayout, signValueSquad, standings, type GameState,
} from '../../src/game';
import { deserialize, serialize } from '../../src/save';

const data = loadGameData();

function ready(seed: number): GameState {
  const s = newGame('赛季测试', '#3a7bd5', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  return s;
}

/** Plays until the season is over, committing every player match. Returns the phases seen in order. */
function playSeason(s: GameState, until: string = 'FINISHED'): string[] {
  const phases: string[] = [s.calendar.phase];
  const note = () => { if (phases[phases.length - 1] !== s.calendar.phase) phases.push(s.calendar.phase); };
  for (let guard = 0; guard < 500; guard++) {
    if (s.calendar.phase === until) return phases;
    const r = advanceDay(s, data);
    note();
    if (r.pause === 'MATCH_DAY') {
      const c = commitMatchDay(s, data);
      if (!c.ok) throw new Error(c.error);
      note();
    }
  }
  throw new Error('season did not finish');
}

describe('calendar', () => {
  it('starts in the pre-season and pays salaries once a week', () => {
    const s = ready(1);
    expect(s.calendar).toEqual({ season: 1, phase: 'PRESEASON', day: 0 });
    for (let i = 0; i < 13; i++) expect(advanceDay(s, data).pause === 'MATCH_DAY').toBe(false);
    expect(s.calendar.day).toBe(13);
    expect(s.calendar.phase).toBe('PRESEASON');
    expect(s.ledger.filter((e) => e.kind === 'SALARY')).toHaveLength(1); // day 7
    advanceDay(s, data);
    expect(s.calendar.phase).toBe('REGULAR');
    expect(describeDate(s, data)).toBe('第 1 赛季 · 常规赛 · 第 3 周 周一');
  });

  it('stops on match day and does not move until the match is played', () => {
    const s = ready(2);
    const r = advanceToNextMatch(s, data);
    expect(r.pause).toBe('MATCH_DAY');
    expect(s.calendar.day).toBe(seasonLayout(s, data).roundDay(0));
    const day = s.calendar.day;
    expect(advanceDay(s, data).pause).toBe('MATCH_DAY');
    expect(s.calendar.day).toBe(day);
    expect(playerMatchToday(s, data)).not.toBeNull();
    expect(commitMatchDay(s, data).ok).toBe(true);
    expect(s.week).toBe(1);
    advanceDay(s, data);
    expect(s.calendar.day).toBe(day + 1);
  });

  it('cannot play without a lineup: the calendar waits on match day', () => {
    const s = ready(3);
    s.lineup = null;
    advanceToNextMatch(s, data);
    expect(commitMatchDay(s, data).ok).toBe(false);
    const day = s.calendar.day;
    advanceDay(s, data);
    expect(s.calendar.day).toBe(day);
  });

  it('pauses with a warning when money runs low', () => {
    const s = ready(4);
    s.funds = 100;
    const r = advanceUntilPause(s, data);
    expect(r.pause).toBe('LOW_FUNDS');
    expect(s.inbox.some((m) => m.kind === 'FINANCE')).toBe(true);
  });
});

describe('a full season', () => {
  it('goes pre-season -> regular -> playoffs -> finished with a correct bracket and champion', () => {
    const s = ready(5);
    const phases = playSeason(s);
    expect(phases).toEqual(['PRESEASON', 'REGULAR', 'PLAYOFFS', 'FINISHED']);
    expect(s.results).toHaveLength(30);
    const table = standings(s);
    const semis = s.playoffs.filter((m) => m.stage === 'SEMI');
    expect(semis.map((m) => [m.blue, m.red])).toEqual([[table[0]!.clubId, table[3]!.clubId], [table[1]!.clubId, table[2]!.clubId]]);
    const final = s.playoffs.find((m) => m.stage === 'FINAL')!;
    expect([final.blue, final.red]).toEqual(semis.map((m) => m.winner));
    expect(final.winner).not.toBeNull();
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.champion).toBe(final.winner);
    expect(s.history[0]!.playerRank).toBe(table.findIndex((r) => r.clubId === PLAYER_CLUB_ID) + 1);
    // salaries are paid for every week of the season
    const weeks = Math.floor(s.calendar.day / 7);
    expect(s.ledger.filter((e) => e.kind === 'SALARY')).toHaveLength(weeks);
  }, 60_000);

  it('three seasons in a row: new schedule each season, players age, history keeps every season', () => {
    const s = ready(6);
    const ages = Object.fromEntries(Object.values(s.players).map((p) => [p.id, p.age]));
    const schedules: string[] = [];
    for (let season = 1; season <= 3; season++) {
      expect(s.calendar.season).toBe(season);
      schedules.push(JSON.stringify(s.schedule.map((r) => r.map((f) => f.seed))));
      playSeason(s);
      advanceDay(s, data); // into the next season
      expect(autoManage(s, data).ok).toBe(true); // contracts end; keep the club playable
    }
    expect(s.calendar).toEqual({ season: 4, phase: 'PRESEASON', day: 0 });
    expect(s.history.map((h) => h.season)).toEqual([1, 2, 3]);
    expect(new Set(schedules).size).toBe(3);
    for (const p of Object.values(s.players)) expect(p.age).toBe(ages[p.id]! + 3);
    expect(s.results).toHaveLength(0);
    expect(s.inbox.some((m) => m.title === '第 4 赛季开始')).toBe(true);
  }, 120_000);

  it('is deterministic and survives saving in the middle of the playoffs', () => {
    const a = ready(7);
    const b = ready(7);
    playSeason(a);
    // b: play to the playoffs, save, load, continue
    playSeason(b, 'PLAYOFFS');
    const loaded = deserialize(serialize(b, { createdAt: 'x' }));
    if (!loaded.ok) throw new Error(loaded.error);
    const c = loaded.save.game as GameState;
    expect(c.calendar).toEqual(b.calendar);
    playSeason(c);
    expect(c).toEqual(a);
  }, 120_000);
});
