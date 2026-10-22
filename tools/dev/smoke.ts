// Dev helper: quick stats over N matches. Usage: npx tsx tools/dev/smoke.ts [n] [brain]
import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { runMatch } from '../../src/sim';
import { cloneTeam, syntheticTeam } from '../../src/sim/scenario';
import type { BrainKind } from '../../src/sim/state';

const n = Number(process.argv[2] ?? 100);
const brain = (process.argv[3] ?? 'simple') as BrainKind;
const data = loadGameData();
const durs: number[] = [];
let blue = 0, timeouts = 0, kills = 0, towers = 0;
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const rng = createRng(1000 + i);
  const a = syntheticTeam(data, rng, { idPrefix: 'A', tactic: 'STEADY_MACRO', ability: 60 });
  const b = cloneTeam(a, 'B');
  const r = runMatch({ seed: i, blue: a, red: b }, data, { brain });
  durs.push(r.durationSec / 60);
  if (r.winner === 'BLUE') blue++;
  if (r.events.some((e) => e.reason === 'timeout')) timeouts++;
  kills += r.events.filter((e) => e.type === 'KILL').length;
  towers += r.events.filter((e) => e.type === 'TOWER_DESTROYED').length;
}
durs.sort((x, y) => x - y);
console.log({ n, ms: Math.round(performance.now() - t0), blueWin: blue / n, timeouts,
  median: durs[Math.floor(n / 2)]?.toFixed(1), p10: durs[Math.floor(n * 0.1)]?.toFixed(1), p90: durs[Math.floor(n * 0.9)]?.toFixed(1),
  killsPerGame: (kills / n).toFixed(1), towersPerGame: (towers / n).toFixed(1) });
