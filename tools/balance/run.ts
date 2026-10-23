// Runs the balance scenarios on worker threads and writes the Markdown report.
import { writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { loadGameData } from '../../src/core/config';
import { TACTICS, type Tactic } from '../../src/core/types';
import { runMatch } from '../../src/sim';
import { TACTIC_PAIRS, buildCase, type ScenarioId } from './scenarios';
import type { MatchRecord } from './worker';

interface Job { scenario: ScenarioId; from: number; to: number; repeat: boolean }

const TACTIC_NAME: Record<Tactic, string> = { EARLY_AGGRO: '前期猛攻', STEADY_MACRO: '稳健运营', TEAMFIGHT_PUSH: '团战推进', SPLIT_PUSH: '分带牵制' };

/** Runs the jobs on a pool of warm workers (one per thread), feeding each the next job when it finishes. */
function runJobs(jobs: Job[], threads: number): Promise<Map<ScenarioId, MatchRecord[]>> {
  const results = new Map<ScenarioId, MatchRecord[]>();
  let next = 0;
  let done = 0;
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const feed = (w: Worker) => {
      if (next >= jobs.length) { void w.terminate(); return; }
      const job = jobs[next++]!;
      w.once('message', (recs: MatchRecord[]) => {
        const list = results.get(job.scenario) ?? [];
        list.push(...recs);
        results.set(job.scenario, list);
        done++;
        if (process.stdout.isTTY) process.stdout.write(`\r  进度 ${done}/${jobs.length}`);
        if (done === jobs.length) { for (const x of workers) void x.terminate(); resolve(results); } else feed(w);
      });
      w.postMessage(job);
    };
    for (let i = 0; i < Math.min(threads, jobs.length); i++) {
      const w = new Worker(new URL('./worker-boot.mjs', import.meta.url), { workerData: { pool: true } });
      w.once('error', reject);
      workers.push(w);
      feed(w);
    }
  });
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rate = (rs: MatchRecord[]) => rs.filter((r) => r.focusWon).length / Math.max(1, rs.length);
const ci95 = (p: number, n: number) => 1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, n));

export interface BalanceOptions { n: number; threads?: number; only?: ScenarioId[]; write?: boolean }

export async function runBalance(opts: BalanceOptions): Promise<{ passed: boolean; markdown: string; path: string | null }> {
  const data = loadGameData();
  const threads = opts.threads ?? availableParallelism();
  const n = opts.n;
  const counts: Record<ScenarioId, number> = {
    G1: 50, G2: n, G3: n, G4: Math.max(TACTIC_PAIRS.length * 100, Math.ceil((n * 2.4) / TACTIC_PAIRS.length) * TACTIC_PAIRS.length),
    G5: n, G6: n, POOL: n,
  };
  const scenarios = (opts.only ?? (Object.keys(counts) as ScenarioId[]));
  const jobs: Job[] = [];
  const chunk = 25;
  for (const sc of scenarios) for (let i = 0; i < counts[sc]; i += chunk) jobs.push({ scenario: sc, from: i, to: Math.min(counts[sc], i + chunk), repeat: sc === 'G1' });
  // G2 runs alone first so its wall-clock time can serve as the G9 measurement.
  const g2Jobs = jobs.filter((j) => j.scenario === 'G2');
  const tg = performance.now();
  const res = g2Jobs.length > 0 ? await runJobs(g2Jobs, threads) : new Map<ScenarioId, MatchRecord[]>();
  const g9Wall = g2Jobs.length > 0 ? (performance.now() - tg) / 1000 : 0;
  const t0 = performance.now();
  const rest = jobs.filter((j) => j.scenario !== 'G2');
  if (rest.length > 0) for (const [k, v] of await runJobs(rest, threads)) res.set(k, v);
  const wallSec = (performance.now() - t0) / 1000 + g9Wall;
  if (process.stdout.isTTY) process.stdout.write('\n');
  for (const list of res.values()) list.sort((a, b) => a.i - b.i);
  const get = (id: ScenarioId) => res.get(id) ?? [];

  const rows: { id: string; what: string; value: string; target: string; pass: boolean | null }[] = [];
  // G1
  if (res.has('G1')) {
    const g1 = get('G1');
    const same = g1.filter((r) => r.checksum === r.repeatChecksum && r.eventsHash === r.repeatEventsHash).length;
    rows.push({ id: 'G1', what: '同 seed 同输入重跑', value: `${same}/${g1.length} 场完全一致`, target: '全部一致', pass: same === g1.length });
  }
  if (res.has('G2')) {
    const p = rate(get('G2'));
    rows.push({ id: 'G2', what: '完全相同的两队互打，蓝方胜率', value: `${pct(p)}（±${pct(ci95(p, get('G2').length))}）`, target: '45%–55%', pass: p >= 0.45 && p <= 0.55 });
  }
  if (res.has('G3')) {
    const p = rate(get('G3'));
    rows.push({ id: 'G3', what: '平均能力高 15 分的队伍胜率', value: `${pct(p)}（±${pct(ci95(p, get('G3').length))}）`, target: '65%–85%', pass: p >= 0.65 && p <= 0.85 });
  }
  let matrix: Record<string, Record<string, number>> | null = null;
  let matrixN: Record<string, number> = {};
  if (res.has('G4')) {
    matrix = {};
    matrixN = {};
    for (const a of TACTICS) { matrix[a] = {}; for (const b of TACTICS) matrix[a]![b] = a === b ? 0.5 : NaN; }
    for (const [a, b] of TACTIC_PAIRS) {
      const rs = get('G4').filter((r) => r.tags.a === a && r.tags.b === b);
      const p = rate(rs);
      matrix[a]![b] = p;
      matrix[b]![a] = 1 - p;
      matrixN[`${a}:${b}`] = rs.length;
    }
    const dominant = TACTICS.filter((a) => TACTICS.filter((b) => b !== a).every((b) => matrix![a]![b]! > 0.55));
    const best = Math.max(...TACTIC_PAIRS.map(([a, b]) => Math.max(matrix![a]![b]!, matrix![b]![a]!)));
    rows.push({
      id: 'G4', what: '四种战术互相对阵（其他条件相同）',
      value: `${dominant.length === 0 ? '没有万能战术' : `万能战术：${dominant.map((t) => TACTIC_NAME[t]).join('、')}`}；最强克制 ${pct(best)}`,
      target: '无战术对其余三种都 >55%；至少一组 ≥58%', pass: dominant.length === 0 && best >= 0.58,
    });
  }
  if (res.has('G5')) {
    const p = rate(get('G5'));
    rows.push({ id: 'G5', what: '英雄熟练度 90 对 40，熟练方胜率', value: `${pct(p)}（±${pct(ci95(p, get('G5').length))}）`, target: '≥58%', pass: p >= 0.58 });
  }
  if (res.has('G6')) {
    const p = 1 - rate(get('G6'));
    rows.push({ id: 'G6', what: '五人全打非擅长位置的队伍胜率', value: `${pct(p)}，比 50% 下降 ${((0.5 - p) * 100).toFixed(1)} 个百分点`, target: '下降 ≥8 个百分点', pass: 0.5 - p >= 0.08 });
  }
  const all = (['G2', 'G3', 'G4', 'G5', 'G6', 'POOL'] as ScenarioId[]).flatMap(get);
  const durs = all.map((r) => r.durationSec / 60).sort((a, b) => a - b);
  const q = (f: number) => durs[Math.min(durs.length - 1, Math.floor(f * durs.length))] ?? 0;
  if (all.length > 0) {
    const timeouts = all.filter((r) => r.timeout).length;
    const under45 = all.filter((r) => r.durationSec < 45 * 60).length / all.length;
    rows.push({
      id: 'G7', what: '比赛时长', value: `中位数 ${q(0.5).toFixed(1)} 分钟；${pct(under45)} 在 45 分钟内；超时判定 ${timeouts} 场`,
      target: '中位数 18–28；99% <45 分钟；无死循环', pass: q(0.5) >= 18 && q(0.5) <= 28 && under45 >= 0.99,
    });
    const bad = [...all, ...get('G1')].filter((r) => !r.reportOk);
    for (const b of bad.slice(0, 3)) console.error(`G8 failure: ${b.tags ? JSON.stringify(b.tags) : ''} i=${b.i}: ${b.reportError}`);
    rows.push({ id: 'G8', what: '战报', value: `${all.length + get('G1').length - bad.length}/${all.length + get('G1').length} 场生成合格战报`, target: '每场都有，原因都能对应事件', pass: bad.length === 0 });
  }
  // G9: wall-clock time of 1000 G2 matches through the worker pool (all cores), plus a
  // single-thread sample for reference.
  let singlePer1000 = 0;
  if (g9Wall > 0) {
    const sample = Math.min(50, counts.G2);
    const t1 = performance.now();
    for (let i = 0; i < sample; i++) runMatch(buildCase(data, 'G2', i).input, data);
    singlePer1000 = ((performance.now() - t1) / sample) * 1000 / 1000;
    const per1000 = (g9Wall / counts.G2) * 1000;
    rows.push({
      id: 'G9', what: `性能：1000 场耗时（${threads} 线程并行）`,
      value: `${per1000.toFixed(0)} 秒（单线程约 ${singlePer1000.toFixed(0)} 秒）`, target: '≤60 秒', pass: per1000 <= 60,
    });
  }

  // Markdown
  const md: string[] = [];
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const passed = rows.every((r) => r.pass !== false);

  md.push(`# 平衡报告 ${stamp}`, '');
  md.push(`> 命令：\`npm run sim -- --n ${n}\` · 共模拟 ${all.length + get('G1').length * 2} 场 · ${threads} 线程并行，实际用时 ${wallSec.toFixed(0)} 秒`, '');
  md.push(`**总结论**：${passed ? '✅ G1–G9 全部通过' : '❌ 有指标未通过'}`, '');
  md.push('| 编号 | 检查内容 | 实际结果 | 标准 | 结论 |', '|---|---|---|---|---|');
  for (const r of rows) md.push(`| ${r.id} | ${r.what} | ${r.value} | ${r.target} | ${r.pass === null ? '⚠️' : r.pass ? '✅' : '❌'} |`);
  md.push('');
  if (matrix) {
    md.push('## 战术对阵胜率（行对列，行方胜率）', '');
    md.push(`| | ${TACTICS.map((t) => TACTIC_NAME[t]).join(' | ')} |`, `|---|${TACTICS.map(() => '---').join('|')}|`);
    for (const a of TACTICS) md.push(`| **${TACTIC_NAME[a]}** | ${TACTICS.map((b) => (a === b ? '—' : pct(matrix![a]![b]!))).join(' | ')} |`);
    const perPair = Object.values(matrixN)[0] ?? 0;
    if (process.env.BALANCE_DEBUG) {
      for (const [a, b] of TACTIC_PAIRS) {
        const rs = get('G4').filter((r) => r.tags.a === a && r.tags.b === b);
        const avg = (f: (r: MatchRecord) => number) => rs.reduce((x, r) => x + f(r), 0) / Math.max(1, rs.length);
        md.push(`- ${TACTIC_NAME[a]} vs ${TACTIC_NAME[b]}: win ${pct(rate(rs))} gold@12 ${avg((r) => r.gold12).toFixed(0)} gold@20 ${avg((r) => r.gold20).toFixed(0)} dur ${(avg((r) => r.durationSec) / 60).toFixed(1)}m`);
      }
    }
    md.push('', `每组 ${perPair} 场，双方队员完全相同，只有战术不同，蓝红各占一半。误差约 ±${pct(ci95(0.5, perPair))}。`, '');
  }
  if (durs.length > 0) {
    md.push('## 比赛时长分布（分钟）', '');
    md.push('| 最短 | 10% | 中位数 | 90% | 99% | 最长 |', '|---|---|---|---|---|---|');
    md.push(`| ${q(0).toFixed(1)} | ${q(0.1).toFixed(1)} | ${q(0.5).toFixed(1)} | ${q(0.9).toFixed(1)} | ${q(0.99).toFixed(1)} | ${durs[durs.length - 1]!.toFixed(1)} |`, '');
    md.push(`平均每场击杀 ${(all.reduce((a, r) => a + r.kills, 0) / all.length).toFixed(1)} 次。`, '');
  }
  if (res.has('POOL')) {
    md.push('## 英雄出场胜率（随机阵容，双方能力相同）', '');
    md.push('| 英雄 | 定位 | 出场 | 胜率 |', '|---|---|---|---|');
    const stats = new Map<string, { n: number; w: number }>();
    for (const r of get('POOL')) for (const p of r.picks) { const s = stats.get(p.heroId) ?? { n: 0, w: 0 }; s.n++; if (p.won) s.w++; stats.set(p.heroId, s); }
    const arch: Record<string, string> = { TANK: '坦克', ASSASSIN: '刺客', MAGE: '法师', MARKSMAN: '射手', SUPPORT: '辅助' };
    for (const h of data.heroes) {
      const s = stats.get(h.id) ?? { n: 0, w: 0 };
      md.push(`| ${h.name} | ${arch[h.archetype]} | ${s.n} | ${s.n ? pct(s.w / s.n) : '—'} |`);
    }
    md.push('');
  }
  md.push('## 跑完耗时', '', `批量部分实际用时 ${wallSec.toFixed(1)} 秒（${threads} 线程并行）。`, '');
  if (singlePer1000 > 0) {
    md.push(`G9 = G2 的比赛用模拟工具实际跑完的时间，换算成 1000 场（工具默认用满全部 CPU 核心，见决策 D16）。单线程数字另外连跑 50 场换算，仅供参考。测量机器：${cpus()[0]?.model ?? '未知'}，${threads} 线程。`, '');
  }
  const markdown = md.join('\n');
  let path: string | null = null;
  if (opts.write !== false) {
    path = `docs/reports/balance-${stamp}.md`;
    writeFileSync(path, markdown);
  }
  return { passed, markdown, path };
}
