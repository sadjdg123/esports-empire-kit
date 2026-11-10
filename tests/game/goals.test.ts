import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { advanceDay, autoManage, checkGoals, commitMatchDay, goalProgress, newGame, openBranch, type GameState } from '../../src/game';

const data = loadGameData();
const goal = (id: string) => data.goals.find((g) => g.id === id)!;

function club(seed = 4): GameState {
  const s = newGame('目标', '#3a7bd5', seed, data);
  autoManage(s, data, 'balanced');
  return s;
}

describe('milestones (T41)', () => {
  it('every goal has a known kind, a positive target and a unique id', () => {
    const s = club();
    const kinds = ['WINS', 'MOBA_PLAYOFFS', 'MOBA_TITLES', 'PROFIT_SEASONS', 'STAR_OVR', 'MVPS', 'STAFF_HIRED', 'BRANCHES', 'BRANCH_TITLES', 'TRIPLE', 'REPUTATION', 'HALL_OF_FAME'];
    expect(new Set(data.goals.map((g) => g.id)).size).toBe(data.goals.length);
    for (const g of data.goals) { expect(kinds).toContain(g.kind); expect(g.target).toBeGreaterThan(0); expect(goalProgress(s, g)).toBeGreaterThanOrEqual(0); }
  });

  it('a new club has reached nothing', () => {
    const s = club();
    expect(checkGoals(s, data)).toHaveLength(0);
    expect(Object.keys(s.goals)).toHaveLength(0);
  });

  it('a goal pays once: money through the ledger, reputation, and a message', () => {
    const s = club();
    s.counters.wins = 1;
    const funds = s.funds, rep = s.club.reputation;
    const fresh = checkGoals(s, data);
    expect(fresh.map((g) => g.id)).toEqual(['first_win']);
    expect(s.funds).toBe(funds + goal('first_win').reward);
    expect(s.ledger.at(-1)).toMatchObject({ kind: 'PRIZE', amount: goal('first_win').reward });
    expect(s.club.reputation).toBe(rep + goal('first_win').reputation);
    expect(s.inbox.at(-1)!.title).toContain('第一场胜利');
    expect(checkGoals(s, data)).toHaveLength(0); // not twice
    expect(s.funds).toBe(funds + goal('first_win').reward);
  });

  it('opening divisions reaches the group goals', () => {
    const s = club();
    s.funds = 500000; s.club.reputation = 50;
    openBranch(s, data, 'FPS');
    expect(checkGoals(s, data).map((g) => g.id)).toContain('second_branch');
    openBranch(s, data, 'CARD');
    expect(checkGoals(s, data).map((g) => g.id)).toContain('group');
  });

  it('playing a season counts wins and reaches the first win by itself', () => {
    const s = club(9);
    let wins = 0;
    for (let g = 0; g < 400 && s.calendar.phase !== 'FINISHED'; g++) {
      if (advanceDay(s, data).pause !== 'MATCH_DAY') continue;
      const c = commitMatchDay(s, data);
      if (c.ok && c.value.playerResult?.winner === 'player') wins++;
    }
    expect(s.counters.wins).toBe(wins);
    if (wins > 0) expect(s.goals.first_win).toBeDefined();
    const start = s.funds - s.ledger.reduce((a, e) => a + e.amount, 0);
    expect(s.counters.profitSeasons).toBe(s.funds > start ? 1 : 0);
  }, 240_000);
});
