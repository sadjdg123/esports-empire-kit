// Simulation command line.
//   npm run sim -- --one --seed 42 [--blue jinyu --red tianshu]   one match, zh-CN report
//   npm run sim -- --n 1000 [--threads 4] [--only G4,G5] [--no-write]  balance report (GDD 16.1)
//   npm run sim -- --economy [--n 100]                              economy calibration (T07)
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

async function balance(): Promise<void> {
  const { runBalance } = await import('./balance/run');
  const only = arg('only')?.split(',') as Parameters<typeof runBalance>[0]['only'];
  const threads = arg('threads') ? Number(arg('threads')) : undefined;
  const res = await runBalance({ n: Number(arg('n') ?? 1000), threads, only, write: !process.argv.includes('--no-write') && !only });
  console.log(res.markdown);
  if (res.path) console.log(`\n报告已写入 ${res.path}`);
  process.exitCode = res.passed ? 0 : 1;
}

async function economy(): Promise<void> {
  const { availableParallelism } = await import('node:os');
  const { Worker } = await import('node:worker_threads');
  const n = Number(arg('n') ?? 100);
  const threads = Number(arg('threads') ?? availableParallelism());
  const chunk = Math.ceil(n / threads);
  const parts = await Promise.all(Array.from({ length: threads }, (_, k) => new Promise<import('./balance/worker').EconomyRecord[]>((resolve, reject) => {
    const w = new Worker(new URL('./balance/worker-boot.mjs', import.meta.url), { workerData: { mode: 'economy', from: k * chunk, to: Math.min(n, (k + 1) * chunk) } });
    w.once('message', resolve);
    w.once('error', reject);
  })));
  const rows = parts.flat();
  const inside = rows.filter((r) => r.ratio >= 0.6 && r.ratio <= 1.5).length / rows.length;
  const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const q = (f: number) => ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))]!;
  const avg = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  console.log(`经济校准：${rows.length} 个赛季，策略 = 每个位置签性价比最高的选手 + 一键推荐阵容`);
  console.log(`赛季末资金 / 起始资金：10% ${q(0.1).toFixed(2)} · 中位数 ${q(0.5).toFixed(2)} · 90% ${q(0.9).toFixed(2)}`);
  console.log(`落在 60%–150% 的比例：${(inside * 100).toFixed(0)}%（标准 ≥80%） ${inside >= 0.8 ? '✅' : '❌'}`);
  console.log(`平均胜场 ${avg((r) => r.wins).toFixed(1)}/10 · 平均排名 ${avg((r) => r.rank).toFixed(1)} · 平均周薪 ${avg((r) => r.salaries).toFixed(0)} · 签约后资金 ${avg((r) => r.afterSigning).toFixed(0)}`);
  process.exitCode = inside >= 0.8 ? 0 : 1;
}

if (process.argv.includes('--one')) one();
else if (process.argv.includes('--economy')) void economy();
else void balance();
