// Simulation command line.
//   npm run sim -- --one --seed 42 [--blue jinyu --red tianshu]   one match, zh-CN report
//   npm run sim -- --n 1000                                         balance report (T06)
import { loadGameData } from '../src/core/config';
import type { Tactic } from '../src/core/types';
import { runMatch } from '../src/sim';
import { describeEvent, formatTime, nameBook } from '../src/sim/events';
import { buildReport } from '../src/sim/report';
import { clubTeam } from '../src/sim/scenario';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const data = loadGameData();

function clubTactic(id: string): Tactic {
  const style = data.clubs.find((c) => c.id === id)?.style;
  if (!style) throw new Error(`unknown club ${id}; choose from ${data.clubs.map((c) => c.id).join(', ')}`);
  return style === 'RANDOM' ? 'STEADY_MACRO' : style;
}

function one(): void {
  const seed = Number(arg('seed') ?? 42);
  const blueId = arg('blue') ?? 'chaosheng';
  const redId = arg('red') ?? 'jinyu';
  const input = {
    seed,
    blue: clubTeam(data, blueId, (arg('blue-tactic') as Tactic | undefined) ?? clubTactic(blueId)),
    red: clubTeam(data, redId, (arg('red-tactic') as Tactic | undefined) ?? clubTactic(redId)),
  };
  const result = runMatch(input, data);
  const report = buildReport(result, input, data);
  const book = nameBook(input, data.heroes);
  const club = (id: string) => data.clubs.find((c) => c.id === id)!.name;
  console.log(`\n=== ${club(blueId)}（蓝） vs ${club(redId)}（红） · 种子 ${seed} ===`);
  console.log(`战术：蓝「${data.match.tactics[input.blue.lineup.tactic].name}」 红「${data.match.tactics[input.red.lineup.tactic].name}」`);
  console.log(`\n【${report.headline}】\n`);
  report.keyReasons.forEach((r, i) => {
    console.log(`${i + 1}. ${r.text}`);
    console.log(`   依据：${r.eventRefs.slice(0, 3).map((ei) => describeEvent(result.events[ei]!, book)).join(' / ')}`);
  });
  console.log('\n选手评分：');
  for (const side of ['BLUE', 'RED'] as const) {
    const rows = result.players.filter((p) => p.side === side);
    console.log(`  ${side === 'BLUE' ? '蓝' : '红'}：${rows.map((p) => `${book.player(p.playerId)}(${book.heroOf(p.playerId)}) ${p.kills}/${p.deaths}/${p.assists} ${p.rating.toFixed(1)}`).join('  ')}`);
  }
  console.log(`  MVP：${book.player(report.mvp)}`);
  console.log(`\n经济差（蓝-红）：${result.goldDiffTimeline.filter((p) => p.t % 300 === 0).map((p) => `${formatTime(p.t)} ${p.diff >= 0 ? '+' : ''}${p.diff}`).join('  ')}`);
  console.log('\n关键事件：');
  for (const e of result.events) {
    if (['TOWER_DESTROYED', 'OBJECTIVE_TAKEN', 'TEAMFIGHT_END', 'BASE_DESTROYED', 'OVERTIME', 'MATCH_END'].includes(e.type)) console.log(`  ${describeEvent(e, book)}`);
  }
  console.log(`\n时长 ${formatTime(result.durationSec)} · 事件 ${result.events.length} 条 · checksum ${result.checksum}`);
}

if (process.argv.includes('--one')) one();
else console.log('Balance report arrives in T06. Try: npm run sim -- --one --seed 42');
