// Dev: run many seasons and print the league's health per season.
//   npx tsx tools/dev/seasons.ts [seasons] [seed]
import { loadGameData } from '../../src/core/config';
import { PLAYER_CLUB_ID, advanceDay, autoManage, autoTraining, commitMatchDay, newGame, playerOverall, rosterOf } from '../../src/game';

const data = loadGameData();
const seasons = Number(process.argv[2] ?? 20);
const s = newGame('多赛季', '#3a7bd5', Number(process.argv[3] ?? 1), data);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
for (let k = 0; k < seasons; k++) {
  const m = autoManage(s, data, 'balanced');
  if (!m.ok) throw new Error(`season ${k + 1}: ${m.error}`);
  for (let guard = 0; guard < 400 && s.calendar.phase !== 'FINISHED'; guard++) {
    autoTraining(s);
    if (advanceDay(s, data).pause !== 'MATCH_DAY') continue;
    let c = commitMatchDay(s, data);
    if (!c.ok) { autoManage(s, data, 'balanced'); c = commitMatchDay(s, data); }
    if (!c.ok) throw new Error(c.error);
  }
  const h = s.history[s.history.length - 1]!;
  const clubs = s.aiClubs.map((c) => {
    const top5 = rosterOf(s, c.id).map(playerOverall).sort((a, b) => b - a).slice(0, 5);
    return `${c.shortName}:${c.roster.length}人/${Math.round(avg(top5))}/${Math.round(c.funds / 1000)}k/声${Math.round(c.reputation)}`;
  });
  const market = s.market.map((id) => s.players[id]!);
  const all = Object.values(s.players);
  console.log(`S${h.season} 冠军 ${h.champion === PLAYER_CLUB_ID ? '玩家' : s.aiClubs.find((c) => c.id === h.champion)?.shortName} | ${clubs.join(' ')} | 玩家 ${Math.round(s.funds / 1000)}k | 市场 ${market.length} 人 均 ${Math.round(avg(market.map(playerOverall)))} | 全联盟均 ${Math.round(avg(all.map(playerOverall)))} 最高 ${Math.round(Math.max(...all.map(playerOverall)))} 平均年龄 ${avg(all.map((p) => p.age)).toFixed(1)}`);
  advanceDay(s, data);
}
