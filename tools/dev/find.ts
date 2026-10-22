// Dev helper: scan seeds for representative club matches.
import { loadGameData } from '../../src/core/config';
import type { Tactic } from '../../src/core/types';
import { runMatch } from '../../src/sim';
import { buildReport } from '../../src/sim/report';
import { clubTeam } from '../../src/sim/scenario';
const data = loadGameData();
const [b, r, bt, rt, nArg] = process.argv.slice(2) as [string, string, Tactic, Tactic, string];
let bw = 0;
for (let seed = 1; seed <= Number(nArg ?? 20); seed++) {
  const input = { seed, blue: clubTeam(data, b, bt), red: clubTeam(data, r, rt) };
  const res = runMatch(input, data);
  if (res.winner === 'BLUE') bw++;
  const rep = buildReport(res, input, data);
  console.log(seed, res.winner, (res.durationSec / 60).toFixed(1), rep.headline);
}
console.log('blue wins', bw);
