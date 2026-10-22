import { loadGameData } from '../../src/core/config';
import type { Tactic } from '../../src/core/types';
import { runMatch } from '../../src/sim';
import { clubTeam } from '../../src/sim/scenario';
const data = loadGameData();
const [b, r, bt, rt, mode] = process.argv.slice(2) as [string, string, Tactic, Tactic, string];
let w = 0; const n = 30;
for (let seed = 1; seed <= n; seed++) {
  const blue = clubTeam(data, b, bt);
  const red = clubTeam(data, r, rt);
  if (mode === 'sameHeroes') red.lineup.picks.forEach((p, i) => { p.heroId = blue.lineup.picks[i]!.heroId; });
  if (mode === 'swapHeroes') { const bh = blue.lineup.picks.map((p) => p.heroId); blue.lineup.picks.forEach((p, i) => { p.heroId = red.lineup.picks[i]!.heroId; }); red.lineup.picks.forEach((p, i) => { p.heroId = bh[i]!; }); }
  if (mode === 'noForm') for (const p of [...blue.players, ...red.players]) p.form = 0;
  const res = runMatch({ seed, blue, red }, data);
  if (res.winner === 'BLUE') w++;
}
console.log(mode, 'blue wins', w, '/', n);
