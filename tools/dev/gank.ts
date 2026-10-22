// Dev helper: gank outcomes. Usage: npx tsx tools/dev/gank.ts TACTIC_A TACTIC_B [n]
import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import type { Tactic } from '../../src/core/types';
import { runMatch } from '../../src/sim';
import { cloneTeam, syntheticTeam } from '../../src/sim/scenario';

const [ta, tb, nArg] = process.argv.slice(2) as [Tactic, Tactic, string];
const n = Number(nArg ?? 60);
const data = loadGameData();
let ganks = 0, success = 0, fail = 0, both = 0;
let earlyKillsA = 0, earlyKillsB = 0;
for (let i = 0; i < n; i++) {
  const rng = createRng(9000 + i);
  const base = syntheticTeam(data, rng, { idPrefix: 'X', tactic: ta, ability: 60 });
  const A = cloneTeam(base, 'A', ta);
  const B = cloneTeam(base, 'B', tb);
  const r = runMatch({ seed: i, blue: A, red: B }, data);
  for (const e of r.events) {
    if (e.type === 'KILL' && e.t < 720) { if (e.side === 'BLUE') earlyKillsA++; else earlyKillsB++; }
    if (e.type !== 'GANK' || e.side !== 'BLUE' || e.t >= 720) continue;
    ganks++;
    const window = r.events.filter((k) => k.type === 'KILL' && k.t >= e.t && k.t <= e.t + 12);
    const s = window.some((k) => k.targets?.[0] === e.targets?.[0]);
    const f = window.some((k) => k.targets?.[0] === e.actors[0]);
    if (s && f) both++; else if (s) success++; else if (f) fail++;
  }
}
console.log(`${ta}(blue) vs ${tb}: ganks<12m ${ganks / n} per game; target died ${(success / ganks * 100).toFixed(0)}%, ganker died ${(fail / ganks * 100).toFixed(0)}%, trade ${(both / ganks * 100).toFixed(0)}%; early kills A ${(earlyKillsA / n).toFixed(1)} B ${(earlyKillsB / n).toFixed(1)}`);
