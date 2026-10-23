// Simulation command line.
//   npm run sim -- --one --seed 42 [--blue jinyu --red tianshu]   one match, zh-CN report
//   npm run sim -- --n 1000 [--threads 4] [--only G4,G5] [--no-write]  balance report (GDD 16.1)
//   npm run sim -- --economy [--n 100]                              economy calibration (T07, T16)
//   npm run sim -- --league [--seasons 20] [--seeds 8] [--write [--out file.md]]  multi-season league health (T17, T20)
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
  const threads = Number(arg('threads') ?? availableParallelism());
  type Rec = import('./balance/worker').EconomyRecord;
  const run = (strategy: 'value' | 'balanced' | 'star', n: number, seasons: number) => {
    const chunk = Math.ceil(n / threads);
    return Promise.all(Array.from({ length: threads }, (_, k) => new Promise<Rec[]>((resolve, reject) => {
      const w = new Worker(new URL('./balance/worker-boot.mjs', import.meta.url), { workerData: { mode: 'economy', strategy, seasons, from: k * chunk, to: Math.min(n, (k + 1) * chunk) } });
      w.once('message', resolve);
      w.once('error', reject);
    }))).then((parts) => parts.flat());
  };
  const quant = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return (f: number) => v[Math.min(v.length - 1, Math.floor(f * v.length))]!; };

  // 1) Normal management: one season from a new game, many seeds (GDD 8 calibration).
  const n = Number(arg('n') ?? 100);
  const normal = (await run('balanced', n, 1)).map((r) => r.seasons[0]!);
  const ratios = normal.map((r) => r.ratio);
  const q = quant(ratios);
  const inside = ratios.filter((x) => x >= 0.6 && x <= 1.5).length / ratios.length;
  const avg = (f: (r: (typeof normal)[number]) => number) => normal.reduce((a, r) => a + f(r), 0) / normal.length;
  console.log(`经济校准 1：普通经营（每个位置签周薪不超过每周收入五分之一的最强选手、签最好的赞助、每三周休息一周），${normal.length} 个赛季`);
  console.log(`  赛季末资金 / 起始资金：10% ${q(0.1).toFixed(2)} · 中位数 ${q(0.5).toFixed(2)} · 90% ${q(0.9).toFixed(2)}`);
  console.log(`  落在 60%–150% 的比例：${(inside * 100).toFixed(0)}%（标准 ≥80%） ${inside >= 0.8 ? '✅' : '❌'}`);
  console.log(`  平均胜场 ${avg((r) => r.wins).toFixed(1)}/10 · 平均排名 ${avg((r) => r.rank).toFixed(1)} · 平均周薪 ${avg((r) => r.salaries).toFixed(0)} · 签约后资金 ${avg((r) => r.afterSigning).toFixed(0)} · 赛季末声望 ${avg((r) => r.reputation).toFixed(0)}`);

  // 2) Big-spender management over several seasons: must neither run away nor sink without limit.
  const seasons = Number(arg('seasons') ?? 6);
  const rich = await run('star', Number(arg('rich') ?? 20), seasons);
  console.log(`经济校准 2：豪门经营（每个位置签买得起的最强选手），${rich.length} 局 × ${seasons} 个赛季，资金 / 起始资金的中位数：`);
  const medians: number[] = [];
  for (let k = 0; k < seasons; k++) {
    const qk = quant(rich.map((r) => r.seasons[k]!.ratio));
    const rep = rich.reduce((a, r) => a + r.seasons[k]!.reputation, 0) / rich.length;
    const champs = rich.filter((r) => r.seasons[k]!.playoff === 'CHAMPION').length;
    medians.push(qk(0.5));
    console.log(`  第 ${k + 1} 赛季末：中位数 ${qk(0.5).toFixed(2)}（10% ${qk(0.1).toFixed(2)} · 90% ${qk(0.9).toFixed(2)}） · 平均声望 ${rep.toFixed(0)} · 夺冠 ${champs}/${rich.length}`);
  }
  const lastSteps = medians.slice(-3).map((m, i, a) => (i === 0 ? 0 : m - a[i - 1]!)).slice(1);
  const bounded = medians.every((m) => m > -2 && m < 5) && lastSteps.every((d) => Math.abs(d) <= 0.5);
  console.log(`  有界（每个赛季中位数在 −2 到 5 倍之间，最后两个赛季每季变化不超过 ±0.5 倍）：${bounded ? '✅' : '❌'}`);
  process.exitCode = inside >= 0.8 && bounded ? 0 : 1;
}

async function league(): Promise<void> {
  const { availableParallelism } = await import('node:os');
  const { Worker } = await import('node:worker_threads');
  const seasons = Number(arg('seasons') ?? 20);
  const seeds = Number(arg('seeds') ?? 8);
  const threads = Math.min(seeds, Number(arg('threads') ?? availableParallelism()));
  const chunk = Math.ceil(seeds / threads);
  type Rec = import('./balance/worker').LeagueRecord;
  const t0 = Date.now();
  const rows = (await Promise.all(Array.from({ length: threads }, (_, k) => new Promise<Rec[]>((resolve, reject) => {
    const w = new Worker(new URL('./balance/worker-boot.mjs', import.meta.url), { workerData: { mode: 'league', seasons, from: k * chunk, to: Math.min(seeds, (k + 1) * chunk) } });
    w.once('message', resolve);
    w.once('error', reject);
  })))).flat();
  console.log(`联赛长期健康：${rows.length} 局 × ${seasons} 个赛季（玩家用"普通经营"），用时 ${Math.round((Date.now() - t0) / 1000)} 秒`);
  let ok = true;
  for (const r of rows) {
    const count = new Map<string, number>();
    for (const c of r.champions) count.set(c, (count.get(c) ?? 0) + 1);
    const top = Math.max(...count.values());
    const pass = r.minAiRoster >= 5 && r.aiFundsRatio.min > -1 && r.aiFundsRatio.max < 5 && count.size >= 3 && top / r.champions.length <= 0.6;
    ok &&= pass;
    console.log(`  局 ${r.seed + 1}：冠军 ${[...count].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' ')} · AI 最少 ${r.minAiRoster} 人 · AI 资金/起始 ${r.aiFundsRatio.min.toFixed(2)}～${r.aiFundsRatio.max.toFixed(2)} ${pass ? '✅' : '❌'}`);
  }
  const last = rows.map((r) => r.talent[r.talent.length - 1]!);
  const first = rows.map((r) => r.talent[0]!);
  const m = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
  console.log(`  人才（第 1 → 第 ${seasons} 赛季平均）：首发均值 ${m(first.map((t) => t.starterAvg))} → ${m(last.map((t) => t.starterAvg))} · 全联盟均值 ${m(first.map((t) => t.leagueAvg))} → ${m(last.map((t) => t.leagueAvg))} · 最强选手 ${m(first.map((t) => t.best))} → ${m(last.map((t) => t.best))} · 平均年龄 ${m(first.map((t) => t.avgAge))} → ${m(last.map((t) => t.avgAge))} · 自由市场 ${m(first.map((t) => t.marketSize))} → ${m(last.map((t) => t.marketSize))} 人`);
  // The player's money as a multiple of the starting money (median over the runs), T22.
  const start = 100000;
  const med = (xs: number[]) => { const v = [...xs].sort((a2, b2) => a2 - b2); return v[Math.floor(v.length / 2)]!; };
  const at = (k: number) => (med(rows.map((r) => r.playerFunds[k]!)) / start).toFixed(2);
  console.log(`  玩家资金（开局的倍数，各局中位数）：第 1 季 ${at(0)} · 第 5 季 ${at(Math.min(4, seasons - 1))} · 第 10 季 ${at(Math.min(9, seasons - 1))} · 第 ${seasons} 季 ${at(seasons - 1)}`);
  console.log(`  标准：AI 始终 ≥5 人；AI 资金在起始的 −1 倍到 5 倍之间；至少 3 家不同冠军；没有一家拿走超过 60% 的冠军 → ${ok ? '✅ 全部通过' : '❌ 有未通过'}`);
  process.exitCode = ok ? 0 : 1;
  if (process.argv.includes('--write')) {
    const { writeFileSync } = await import('node:fs');
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const path = arg('out') ?? `docs/reports/seasons-${day}.md`;
    const md: string[] = [`# ${seasons} 赛季长期运行报告 ${day}`, '', `> 命令：\`npm run sim -- --league --seasons ${seasons} --seeds ${seeds} --write\` · ${rows.length} 局，每局从新开档连续打 ${seasons} 个赛季，玩家俱乐部用"普通经营"自动策略`, ''];
    md.push('## 每局结果', '', '| 局 | 冠军分布 | AI 最少人数 | AI 资金 / 起始（最低～最高） | 结论 |', '|---|---|---|---|---|');
    for (const r of rows) {
      const count = new Map<string, number>();
      for (const c of r.champions) count.set(c, (count.get(c) ?? 0) + 1);
      const top = Math.max(...count.values());
      const pass = r.minAiRoster >= 5 && r.aiFundsRatio.min > -1 && r.aiFundsRatio.max < 5 && count.size >= 3 && top / r.champions.length <= 0.6;
      md.push(`| ${r.seed + 1} | ${[...count].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、')} | ${r.minAiRoster} | ${r.aiFundsRatio.min.toFixed(2)}～${r.aiFundsRatio.max.toFixed(2)} | ${pass ? '✅' : '⚠️'} |`);
    }
    md.push('', '## 逐赛季平均（所有局取平均）', '', '| 赛季 | 首发平均能力 | 在队选手能力 10% / 50% / 90% | 最强选手 | 平均年龄 | 自由市场人数 | 在队平均周薪 | 全联盟资金总量 | 玩家资金 |', '|---|---|---|---|---|---|---|---|---|');
    for (let k = 0; k < seasons; k++) {
      const t = rows.map((r) => r.talent[k]!);
      const a = (f: (x: (typeof t)[number]) => number) => t.reduce((s2, x) => s2 + f(x), 0) / t.length;
      const pf = rows.reduce((s2, r) => s2 + r.playerFunds[k]!, 0) / rows.length;
      md.push(`| ${k + 1} | ${a((x) => x.starterAvg).toFixed(1)} | ${a((x) => x.p10).toFixed(0)} / ${a((x) => x.p50).toFixed(0)} / ${a((x) => x.p90).toFixed(0)} | ${a((x) => x.best).toFixed(0)} | ${a((x) => x.avgAge).toFixed(1)} | ${a((x) => x.marketSize).toFixed(0)} | ${a((x) => x.avgSalary).toFixed(0)} | ${(a((x) => x.totalMoney) / 1000).toFixed(0)}k | ${(pf / 1000).toFixed(0)}k |`);
    }
    md.push('', '标准（T17/T20）：AI 始终 ≥5 人；AI 资金在起始的 −1 到 5 倍之间；至少 3 家不同冠军；没有一家拿走超过 60% 的冠军。人才和通胀看逐赛季表：能力分布、年龄、市场人数、周薪和资金总量不应一路单向失控。', '');
    writeFileSync(path, md.join('\n'));
    console.log(`  报告已写入 ${path}`);
  }
}

if (process.argv.includes('--one')) one();
else if (process.argv.includes('--league')) void league();
else if (process.argv.includes('--economy')) void economy();
else void balance();
