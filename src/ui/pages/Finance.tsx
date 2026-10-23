import { useState } from 'react';
import {
  activeSponsor, cashForecast, financeSummary, ledgerByWeek, rescueOptions, rosterOf, signSponsor, sponsorOffers, sponsorStanding, weeklyMoney,
} from '../../game';
import type { PageProps } from '../App';
import { money } from '../labels';

function tierOf(rep: number, tiers: { tier: number; minReputation: number }[]): number {
  return tiers.filter((t) => t.minReputation <= rep).reduce((a, t) => Math.max(a, t.tier), 1);
}

export function FinancePage({ game, data, act, flash, ask }: PageProps) {
  const f = financeSummary(game, data);
  const m = weeklyMoney(game, data);
  const fin = data.economy.finance;
  const weeks = [...ledgerByWeek(game)].reverse();
  const forecast = cashForecast(game, data);
  const tips = rescueOptions(game, data);
  const current = activeSponsor(game);
  const offers = sponsorOffers(game, data);
  const [years, setYears] = useState(1);
  // The office lowers what the sponsor tiers ask for (T22).
  const standing = sponsorStanding(game, data);
  const officeBonus = standing - game.club.reputation;
  const tier = tierOf(standing, fin.sponsorTiers);
  const nextTier = fin.sponsorTiers.find((t) => t.minReputation > standing);

  const sign = (id: string, name: string, emergency: boolean) => {
    const text = emergency ? `接受应急赞助“${name}”？会替换现在的赞助，之后每周只有 ${money(fin.emergencySponsor.weekly)}，到本赛季结束。` : `和“${name}”签 ${years} 年赞助？合同期内不能换。`;
    ask(text, '签约', () => {
      const r = act((d) => signSponsor(d, data, id, years));
      flash(r.ok ? `已签下赞助：${name}` : r.error);
    });
  };

  return (
    <div className="grid">
      <section className="card">
        <h2>财务概况</h2>
        <dl className="kv">
          <dt>当前资金</dt><dd className={game.funds < 0 ? 'bad' : ''}>{money(game.funds)}</dd>
          <dt>声望</dt><dd>{Math.round(game.club.reputation)}{officeBonus > 0 ? `（办公室 +${officeBonus}）` : ''}（可签第 {tier} 档赞助{nextTier ? `，${nextTier.minReputation - officeBonus} 起第 ${nextTier.tier} 档` : ''}）</dd>
          <dt>每周工资</dt><dd className="bad">{money(-m.salaries)}</dd>
          <dt>赞助</dt><dd className="good">{money(m.sponsor)}</dd>
          <dt>联赛分成</dt><dd className="good">{money(m.league)}{m.league === 0 ? '（休赛期没有）' : ''}</dd>
          <dt>周边收入</dt><dd className="good">{money(m.merch)}</dd>
          <dt>训练开销</dt><dd className="bad">{money(-m.training)}</dd>
          {m.upkeep > 0 && <><dt>设施维护</dt><dd className="bad">{money(-m.upkeep)}</dd></>}
          <dt>每周净变化（不含奖金）</dt><dd className={f.weeklyNet < 0 ? 'bad' : 'good'}>{money(f.weeklyNet)}</dd>
          <dt>比赛奖金</dt><dd>胜 {money(data.economy.prizeWin)} / 负 {money(data.economy.prizeLoss)}</dd>
          <dt>季后赛奖金</dt><dd>冠军 {money(fin.playoffPrize.champion)} · 亚军 {money(fin.playoffPrize.final)} · 四强 {money(fin.playoffPrize.semi)}</dd>
        </dl>
        {tips.length > 0 && (
          <div className="todo">
            <b className="bad">资金偏低，可以这样做：</b>
            <ul>{tips.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="card">
        <h2>赞助</h2>
        {current ? (
          <p>当前：<b>{current.name}</b>，每周 {money(current.weekly)}，每赢一场 +{money(current.winBonus)}，到第 {current.untilSeason} 赛季。</p>
        ) : (
          <p className="warn-text">还没有赞助商。常规赛开始时如果还没选，会自动签能签到的最好一家（1 个赛季）。</p>
        )}
        <div className="row"><span className="dim">合同年限</span>
          <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {Array.from({ length: fin.sponsorMaxYears }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{y} 年</option>)}
          </select>
        </div>
        <ul className="plain sponsors">
          {offers.map((s) => {
            const emergency = s.id === fin.emergencySponsor.id;
            return (
              <li key={s.id} className={emergency ? 'emergency' : ''}>
                <div><b>{s.name}</b> 每周 {money(s.weekly)} · 每胜 +{money(s.winBonus)}{s.signingBonus > 0 ? ` · 签约金 ${money(s.signingBonus)}` : ''}</div>
                <button className={emergency ? 'small' : 'primary small'} disabled={!!current && !emergency} onClick={() => sign(s.id, s.name, emergency)}>{emergency ? '接受应急赞助' : '签约'}</button>
              </li>
            );
          })}
        </ul>
        {current && <p className="dim small-text">合同到期后才能换赞助（应急赞助除外）。声望越高，能签的赞助越好。</p>}
      </section>

      <section className="card">
        <h2>未来 {fin.forecastWeeks} 周预测</h2>
        {forecast.length === 0 ? <p className="dim">赛季已经结束。</p> : (
          <table className="table compact">
            <thead><tr><th>周</th><th>比赛</th><th>收入</th><th>支出</th><th>周末资金</th></tr></thead>
            <tbody>
              {forecast.map((w) => (
                <tr key={w.week}><td>第 {w.week + 1} 周</td><td>{w.matches}</td><td className="good">{money(w.income)}</td><td className="bad">{money(w.expense)}</td><td className={w.fundsAfter < 0 ? 'bad' : ''}>{money(w.fundsAfter)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="dim small-text">比赛奖金按一半赢一半输估算。</p>
        <h3>工资明细</h3>
        <ul className="plain">{rosterOf(game).map((p) => <li key={p.id}>{p.name}：{money(p.salaryPerWeek)}/周</li>)}</ul>
      </section>

      <section className="card wide">
        <h2>每周收支（本赛季）</h2>
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
