// Dev helper: pacing of one match. Usage: npx tsx tools/dev/inspect.ts [seed]
import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { createMatch, finalize, step } from '../../src/sim';
import { cloneTeam, syntheticTeam } from '../../src/sim/scenario';

const seed = Number(process.argv[2] ?? 1);
const data = loadGameData();
const rng = createRng(seed);
const a = syntheticTeam(data, rng, { idPrefix: 'A', tactic: (process.argv[3] ?? 'STEADY_MACRO') as never, ability: 60 });
const b = cloneTeam(a, 'B', (process.argv[4] ?? process.argv[3] ?? 'STEADY_MACRO') as never);
const s = createMatch({ seed, blue: a, red: b }, data);
const actions: Record<string, number> = {};
const bySide: Record<string, Record<string, number>> = { BLUE: {}, RED: {} };
while (!s.over) {
  step(s);
  for (const h of s.heroes) if (h.alive) { actions[h.action] = (actions[h.action] ?? 0) + 1; bySide[h.side]![h.action] = (bySide[h.side]![h.action] ?? 0) + 1; }
  if (s.t % 300 === 0) {
    const lv = s.heroes.map((h) => h.level).join(',');
    const gold = s.heroes.map((h) => Math.round(h.gold / 100) / 10).join(',');
    console.log(`t=${s.t / 60}m kills B${s.teams.BLUE.kills}-R${s.teams.RED.kills} towers B${s.teams.BLUE.towersDestroyed}-R${s.teams.RED.towersDestroyed} lv[${lv}] goldk[${gold}]`);
  }
}
const r = finalize(s);
console.log('winner', r.winner, 'dur', (r.durationSec / 60).toFixed(1));
for (const e of r.events) if (e.type === 'TOWER_DESTROYED' || e.type === 'OBJECTIVE_TAKEN' || e.type === 'BASE_DESTROYED') console.log(`  ${(e.t / 60).toFixed(1)}m ${e.type} ${e.side} ${e.detail?.towerName ?? e.detail?.objectiveName ?? ''} n=${e.actors.length}`);
for (const side of ['BLUE', 'RED']) { const tot = Object.values(bySide[side]!).reduce((x, y) => x + y, 0); console.log(side, Object.entries(bySide[side]!).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${(v / tot * 100).toFixed(0)}%`).join(' ')); }
const total = Object.values(actions).reduce((x, y) => x + y, 0);
console.log(Object.entries(actions).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${(v / total * 100).toFixed(1)}%`).join(' '));
const counts: Record<string, number> = {};
for (const e of r.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log(counts);
