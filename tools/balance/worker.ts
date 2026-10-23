// Worker: runs a slice of one scenario and returns compact records.
import { parentPort, workerData } from 'node:worker_threads';
import { loadGameData } from '../../src/core/config';
import { hashString } from '../../src/core/rng';
import { runMatch } from '../../src/sim';
import { buildReport } from '../../src/sim/report';
import { buildCase, type ScenarioId } from './scenarios';
import { PLAYER_CLUB_ID, type ManageStyle, advanceDay, autoManage, autoTraining, commitMatchDay, newGame, standings, weeklySalaries } from '../../src/game';

export interface EconomySeason { ratio: number; wins: number; rank: number; salaries: number; afterSigning: number; reputation: number; playoff: string }
export interface EconomyRecord { seed: number; seasons: EconomySeason[] }

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

const { scenario, from, to, repeat, mode } = workerData as { scenario: ScenarioId; from: number; to: number; repeat: boolean; mode?: 'economy'; strategy?: string; seasons?: number };
const data = loadGameData();
const out: MatchRecord[] = [];
if (mode === 'economy') {
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
} else {
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
parentPort!.postMessage(out);
}
