// Dev helper: tactic A (blue/red alternated) vs tactic B on identical teams.
// Usage: npx tsx tools/dev/tac.ts A B [n]
import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import type { Tactic } from '../../src/core/types';
import { runMatch } from '../../src/sim';
import { cloneTeam, syntheticTeam } from '../../src/sim/scenario';

const [ta, tb, nArg] = process.argv.slice(2) as [Tactic, Tactic, string];
const n = Number(nArg ?? 100);
const data = loadGameData();
let winsA = 0, gankA = 0, gankB = 0, tfLateA = 0, splitA = 0, killsA = 0, killsB = 0, dur = 0, objA = 0, objB = 0;
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const rng = createRng(5000 + i);
  const base = syntheticTeam(data, rng, { idPrefix: 'X', tactic: ta, ability: 50 + rng.int(0, 20) });
  const aBlue = i % 2 === 0;
  const A = cloneTeam(base, 'A', ta);
  const B = cloneTeam(base, 'B', tb);
  const r = runMatch({ seed: i, blue: aBlue ? A : B, red: aBlue ? B : A }, data);
  const sideA = aBlue ? 'BLUE' : 'RED';
  if (r.winner === sideA) winsA++;
  dur += r.durationSec;
  for (const e of r.events) {
    if (e.type === 'GANK' && e.t < 720) { if (e.side === sideA) gankA++; else gankB++; }
    if (e.type === 'TEAMFIGHT_START' && e.t >= 720) tfLateA++;
    if (e.type === 'SPLIT_PUSH' && e.side === sideA) splitA++;
    if (e.type === 'KILL') { if (e.side === sideA) killsA++; else killsB++; }
    if (e.type === 'OBJECTIVE_TAKEN') { if (e.side === sideA) objA++; else objB++; }
  }
}
console.log(`${ta} vs ${tb}: A win ${(winsA / n * 100).toFixed(1)}%  ganks<12m A ${(gankA / n).toFixed(2)} B ${(gankB / n).toFixed(2)}  lateTF ${(tfLateA / n).toFixed(2)} splitA ${(splitA / n).toFixed(2)} kills A ${(killsA / n).toFixed(1)} B ${(killsB / n).toFixed(1)} obj A ${(objA / n).toFixed(2)} B ${(objB / n).toFixed(2)} dur ${(dur / n / 60).toFixed(1)}m  ${Math.round((performance.now() - t0) / n)}ms/match`);
