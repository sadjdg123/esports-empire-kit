import { useState } from 'react';
import { ROLES, type Role } from '../../core/types';
import { financeSummary, marketPlayers, releaseFeeFor, releasePlayer, rosterOf, signPlayer } from '../../game';
import type { PageProps } from '../App';
import { Attrs, Form, Heroes, Ovr, PlayerName, Roles, Traits } from '../components/PlayerBits';
import { ROLE_NAME, money } from '../labels';

export function MarketPage({ game, data, act, go, flash, ask, showPlayer }: PageProps) {
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const [years, setYears] = useState(data.economy.contracts.defaultYears);
  const [sort, setSort] = useState<'ovr' | 'salary' | 'value'>('ovr');
  const f = financeSummary(game, data);
  const roster = rosterOf(game);
  const ovr = (p: (typeof roster)[number]) => (p.attrs.mechanics + p.attrs.awareness + p.attrs.teamwork + p.attrs.mental) / 4;
  const list = marketPlayers(game)
    .filter((p) => role === 'ALL' || p.primaryRole === role || p.secondaryRole === role)
    .sort((a, b) => (sort === 'salary' ? a.salaryPerWeek - b.salaryPerWeek : sort === 'value' ? ovr(b) / Math.sqrt(b.salaryPerWeek) - ovr(a) / Math.sqrt(a.salaryPerWeek) : ovr(b) - ovr(a)));
  const covered = new Set(roster.map((p) => p.primaryRole));

  const sign = (id: string) => {
    const p = game.players[id]!;
    const r = act((d) => signPlayer(d, data, id, years));
    flash(r.ok ? `签下 ${p.name}（${years} 年），支付签约费 ${money(p.signingFee)}` : r.error);
  };
  const release = (id: string) => {
    const p = game.players[id]!;
    ask(`与 ${p.name} 解约需要支付违约金 ${money(releaseFeeFor(game, data, p))}。`, '确认解约', () => {
      const r = act((d) => releasePlayer(d, data, id));
      flash(r.ok ? `已与 ${p.name} 解约` : r.error);
    });
  };

  return (
    <div className="grid market">
      <section className="card wide">
        <div className="row between">
          <h2>自由市场</h2>
          <div className="filters">
            <button className={role === 'ALL' ? 'chip on' : 'chip'} onClick={() => setRole('ALL')}>全部</button>
            {ROLES.map((r) => <button key={r} className={role === r ? 'chip on' : 'chip'} onClick={() => setRole(r)}>{ROLE_NAME[r]}</button>)}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="ovr">按能力</option><option value="salary">按工资</option><option value="value">按性价比</option>
            </select>
            <select value={years} onChange={(e) => setYears(Number(e.target.value))} aria-label="合同年限">
              {Array.from({ length: data.economy.contracts.maxYears }, (_, i) => i + 1).map((y) => <option key={y} value={y}>签 {y} 年</option>)}
            </select>
          </div>
        </div>
        <p className="dim">签约费 = {data.economy.signingFeeWeeks} 周工资，签下后每周发工资。合同签到第 N 个赛季结束（含本赛季），到期前可以续约。新人和队友的默契从 0 开始。点名字看详情。</p>
        <table className="table">
          <thead><tr><th>选手</th><th>位置</th><th>能力</th><th className="hide-sm" title="操作 / 意识 / 配合 / 心态">操作/意识/配合/心态</th><th className="hide-sm">擅长英雄（熟练度）</th><th>周薪</th><th className="hide-sm">签约费</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><PlayerName p={p} show={showPlayer} /> <span className="dim">{p.age}岁</span> <Traits p={p} data={data} /></td>
                <td><Roles p={p} /></td>
                <td><Ovr p={p} /></td>
                <td className="hide-sm"><Attrs p={p} /></td>
                <td className="hide-sm"><Heroes p={p} data={data} /></td>
                <td>{money(p.salaryPerWeek)}</td>
                <td className="hide-sm">{money(p.signingFee)}</td>
                <td><button className="primary small" onClick={() => sign(p.id)} disabled={game.club.roster.length >= data.economy.maxRoster}>签约</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card side">
        <h3>我的队伍 {roster.length}/{data.economy.maxRoster}</h3>
        <p className="dim">至少 {data.economy.minRoster} 人才能比赛。还缺：{ROLES.filter((r) => !covered.has(r)).map((r) => ROLE_NAME[r]).join('、') || '无'}</p>
        <ul className="roster">
          {roster.map((p) => (
            <li key={p.id}>
              <div><PlayerName p={p} show={showPlayer} /> <Roles p={p} /> <Ovr p={p} /></div>
              <div className="dim">{money(p.salaryPerWeek)}/周 · 合同到第 {p.contractUntil} 季 · <Form p={p} /></div>
              <button className="link danger" onClick={() => release(p.id)}>解约</button>
            </li>
          ))}
        </ul>
        <div className="sum">每周工资 {money(f.weeklySalaries)}，赞助 {money(f.weeklySponsor)}</div>
        {roster.length >= data.economy.minRoster && <button className="primary" onClick={() => go('lineup')}>去设置阵容 →</button>}
      </section>
    </div>
  );
}
