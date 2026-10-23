import { useState } from 'react';
import { ROLES, type Role } from '../../core/types';
import { financeSummary, marketPlayers, releaseFee, releasePlayer, rosterOf, signPlayer } from '../../game';
import type { PageProps } from '../App';
import { Attrs, Form, Heroes, Ovr, Roles } from '../components/PlayerBits';
import { ROLE_NAME, money } from '../labels';

export function MarketPage({ game, data, act, go, flash, ask }: PageProps) {
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
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
    const r = act((d) => signPlayer(d, data, id));
    flash(r.ok ? `签下 ${p.name}，支付签约费 ${money(p.signingFee)}` : r.error);
  };
  const release = (id: string) => {
    const p = game.players[id]!;
    ask(`与 ${p.name} 解约需要支付违约金 ${money(releaseFee(data, p))}。`, '确认解约', () => {
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
          </div>
        </div>
        <p className="dim">签约费 = 4 周工资，签下后每周发工资。综合能力只是参考，比赛里起作用的是操作、意识、配合、心态和英雄熟练度。</p>
        <table className="table">
          <thead><tr><th>选手</th><th>位置</th><th>能力</th><th title="操作 / 意识 / 配合 / 心态">操作/意识/配合/心态</th><th>擅长英雄（熟练度）</th><th>周薪</th><th>签约费</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b> <span className="dim">{p.age}岁</span></td>
                <td><Roles p={p} /></td>
                <td><Ovr p={p} /></td>
                <td><Attrs p={p} /></td>
                <td><Heroes p={p} data={data} /></td>
                <td>{money(p.salaryPerWeek)}</td>
                <td>{money(p.signingFee)}</td>
                <td><button className="primary small" onClick={() => sign(p.id)} disabled={game.club.roster.length >= data.economy.maxRoster || game.funds < p.signingFee}>签约</button></td>
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
              <div><b>{p.name}</b> <Roles p={p} /> <Ovr p={p} /></div>
              <div className="dim">{money(p.salaryPerWeek)}/周 · <Form p={p} /></div>
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
