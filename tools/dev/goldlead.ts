// Dev helper: how often the side ahead in gold at a given minute wins.
import { loadGameData } from '../../src/core/config';
import { runMatch } from '../../src/sim';
import { buildCase } from '../balance/scenarios';
const data = loadGameData();
const n = Number(process.argv[2] ?? 300);
const buckets: Record<string, { n: number; w: number }> = {};
for (let i = 0; i < n; i++) {
  const c = buildCase(data, 'POOL', i);
  const r = runMatch(c.input, data);
  for (const minute of [10, 15]) {
    const p = [...r.goldDiffTimeline].reverse().find((x) => x.t <= minute * 60);
    if (!p || r.durationSec < minute * 60 + 60) continue;
    const lead = Math.abs(p.diff);
    if (lead < 1000) continue;
    const b = lead < 3000 ? '1-3k' : lead < 6000 ? '3-6k' : '6k+';
    const key = `${minute}min ${b}`;
    buckets[key] ??= { n: 0, w: 0 };
    buckets[key].n++;
    if ((p.diff > 0) === (r.winner === 'BLUE')) buckets[key].w++;
  }
}
for (const [k, v] of Object.entries(buckets).sort()) console.log(k.padEnd(14), `领先方胜率 ${(v.w / v.n * 100).toFixed(0)}%  (${v.n} 场)`);
