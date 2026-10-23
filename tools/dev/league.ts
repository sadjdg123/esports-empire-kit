// Dev: league health over many seasons for several seeds (T17 acceptance numbers).
//   npx tsx tools/dev/league.ts [seasons] [seeds]
import { loadGameData } from '../../src/core/config';
import { PLAYER_CLUB_ID, advanceDay, autoManage, autoTraining, commitMatchDay, newGame } from '../../src/game';

const data = loadGameData();
const seasons = Number(process.argv[2] ?? 20);
const seeds = Number(process.argv[3] ?? 3);
for (let seed = 1; seed <= seeds; seed++) {
  const s = newGame('多赛季', '#3a7bd5', seed, data);
  const start = Object.fromEntries(s.aiClubs.map((c) => [c.id, c.funds]));
  let minRoster = 99;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < seasons; k++) {
    autoManage(s, data, 'balanced');
    for (let guard = 0; guard < 400 && s.calendar.phase !== 'FINISHED'; guard++) {
      autoTraining(s);
      for (const c of s.aiClubs) minRoster = Math.min(minRoster, c.roster.length);
      if (advanceDay(s, data).pause !== 'MATCH_DAY') continue;
      let c = commitMatchDay(s, data);
      if (!c.ok) { autoManage(s, data, 'balanced'); c = commitMatchDay(s, data); }
      if (!c.ok) throw new Error(c.error);
    }
    for (const c of s.aiClubs) { lo = Math.min(lo, c.funds / start[c.id]!); hi = Math.max(hi, c.funds / start[c.id]!); }
    advanceDay(s, data);
  }
  const champs = new Map<string, number>();
  for (const h of s.history) champs.set(h.champion === PLAYER_CLUB_ID ? '玩家' : s.aiClubs.find((c) => c.id === h.champion)!.shortName, (champs.get(h.champion === PLAYER_CLUB_ID ? '玩家' : s.aiClubs.find((c) => c.id === h.champion)!.shortName) ?? 0) + 1);
  console.log(`seed ${seed}: 冠军 ${[...champs].map(([k, v]) => `${k}${v}`).join(' ')} | AI 最少人数 ${minRoster} | AI 资金/起始 最低 ${lo.toFixed(2)} 最高 ${hi.toFixed(2)} | 赛季末 ${s.aiClubs.map((c) => `${c.shortName}${Math.round(c.funds / 1000)}k`).join(' ')}`);
}
