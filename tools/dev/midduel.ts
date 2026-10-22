import { loadGameData } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { ROLES } from '../../src/core/types';
import { createMatch, step } from '../../src/sim';
import { cloneTeam, syntheticTeam } from '../../src/sim/scenario';
const data = loadGameData();
const [ha, hb] = [process.argv[2] ?? 'yexiao', process.argv[3] ?? 'xingzhu'];
const agg = { dA: 0, dB: 0, gA: 0, gB: 0, kA: 0, kB: 0 };
const n = 20;
for (let i = 0; i < n; i++) {
  const rng = createRng(100 + i);
  const heroes = { TOP: 'tieji', JUNGLE: 'feiren', MID: ha, ADC: 'zhufeng', SUPPORT: 'qingluo' };
  const A = syntheticTeam(data, rng, { idPrefix: 'A', tactic: 'STEADY_MACRO', ability: 60, heroes, mastery: 70 });
  const B = cloneTeam(A, 'B');
  const pick = B.lineup.picks.find((p) => p.role === 'MID')!;
  pick.heroId = hb;
  B.players.find((p) => p.id === pick.playerId)!.heroMastery = { [hb]: 70 };
  const s = createMatch({ seed: i, blue: A, red: B }, data);
  while (s.t < 600 && !s.over) step(s);
  const a = s.heroes[2]!, b = s.heroes[7]!;
  agg.dA += a.deaths; agg.dB += b.deaths; agg.gA += a.gold; agg.gB += b.gold; agg.kA += a.kills; agg.kB += b.kills;
}
console.log(`${ha} vs ${hb} @10min: deaths ${agg.dA / n} vs ${agg.dB / n}, kills ${agg.kA / n} vs ${agg.kB / n}, gold ${Math.round(agg.gA / n)} vs ${Math.round(agg.gB / n)}`);
void ROLES;
