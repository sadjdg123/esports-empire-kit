// Dev helper: synthetic strong vs weak team. Usage: npx tsx tools/dev/gap.ts hiAbility loAbility tacticHi tacticLo [n]
import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { ROLES, type Tactic } from '../../src/core/types';
import { runMatch } from '../../src/sim';
import { heroesForRole, syntheticTeam } from '../../src/sim/scenario';
const [hi, lo, th, tl, nArg] = process.argv.slice(2);
const data = loadGameData();
const n = Number(nArg ?? 60);
let w = 0;
for (let i = 0; i < n; i++) {
  const rng = createRng(777 + i);
  const heroes = Object.fromEntries(ROLES.map((r) => [r, rng.pick(heroesForRole(data, r))]));
  const A = syntheticTeam(data, rng, { idPrefix: 'S', tactic: th as Tactic, ability: Number(hi), heroes, mastery: 85 });
  const B = syntheticTeam(data, rng, { idPrefix: 'W', tactic: tl as Tactic, ability: Number(lo), heroes, mastery: 60 });
  const blue = i % 2 === 0;
  const r = runMatch({ seed: i, blue: blue ? A : B, red: blue ? B : A }, data);
  if (r.winner === (blue ? 'BLUE' : 'RED')) w++;
}
console.log(`${hi}(${th}) vs ${lo}(${tl}): strong wins ${(w / n * 100).toFixed(0)}%`);
