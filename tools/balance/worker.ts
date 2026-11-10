// Worker: runs a slice of one scenario and returns compact records.
import { parentPort, workerData } from 'node:worker_threads';
import { loadGameData } from '../../src/core/config';
import { hashString } from '../../src/core/rng';
import { runMatch } from '../../src/sim';
import { buildReport } from '../../src/sim/report';
import { buildCase, type ScenarioId } from './scenarios';
import { STAFF_ROLES } from '../../src/core/types';
import {
  BRANCH_KINDS, PLAYER_CLUB_ID, type BranchKind, type GameState, type ManageStyle, advanceDay, autoManage, autoTraining, branchOverall, branchRoster, canOpenBranch,
  commitMatchDay, hireDirector, hireStaff, hiredStaff, newGame, openBranch, playerOverall, renewStaff, rosterOf, staffWeek, standings, weeklySalaries,
} from '../../src/game';

export interface EconomySeason { ratio: number; wins: number; rank: number; salaries: number; afterSigning: number; reputation: number; playoff: string }
export interface EconomyRecord { seed: number; seasons: EconomySeason[] }
export interface LeagueRecord {
  seed: number;
  champions: string[]; // club short names, per season
  minAiRoster: number;
  aiFundsRatio: { min: number; max: number }; // funds / starting funds, worst over all clubs and seasons
  talent: { season: number; marketSize: number; leagueAvg: number; starterAvg: number; best: number; avgAge: number; p10: number; p50: number; p90: number; totalMoney: number; avgSalary: number; retiring: number; retiredFree: number; rookies: number; fromRookies: number }[];
  playerFunds: number[];
}

/** One run of a club left to staff (P3, T34), or to the plain automatic manager (`level` 'auto'). */
export interface StaffRunSeason { wins: number; losses: number; playoff: string; champion: boolean; funds: number; minFunds: number; starterAvg: number; leagueStarterAvg: number; roster: number; staffCost: number; slips: number; hired: number; championName: string }
export interface StaffRecord { seed: number; level: string; seasons: StaffRunSeason[] }

/** One run of a whole group (P4, T42): the MOBA club on the plain automatic manager, other divisions opened when possible and left to a director. */
export interface GroupSeason {
  funds: number; minFunds: number; reputation: number; mobaWins: number; mobaLosses: number; mobaPlayoff: string; goals: number;
  net: Record<string, number>; // money by division this season
  branches: Partial<Record<BranchKind, { rank: number; wins: number; result: string; champion: string; squad: number; starter: number; leagueLevel: number }>>;
}
export interface GroupRecord { seed: number; seasons: GroupSeason[]; opened: Partial<Record<BranchKind, number>> }

export interface MatchRecord {
  i: number;
  focusWon: boolean;
  winner: 'BLUE' | 'RED';
  durationSec: number;
  timeout: boolean;
  ms: number;
  checksum: string;
  repeatChecksum?: string;
  repeatEventsHash?: string;
  eventsHash?: string;
  reportOk: boolean;
  reportError?: string;
  tags: Record<string, string>;
  picks: { heroId: string; won: boolean }[];
  kills: number;
  gold12: number; // focus side minus other side at 12:00 (or last point)
  gold20: number;
}

function goldAt(tl: { t: number; diff: number }[], t: number): number {
  let v = 0;
  for (const p of tl) if (p.t <= t) v = p.diff;
  return v;
}

const { scenario, from, to, repeat, mode } = workerData as { scenario: ScenarioId; from: number; to: number; repeat: boolean; mode?: 'economy' | 'league' | 'staff' | 'group'; strategy?: string; seasons?: number };
const data = loadGameData();

/**
 * Hires a candidate for every empty role, at the given skill (all three skills), paying the
 * wage that skill would ask for. Without the money the role stays with the "player", which
 * the simulation plays as the plain automatic manager.
 */
function hireAt(s: GameState, skill: number): void {
  const m = data.staff.market;
  for (const role of STAFF_ROLES) {
    if (hiredStaff(s, role)) continue;
    const c = s.staffMarket.map((id) => s.staff[id]!).find((x) => x.role === role);
    if (!c) continue;
    c.skills = { scouting: skill, leading: skill, money: skill };
    c.salaryPerWeek = Math.round((m.salaryBase + Math.max(0, skill + m.mainSkillBonus - m.skillMin) * m.salaryPerSkill) / 10) * 10;
    c.signingFee = c.salaryPerWeek * m.signingFeeWeeks;
    if (hireStaff(s, data, c.id).ok) s.delegation.roles[role].authority = 'FULL';
  }
}

if (mode === 'group') {
  const rows: GroupRecord[] = [];
  const skill = Number(workerData.level ?? 60); // the director hired: the candidate closest to this skill
  for (let seed = from; seed < to; seed++) {
    const s = newGame('集团', '#3a7bd5', 50_000 + seed, data);
    const rec: GroupRecord = { seed, seasons: [], opened: {} };
    for (let k = 0; k < (workerData.seasons as number); k++) {
      autoManage(s, data, 'balanced');
      // Open a division once the group can afford it with a cushion, and hand it to a director.
      for (const kind of BRANCH_KINDS) {
        const cfg = data.branches.kinds[kind];
        if (!s.branches[kind] && canOpenBranch(s, data, kind).ok && s.funds >= cfg.open.cost + 80000 && openBranch(s, data, kind).ok) rec.opened[kind] = s.calendar.season;
        const b = s.branches[kind];
        if (b && !b.director) {
          const c = [...b.candidates].sort((x, y) => Math.abs(x.skill - skill) - Math.abs(y.skill - skill))[0];
          if (c) hireDirector(s, data, kind, c.id);
        }
      }
      let minFunds = s.funds, wins = 0, losses = 0;
      for (let guard = 0; guard < 400 && s.calendar.phase !== 'FINISHED'; guard++) {
        autoTraining(s);
        const pause = advanceDay(s, data).pause;
        minFunds = Math.min(minFunds, s.funds);
        if (pause !== 'MATCH_DAY') continue;
        let c = commitMatchDay(s, data);
        if (!c.ok) { autoManage(s, data, 'balanced'); c = commitMatchDay(s, data); }
        if (!c.ok) throw new Error(c.error);
        if (c.value.playerResult?.winner === PLAYER_CLUB_ID) wins++;
        else if (c.value.playerResult) losses++;
      }
      const h = s.history[s.history.length - 1]!;
      const net: Record<string, number> = {};
      for (const e of s.ledger) net[e.branch ?? 'MOBA'] = (net[e.branch ?? 'MOBA'] ?? 0) + e.amount;
      const season: GroupSeason = { funds: s.funds, minFunds, reputation: s.club.reputation, mobaWins: wins, mobaLosses: losses, mobaPlayoff: h.playerPlayoff, goals: Object.keys(s.goals).length, net, branches: {} };
      for (const kind of BRANCH_KINDS) {
        const b = s.branches[kind];
        const bh = b?.history.find((x) => x.season === h.season);
        if (!b || !bh) continue;
        const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
        season.branches[kind] = {
          rank: bh.rank, wins: bh.wins, result: bh.result, champion: bh.champion, squad: b.roster.length,
          starter: mean(branchRoster(b).map((p) => branchOverall(data, kind, p)).sort((x, y) => y - x).slice(0, data.branches.kinds[kind].squad)),
          leagueLevel: mean(b.teams.map((t) => mean(t.roster.map((id) => branchOverall(data, kind, b.players[id]!))))),
        };
      }
      rec.seasons.push(season);
      advanceDay(s, data);
    }
    rows.push(rec);
  }
  parentPort!.postMessage(rows);
} else if (mode === 'staff') {
  const level = workerData.level as string; // 'auto' or a skill 0-100
  const rows: StaffRecord[] = [];
  for (let seed = from; seed < to; seed++) {
    const s = newGame('委任', '#3a7bd5', 30_000 + seed, data);
    const rec: StaffRecord = { seed, level, seasons: [] };
    const auto = level === 'auto';
    for (let k = 0; k < (workerData.seasons as number); k++) {
      if (auto) autoManage(s, data, 'balanced');
      else { hireAt(s, Number(level)); staffWeek(s, data); if (!hiredStaff(s, 'MANAGER') || !hiredStaff(s, 'COACH')) autoManage(s, data, 'balanced'); }
      let wins = 0, losses = 0, minFunds = s.funds;
      for (let guard = 0; guard < 400 && s.calendar.phase !== 'FINISHED'; guard++) {
        if (auto) autoTraining(s);
        const pause = advanceDay(s, data).pause;
        minFunds = Math.min(minFunds, s.funds);
        if (pause !== 'MATCH_DAY') continue;
        let c = commitMatchDay(s, data);
        if (!c.ok) { autoManage(s, data, 'balanced'); c = commitMatchDay(s, data); }
        if (!c.ok) throw new Error(c.error);
        if (c.value.playerResult?.winner === PLAYER_CLUB_ID) wins++;
        else if (c.value.playerResult) losses++;
      }
      const h = s.history[s.history.length - 1]!;
      const starters = (id: string) => rosterOf(s, id).map(playerOverall).sort((a, b) => b - a).slice(0, 5);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      const season = s.calendar.season;
      rec.seasons.push({
        wins, losses, playoff: h.playerPlayoff, champion: h.champion === PLAYER_CLUB_ID, funds: s.funds, minFunds,
        starterAvg: mean(starters(PLAYER_CLUB_ID)), leagueStarterAvg: mean([s.club, ...s.aiClubs].flatMap((c) => starters(c.id))), roster: s.club.roster.length,
        staffCost: -s.ledger.filter((e) => e.kind === 'STAFF').reduce((a, e) => a + e.amount, 0),
        slips: s.decisionLog.filter((e) => e.season === season && /没看准|想多练|练得更强|不升就晚/.test(e.reason)).length,
        hired: STAFF_ROLES.filter((r) => hiredStaff(s, r)).length,
        championName: h.champion === PLAYER_CLUB_ID ? '玩家' : s.aiClubs.find((c) => c.id === h.champion)?.shortName ?? '?',
      });
      if (!auto) for (const role of STAFF_ROLES) { const st = hiredStaff(s, role); if (st?.hired && st.hired.until <= s.calendar.season) renewStaff(s, data, role); }
      advanceDay(s, data); // into the next season
    }
    rows.push(rec);
  }
  parentPort!.postMessage(rows);
} else if (mode === 'league') {
  const rows: LeagueRecord[] = [];
  for (let seed = from; seed < to; seed++) {
    const s = newGame('多赛季', '#3a7bd5', 20_000 + seed, data);
    const start = Object.fromEntries(s.aiClubs.map((c) => [c.id, c.funds]));
    const rec: LeagueRecord = { seed, champions: [], minAiRoster: 99, aiFundsRatio: { min: Infinity, max: -Infinity }, talent: [], playerFunds: [] };
    for (let k = 0; k < (workerData.seasons as number); k++) {
      const atStart = Object.keys(s.players);
      autoManage(s, data, 'balanced');
      for (let guard = 0; guard < 400 && s.calendar.phase !== 'FINISHED'; guard++) {
        autoTraining(s);
        for (const c of s.aiClubs) rec.minAiRoster = Math.min(rec.minAiRoster, c.roster.length);
        if (advanceDay(s, data).pause !== 'MATCH_DAY') continue;
        let c = commitMatchDay(s, data);
        if (!c.ok) { autoManage(s, data, 'balanced'); c = commitMatchDay(s, data); }
        if (!c.ok) throw new Error(c.error);
      }
      const h = s.history[s.history.length - 1]!;
      rec.champions.push(h.champion === PLAYER_CLUB_ID ? '玩家' : s.aiClubs.find((c) => c.id === h.champion)!.shortName);
      for (const c of s.aiClubs) {
        rec.aiFundsRatio.min = Math.min(rec.aiFundsRatio.min, c.funds / start[c.id]!);
        rec.aiFundsRatio.max = Math.max(rec.aiFundsRatio.max, c.funds / start[c.id]!);
      }
      const all = Object.values(s.players);
      const starters = [s.club, ...s.aiClubs].flatMap((c) => rosterOf(s, c.id).map(playerOverall).sort((a, b) => b - a).slice(0, 5));
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      const rostered = [s.club, ...s.aiClubs].flatMap((c) => rosterOf(s, c.id));
      const ovr = rostered.map(playerOverall).sort((a, b) => a - b);
      const q = (f: number) => ovr[Math.min(ovr.length - 1, Math.floor(f * ovr.length))]!;
      rec.talent.push({
        season: h.season, marketSize: s.market.length, leagueAvg: mean(all.map(playerOverall)), starterAvg: mean(starters), best: Math.max(...all.map(playerOverall)),
        avgAge: mean(all.map((p) => p.age)), p10: q(0.1), p50: q(0.5), p90: q(0.9),
        totalMoney: s.funds + s.aiClubs.reduce((a, c) => a + c.funds, 0), avgSalary: mean(rostered.map((p) => p.salaryPerWeek)),
        retiring: rostered.filter((p) => p.retiring).length, rookies: rostered.filter((p) => p.id.startsWith(`yt_s${h.season}_`)).length,
        // Free agents who retired: during the season (only retirement removes players then), and
        // the old ones at the change of season (the weakest trimmed from a full market are all younger).
        retiredFree: atStart.filter((id) => !s.players[id]).length,
        fromRookies: rostered.filter((p) => p.id.startsWith('yt_')).length / Math.max(1, rostered.length),
      });
      rec.playerFunds.push(s.funds);
      const ages = Object.values(s.players).filter((p) => !p.retiring).map((p) => [p.id, p.age] as const);
      advanceDay(s, data);
      rec.talent[rec.talent.length - 1]!.retiredFree += ages.filter(([id, age]) => !s.players[id] && age + 1 >= data.ai.talent.freeAgentLeaveAge).length;
    }
    rows.push(rec);
  }
  parentPort!.postMessage(rows);
} else if (mode === 'economy') {
  const rows: EconomyRecord[] = [];
  for (let seed = from; seed < to; seed++) {
    const s = newGame('校准', '#3a7bd5', 10_000 + seed, data);
    const seasons: EconomySeason[] = [];
    for (let k = 0; k < (workerData.seasons as number); k++) {
      const managed = autoManage(s, data, workerData.strategy as ManageStyle);
      if (!managed.ok) throw new Error(managed.error);
      const salaries = weeklySalaries(s);
      const afterSigning = s.funds;
      let wins = 0;
      for (let guard = 0; guard < 400 && s.calendar.phase !== 'FINISHED'; guard++) {
        autoTraining(s);
        if (advanceDay(s, data).pause !== 'MATCH_DAY') continue;
        let c = commitMatchDay(s, data);
        if (!c.ok) { autoManage(s, data, workerData.strategy as ManageStyle); c = commitMatchDay(s, data); }
        if (!c.ok) throw new Error(c.error);
        if (c.value.playerResult?.winner === PLAYER_CLUB_ID) wins++;
      }
      const h = s.history[s.history.length - 1]!;
      seasons.push({ ratio: s.funds / s.startingFunds, wins, rank: standings(s).findIndex((x) => x.clubId === PLAYER_CLUB_ID) + 1, salaries, afterSigning, reputation: s.club.reputation, playoff: h.playerPlayoff });
      advanceDay(s, data); // into the next season
    }
    rows.push({ seed, seasons });
  }
  parentPort!.postMessage(rows);
} else if (workerData.pool) {
  // Pool mode: one warm worker plays many slices (no restart, no re-compiling between slices).
  parentPort!.on('message', (job: MatchJob) => parentPort!.postMessage(runSlice(job)));
} else {
  parentPort!.postMessage(runSlice({ scenario, from, to, repeat }));
}

interface MatchJob { scenario: ScenarioId; from: number; to: number; repeat: boolean }

/** Plays one slice of a scenario. */
function runSlice({ scenario, from, to, repeat }: MatchJob): MatchRecord[] {
  const out: MatchRecord[] = [];
  for (let i = from; i < to; i++) {
    const c = buildCase(data, scenario, i);
    const t0 = performance.now();
    const r = runMatch(c.input, data);
    const ms = performance.now() - t0;
    let reportOk = true;
    let reportError: string | undefined;
    try {
      const rep = buildReport(r, c.input, data);
      if (rep.keyReasons.length !== 3) throw new Error(`expected 3 reasons, got ${rep.keyReasons.length}`);
      for (const k of rep.keyReasons) {
        if (k.eventRefs.length === 0) throw new Error(`reason without events: ${k.text}`);
        for (const ref of k.eventRefs) if (!r.events[ref]) throw new Error(`bad event ref ${ref}`);
      }
    } catch (e) {
      reportOk = false;
      reportError = String(e);
    }
    const rec: MatchRecord = {
      i, focusWon: r.winner === c.focus, winner: r.winner, durationSec: r.durationSec,
      timeout: r.events.some((e) => e.reason === 'timeout'), ms, checksum: r.checksum, reportOk, reportError, tags: c.tags,
      picks: [...c.input.blue.lineup.picks.map((p) => ({ heroId: p.heroId, won: r.winner === 'BLUE' })), ...c.input.red.lineup.picks.map((p) => ({ heroId: p.heroId, won: r.winner === 'RED' }))],
      kills: r.events.filter((e) => e.type === 'KILL').length,
      gold12: goldAt(r.goldDiffTimeline, 720) * (c.focus === 'BLUE' ? 1 : -1),
      gold20: goldAt(r.goldDiffTimeline, 1200) * (c.focus === 'BLUE' ? 1 : -1),
    };
    if (repeat) {
      rec.eventsHash = hashString(JSON.stringify(r.events)).toString(16);
      const again = runMatch(structuredClone(buildCase(data, scenario, i).input), data);
      rec.repeatChecksum = again.checksum;
      rec.repeatEventsHash = hashString(JSON.stringify(again.events)).toString(16);
    }
    out.push(rec);
  }
  return out;
}
