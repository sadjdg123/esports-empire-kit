import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import {
  BRANCH_KINDS, PLAYER_CLUB_ID, advanceDay, autoManage, branchMarket, branchRoster, branchStandings, branchWeeklyMoney, canOpenBranch, commitMatchDay, hireDirector,
  newGame, openBranch, recommendBranchLineup, releaseBranchPlayer, setBranchLineup, setBranchManaged, signBranchPlayer, validateBranchLineup, weeklyMoney,
  type BranchKind, type GameState,
} from '../../src/game';
import { deserialize, serialize } from '../../src/save/save';
import { FPS_ROLES } from '../../src/sim-fps';

const data = loadGameData();

function rich(seed = 11): GameState {
  const s = newGame('集团', '#3a7bd5', seed, data);
  s.funds = 500000;
  s.club.reputation = 50;
  expect(autoManage(s, data, 'balanced').ok).toBe(true);
  return s;
}
/** Opens a division and signs the cheapest full squad. */
function withSquad(s: GameState, kind: BranchKind): void {
  const r = openBranch(s, data, kind);
  if (!r.ok) throw new Error(r.error);
  const b = r.value;
  const cfg = data.branches.kinds[kind];
  if (kind === 'FPS') for (const role of FPS_ROLES) expect(signBranchPlayer(s, data, kind, branchMarket(b).find((p) => p.primaryRole === role)!.id).ok).toBe(true);
  else for (let i = 0; i < cfg.squad; i++) expect(signBranchPlayer(s, data, kind, branchMarket(b)[0]!.id).ok).toBe(true);
  expect(setBranchLineup(s, data, kind, recommendBranchLineup(data, kind, branchRoster(b))!).ok).toBe(true);
}
function playSeason(s: GameState): void {
  for (let g = 0; g < 400 && s.calendar.phase !== 'FINISHED'; g++) {
    if (advanceDay(s, data).pause !== 'MATCH_DAY') continue;
    let c = commitMatchDay(s, data);
    if (!c.ok) { autoManage(s, data, 'balanced'); c = commitMatchDay(s, data); }
    if (!c.ok) throw new Error(c.error);
  }
}

describe('opening a division (T35/T38)', () => {
  it('needs reputation and money, costs the fee, and can only be opened once', () => {
    const s = newGame('x', '#fff', 3, data);
    expect(canOpenBranch(s, data, 'FPS').ok).toBe(false); // reputation
    s.club.reputation = 60;
    s.funds = 10;
    expect(canOpenBranch(s, data, 'FPS').ok).toBe(false); // money
    s.funds = 300000;
    const r = openBranch(s, data, 'FPS');
    expect(r.ok).toBe(true);
    expect(s.funds).toBe(300000 - data.branches.kinds.FPS.open.cost);
    expect(s.ledger.at(-1)).toMatchObject({ kind: 'BRANCH', branch: 'FPS' });
    expect(openBranch(s, data, 'FPS').ok).toBe(false);
    const b = s.branches.FPS!;
    expect(b.teams).toHaveLength(5);
    expect(b.teams.every((t) => t.roster.length === data.branches.kinds.FPS.squad)).toBe(true);
    expect(b.market).toHaveLength(data.branches.kinds.FPS.marketSize);
    expect(b.schedule).toHaveLength(10); // opened in the pre-season: plays this season
  });

  it('opened during the season, it starts in the next one', () => {
    const s = rich();
    for (let g = 0; g < 30; g++) if (advanceDay(s, data).pause === 'MATCH_DAY') commitMatchDay(s, data);
    expect(s.calendar.phase).toBe('REGULAR');
    const r = openBranch(s, data, 'CARD');
    expect(r.ok && r.value.startSeason).toBe(s.calendar.season + 1);
    expect(s.branches.CARD!.schedule).toHaveLength(0);
    expect(branchWeeklyMoney(s, data, s.branches.CARD!).league).toBe(0);
  });
});

describe('squad and lineup (T38)', () => {
  it('signing, the lineup rules and releasing', () => {
    const s = rich();
    withSquad(s, 'FPS');
    const b = s.branches.FPS!;
    expect(b.roster).toHaveLength(5);
    const lu = b.lineup!;
    expect(lu.kind === 'FPS' && new Set(lu.slots.map((x) => x.role)).size).toBe(5);
    if (lu.kind !== 'FPS') throw new Error('kind');
    const twice = { ...lu, slots: lu.slots.map((x, i) => (i === 1 ? { ...x, playerId: lu.slots[0]!.playerId } : x)) };
    expect(validateBranchLineup(data, b, twice).length).toBeGreaterThan(0);
    const sameRole = { ...lu, slots: lu.slots.map((x) => ({ ...x, role: 'ENTRY' as const })) };
    expect(validateBranchLineup(data, b, sameRole).length).toBeGreaterThan(0);
    const before = s.funds;
    const gone = b.roster[0]!;
    expect(releaseBranchPlayer(s, data, 'FPS', gone).ok).toBe(true);
    expect(s.funds).toBeLessThan(before);
    expect(b.market).toContain(gone);
    expect(b.lineup).toBeNull();
  });

  it('card lineup: three seats, each with a deck', () => {
    const s = rich();
    withSquad(s, 'CARD');
    const lu = s.branches.CARD!.lineup!;
    expect(lu.kind === 'CARD' && lu.seats).toHaveLength(3);
  });

  it('a group with more divisions earns more from its sponsor', () => {
    const s = rich();
    const before = weeklyMoney(s, data).sponsor;
    withSquad(s, 'FPS');
    expect(weeklyMoney(s, data).sponsor).toBe(Math.round(before * (1 + data.branches.kinds.FPS.sponsorBonus)));
  });
});

describe('a season with three divisions (T38)', () => {
  it('plays ten rounds and a final in each, keeps the books, and leaves the MOBA league untouched', () => {
    const plain = rich(21);
    const group = rich(21);
    for (const kind of BRANCH_KINDS) withSquad(group, kind);
    const start = group.funds;
    const ledgerStart = group.ledger.reduce((a, e) => a + e.amount, 0);
    playSeason(plain);
    playSeason(group);
    // The MOBA league is exactly the same with and without the other divisions.
    expect(group.results).toEqual(plain.results);
    expect(group.history.at(-1)!.table).toEqual(plain.history.at(-1)!.table);
    for (const kind of BRANCH_KINDS) {
      const b = group.branches[kind]!;
      expect(b.round).toBe(10);
      expect(b.finalDone).toBe(true);
      expect(b.results).toHaveLength(10 * 3 + 1);
      const table = branchStandings(group, b);
      expect(table.reduce((a, r) => a + r.wins, 0)).toBe(30);
      expect(table.every((r) => r.played === 10)).toBe(true);
      expect(b.history).toHaveLength(1);
      expect(b.history[0]!.rank).toBe(table.findIndex((r) => r.teamId === PLAYER_CLUB_ID) + 1);
      expect(b.reports.filter((r) => !r.final)).toHaveLength(10);
      expect(b.replay).not.toBeNull();
      expect(group.ledger.some((e) => e.branch === kind && e.kind === 'SALARY')).toBe(true);
      expect(group.ledger.some((e) => e.branch === kind && e.kind === 'LEAGUE')).toBe(true);
    }
    // Every coin went through the one ledger.
    expect(start + group.ledger.reduce((a, e) => a + e.amount, 0) - ledgerStart).toBeCloseTo(group.funds, 6);
  }, 240_000);

  it('the same seed gives the same division results, and a save keeps everything', () => {
    const run = () => { const s = rich(5); withSquad(s, 'FPS'); withSquad(s, 'CARD'); playSeason(s); return s; };
    const a = run(), b = run();
    expect(a.branches.FPS!.results).toEqual(b.branches.FPS!.results);
    expect(a.branches.CARD!.results).toEqual(b.branches.CARD!.results);
    const loaded = deserialize(serialize(a, { createdAt: '2026-11-09T00:00:00.000Z' }));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect((loaded.save.game as unknown as GameState).branches).toEqual(a.branches);
  }, 240_000);

  it('a new season: contracts end, the AI teams and the market change, a new schedule', () => {
    const s = rich(8);
    withSquad(s, 'FPS');
    const b = s.branches.FPS!;
    for (const p of branchRoster(b)) p.contractUntil = 1;
    const market = [...b.market];
    const oldSchedule = JSON.stringify(b.schedule);
    playSeason(s);
    advanceDay(s, data); // into season 2
    expect(s.calendar.season).toBe(2);
    expect(b.roster).toHaveLength(0);
    expect(b.market.some((id) => market.includes(id))).toBe(false);
    expect(b.round).toBe(0);
    expect(b.finalDone).toBe(false);
    expect(JSON.stringify(b.schedule)).not.toBe(oldSchedule);
    expect(s.inbox.some((m) => m.title.includes('人离队'))).toBe(true);
    // Without players the division forfeits instead of stopping the game.
    autoManage(s, data, 'balanced');
    playSeason(s);
    expect(b.history.at(-1)).toMatchObject({ wins: 0, losses: 10 });
  }, 240_000);
});

describe('division directors (T40)', () => {
  it('a hired director fills the squad, sets the lineup and writes down why', () => {
    const s = rich(13);
    const r = openBranch(s, data, 'FPS');
    if (!r.ok) throw new Error(r.error);
    const b = r.value;
    expect(setBranchManaged(s, 'FPS', true).ok).toBe(false); // nobody to run it
    const c = b.candidates[0]!;
    const before = s.funds;
    expect(hireDirector(s, data, 'FPS', c.id).ok).toBe(true);
    expect(s.funds).toBe(before - c.signingFee);
    expect(b.managed).toBe(true);
    playSeason(s);
    expect(b.roster.length).toBeGreaterThanOrEqual(5);
    expect(new Set(branchRoster(b).map((p) => p.primaryRole)).size).toBe(5);
    expect(b.history.at(-1)!.wins + b.history.at(-1)!.losses).toBe(10);
    expect(b.history.at(-1)!.wins).toBeGreaterThan(0);
    expect(b.log.some((l) => l.text.startsWith('签下'))).toBe(true);
    expect(b.log.every((l) => l.reason.length > 0)).toBe(true);
    expect(s.ledger.some((e) => e.branch === 'FPS' && e.kind === 'STAFF' && e.note.includes('总监工资'))).toBe(true);
  }, 240_000);
});
