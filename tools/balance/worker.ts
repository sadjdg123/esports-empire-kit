// Worker: runs a slice of one scenario and returns compact records.
import { parentPort, workerData } from 'node:worker_threads';
import { loadGameData } from '../../src/core/config';
import { hashString } from '../../src/core/rng';
import { runMatch } from '../../src/sim';
import { buildReport } from '../../src/sim/report';
import { buildCase, type ScenarioId } from './scenarios';

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

const { scenario, from, to, repeat } = workerData as { scenario: ScenarioId; from: number; to: number; repeat: boolean };
const data = loadGameData();
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
parentPort!.postMessage(out);
