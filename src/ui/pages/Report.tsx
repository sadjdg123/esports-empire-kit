import { clubById, nextPlayerFixture, seasonOver, type StoredReport, type WeekSummary } from '../../game';
import type { PageProps } from '../App';
import { minutes, money } from '../labels';

function GoldChart({ timeline }: { timeline: StoredReport['goldDiffTimeline'] }) {
  if (timeline.length < 2) return null;
  const w = 560;
  const h = 140;
  const maxT = timeline[timeline.length - 1]!.t;
  const maxAbs = Math.max(1000, ...timeline.map((p) => Math.abs(p.diff)));
  const x = (t: number) => (t / maxT) * w;
  const y = (d: number) => h / 2 - (d / maxAbs) * (h / 2 - 8);
  const pts = timeline.map((p) => `${x(p.t).toFixed(1)},${y(p.diff).toFixed(1)}`).join(' ');
  return (
    <div className="gold-chart-wrap">
      <div className="gold-labels"><span>我方领先 +{Math.round(maxAbs)}</span><span>{minutes(maxT)}</span></div>
      <svg className="gold-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="经济差曲线">
        <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="axis" />
        <polyline points={pts} className="line" />
      </svg>
      <div className="gold-labels"><span>我方落后 -{Math.round(maxAbs)}</span></div>
    </div>
  );
}

export function ReportPage({ game, data, go, round, lastWeek }: PageProps & { round: number | null; lastWeek: WeekSummary | null }) {
  if (game.reports.length === 0) return <section className="card"><h2>战报</h2><p>还没有比赛。</p></section>;
  const rep = game.reports.find((r) => r.round === round) ?? game.reports[game.reports.length - 1]!;
  const opp = clubById(game, rep.opponent);
  const name = (id: string) => game.players[id]?.name ?? id;
  const mine = new Set(game.club.roster);
  const ratings = [...rep.ratings].sort((a, b) => b.rating - a.rating);
  const next = nextPlayerFixture(game, data);
  const nextOpp = next ? clubById(game, next.opponent) : null;
  const week = lastWeek && lastWeek.round === rep.round ? lastWeek : null;
  const prize = rep.won ? data.economy.prizeWin : data.economy.prizeLoss;

  return (
    <div className="grid">
      <section className={`card wide report ${rep.won ? 'won' : 'lost'}`}>
        <div className="row between">
          <h2>{rep.stage === 'SEMI' ? '半决赛' : rep.stage === 'FINAL' ? '总决赛' : `第 ${rep.round + 1} 轮`} · {rep.won ? '胜利' : '失利'} · 对阵 {opp.name}</h2>
          <select value={rep.round} onChange={(e) => go('report', { reportRound: Number(e.target.value) })}>
            {game.reports.map((r) => <option key={r.round} value={r.round}>{r.stage === 'SEMI' ? '半决赛' : r.stage === 'FINAL' ? '总决赛' : `第 ${r.round + 1} 轮`} {r.won ? '胜' : '负'}</option>)}
          </select>
        </div>
        <p className="headline">{rep.headline}</p>
        <p className="dim">比赛时长 {minutes(rep.durationSec)} · 击杀 {rep.kills.mine} : {rep.kills.theirs}</p>
        <h3>关键原因</h3>
        <ol className="reasons">{rep.keyReasons.map((k, i) => <li key={i}>{k.text}</li>)}</ol>
        <h3>经济差</h3>
        <GoldChart timeline={rep.goldDiffTimeline} />
      </section>
      <section className="card">
        <h3>选手评分</h3>
        <table className="table compact">
          <thead><tr><th>选手</th><th>评分</th></tr></thead>
          <tbody>
            {ratings.map((r) => (
              <tr key={r.playerId} className={mine.has(r.playerId) ? 'me' : ''}>
                <td>{name(r.playerId)}{r.playerId === rep.mvp ? ' 🏆MVP' : ''}</td><td>{r.rating.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>结算</h3>
        <p>比赛奖金 <span className="good">{money(prize)}</span></p>
        {week && <p>本周资金 {money(week.fundsBefore)} → <b>{money(week.fundsAfter)}</b></p>}
        {week && <ul className="plain">{week.lines.map((l, i) => <li key={i}>{l.note}：<span className={l.amount < 0 ? 'bad' : 'good'}>{money(l.amount)}</span></li>)}</ul>}
        {seasonOver(game) ? (
          <p><b>赛季结束！</b>去主页看最终排名。</p>
        ) : nextOpp && <p>下一场：<b>{nextOpp.name}</b>。小目标：{rep.won ? '保持连胜，冲进前三' : '调整阵容或战术，拿下下一场'}。</p>}
        <button className="primary" onClick={() => go('home')}>返回主页</button>
      </section>
    </div>
  );
}
