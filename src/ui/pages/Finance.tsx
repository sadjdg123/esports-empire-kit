import { financeSummary, ledgerByWeek, rosterOf } from '../../game';
import type { PageProps } from '../App';
import { money } from '../labels';

export function FinancePage({ game, data }: PageProps) {
  const f = financeSummary(game, data);
  const weeks = ledgerByWeek(game);
  return (
    <div className="grid">
      <section className="card">
        <h2>财务概况</h2>
        <dl className="kv">
          <dt>当前资金</dt><dd className={game.funds < 0 ? 'bad' : ''}>{money(game.funds)}</dd>
          <dt>起始资金</dt><dd>{money(game.startingFunds)}</dd>
          <dt>每周工资</dt><dd>{money(f.weeklySalaries)}</dd>
          <dt>每周赞助</dt><dd>{money(f.weeklySponsor)}</dd>
          <dt>比赛奖金</dt><dd>胜 {money(data.economy.prizeWin)} / 负 {money(data.economy.prizeLoss)}</dd>
          <dt>不算奖金每周净变化</dt><dd className={f.weeklyNet < 0 ? 'bad' : 'good'}>{money(f.weeklyNet)}</dd>
          <dt>还能撑</dt><dd>{f.runwayWeeks === Infinity ? '不会亏空' : `${Math.floor(f.runwayWeeks)} 周`}</dd>
        </dl>
        {f.lowFunds && <p className="bad">资金低于 {data.economy.lowFundsWarningWeeks} 周工资，注意控制开销。资金为负时不能签人，但比赛照常进行。</p>}
        <h3>工资明细</h3>
        <ul className="plain">{rosterOf(game).map((p) => <li key={p.id}>{p.name}：{money(p.salaryPerWeek)}/周</li>)}</ul>
      </section>
      <section className="card wide">
        <h2>每周收支</h2>
        {weeks.length === 0 && <p className="dim">还没有收支记录。</p>}
        {weeks.map((w) => (
          <div key={w.week} className="ledger-week">
            <div className="row between"><b>{w.week < 0 ? '赛季开始前' : `第 ${w.week + 1} 周`}</b><span>收入 <span className="good">{money(w.income)}</span> · 支出 <span className="bad">{money(w.expense)}</span></span></div>
            <ul className="plain">{w.entries.map((e, i) => <li key={i}>{e.note}：<span className={e.amount < 0 ? 'bad' : 'good'}>{money(e.amount)}</span></li>)}</ul>
          </div>
        ))}
      </section>
    </div>
  );
}
