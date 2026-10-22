// Dev helper: early deaths by role and context. Usage: npx tsx tools/dev/deaths.ts A B [n]
import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import type { Tactic } from '../../src/core/types';
import { createMatch, step } from '../../src/sim';
import { cloneTeam, syntheticTeam } from '../../src/sim/scenario';

const [ta, tb, nArg] = process.argv.slice(2) as [Tactic, Tactic, string];
const n = Number(nArg ?? 40);
const data = loadGameData();
const deaths: Record<string, number> = {};
for (let i = 0; i < n; i++) {
  const rng = createRng(9000 + i);
  const base = syntheticTeam(data, rng, { idPrefix: 'X', tactic: ta, ability: 60 });
  const s = createMatch({ seed: i, blue: cloneTeam(base, 'A', ta), red: cloneTeam(base, 'B', tb) }, data);
  let seen = 0;
  while (!s.over && s.t < 720) {
    step(s);
    for (; seen < s.events.length; seen++) {
      const e = s.events[seen]!;
      if (e.type !== 'KILL') continue;
      const victim = s.heroes.find((h) => h.player.id === e.targets![0])!;
      const key = `${victim.side} ${victim.role} while ${victim.action} @${e.nodeId} [${e.reason ?? ''}]`;
      deaths[key] = (deaths[key] ?? 0) + 1;
    }
  }
}
Object.entries(deaths).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log((v / n).toFixed(2), k));
