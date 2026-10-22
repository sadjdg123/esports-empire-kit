// Dev helper: per-role hero strength. Mirror teams; only one role's hero differs.
// Usage: npx tsx tools/dev/herotest.ts ROLE [n]
import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { ROLES, type Role } from '../../src/core/types';
import { runMatch } from '../../src/sim';
import { cloneTeam, heroesForRole, syntheticTeam } from '../../src/sim/scenario';
const role = process.argv[2] as Role;
const n = Number(process.argv[3] ?? 80);
const data = loadGameData();
const pool = heroesForRole(data, role);
const wins: Record<string, number> = {};
const games: Record<string, number> = {};
let k = 0;
for (let i = 0; i < n; i++) {
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) {
    const rng = createRng(4242 + k++);
    const heroes = Object.fromEntries(ROLES.map((r) => [r, rng.pick(heroesForRole(data, r).filter((h) => !(r !== role && h === pool[a]) && !(r !== role && h === pool[b])))]));
    heroes[role] = pool[a]!;
    const A = syntheticTeam(data, rng, { idPrefix: 'A', tactic: 'STEADY_MACRO', ability: 60, heroes, mastery: 70 });
    const B = cloneTeam(A, 'B');
    const pick = B.lineup.picks.find((p) => p.role === role)!;
    const pl = B.players.find((p) => p.id === pick.playerId)!;
    pick.heroId = pool[b]!;
    pl.heroMastery = { [pool[b]!]: 70 };
    const blue = i % 2 === 0;
    const r = runMatch({ seed: k, blue: blue ? A : B, red: blue ? B : A }, data);
    const aWon = r.winner === (blue ? 'BLUE' : 'RED');
    for (const [h, won] of [[pool[a]!, aWon], [pool[b]!, !aWon]] as const) { wins[h] = (wins[h] ?? 0) + (won ? 1 : 0); games[h] = (games[h] ?? 0) + 1; }
  }
}
console.log(role, pool.map((h) => `${data.heroById[h]!.name} ${((wins[h]! / games[h]!) * 100).toFixed(0)}%`).join('  '));
