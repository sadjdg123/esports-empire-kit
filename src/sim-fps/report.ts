// Shooter division: the after-match report. Every reason is counted from the round log.

import type { FpsConfig, FpsMatchInput, FpsMatchResult, FpsReport, FpsSide } from './types';

type Core = Pick<FpsMatchResult, 'winner' | 'score' | 'rounds' | 'stats'>;

export function buildFpsReport(cfg: FpsConfig, input: FpsMatchInput, r: Core): FpsReport {
  const w = r.winner;
  const l: FpsSide = w === 'BLUE' ? 'RED' : 'BLUE';
  const team = (s: FpsSide) => (s === 'BLUE' ? input.blue : input.red);
  const reasons: { weight: number; text: string }[] = [];
  const count = (f: (round: Core['rounds'][number], s: FpsSide) => boolean, s: FpsSide) => r.rounds.filter((x) => f(x, s)).length;

  // Opening duels.
  const openings = (s: FpsSide) => r.rounds.reduce((a, x) => a + x.events.filter((e) => e.type === 'KILL' && e.opening && e.side === s).length, 0);
  const ow = openings(w), ol = openings(l);
  if (ow > ol) reasons.push({ weight: (ow - ol) * 1.2, text: `首杀 ${ow} 比 ${ol}：先开枪的那一下赢得多，回合就好打` });
  // Trades.
  const trades = (s: FpsSide) => r.stats.filter((p) => p.side === s).reduce((a, p) => a + p.trades, 0);
  if (trades(w) > trades(l) + 1) reasons.push({ weight: trades(w) - trades(l), text: `补枪 ${trades(w)} 比 ${trades(l)}：队友倒了马上有人换掉对面` });
  // The tactic.
  const edge = cfg.tacticEdge[team(w).tactic]?.[team(l).tactic] ?? 0;
  if (edge > 0) reasons.push({ weight: 3, text: `打法对路：「${cfg.tactics[team(w).tactic].name}」克制对面的「${cfg.tactics[team(l).tactic].name}」` });
  // Rounds won with worse equipment.
  const rank = (id: string) => cfg.economy.loadouts.findIndex((x) => x.id === id);
  const upset = count((x, s) => x.winner === s && rank(x.buy[s]) < rank(x.buy[s === 'BLUE' ? 'RED' : 'BLUE']), w);
  if (upset >= 2) reasons.push({ weight: upset * 1.5, text: `${upset} 个回合装备不如对面还赢了，把对面的经济打崩` });
  // Clutches.
  const clutches = r.stats.filter((p) => p.side === w && p.clutches > 0);
  if (clutches.length > 0) {
    const best = [...clutches].sort((a, b) => b.clutches - a.clutches)[0]!;
    reasons.push({ weight: best.clutches * 2, text: `${best.name} 打出 ${best.clutches} 次一打多的残局` });
  }
  // Attack and defence halves.
  const attWon = count((x, s) => x.winner === s && x.attackers === s, w);
  const defWon = count((x, s) => x.winner === s && x.attackers !== s, w);
  if (defWon >= attWon + 3) reasons.push({ weight: defWon - attWon, text: `防守 ${defWon} 个回合守住了，点位站得稳` });
  if (attWon >= defWon + 3) reasons.push({ weight: attWon - defWon, text: `进攻 ${attWon} 个回合打进去了，攻点很果断` });
  // Players out of position on the losing side.
  const off = team(l).players.filter((p) => p.role !== p.primaryRole && p.role !== p.secondaryRole);
  if (off.length > 0) reasons.push({ weight: off.length * 1.5, text: `对面有 ${off.length} 人打的不是自己的位置` });
  // A fallback so there is always something to read.
  const top = [...r.stats].filter((p) => p.side === w).sort((a, b) => b.rating - a.rating)[0]!;
  reasons.push({ weight: 0.5, text: `${top.name}（${cfg.roles[top.role].name}）${top.kills} 杀 ${top.deaths} 死，全场最佳` });

  const mvp = [...r.stats].sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))[0]!;
  const close = r.score[w] - r.score[l] <= 2;
  return {
    headline: `${team(w).name} ${r.score[w]}:${r.score[l]} ${close ? '险胜' : '击败'}${team(l).name}`,
    keyReasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 3).map((x) => x.text),
    mvp: mvp.id,
  };
}
