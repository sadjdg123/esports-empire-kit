import { Fragment, useState } from 'react';
import { ROLES, type Player, type Role } from '../../core/types';
import {
  PLAYER_CLUB_ID, acceptRenewal, bidForPlayer, clubById, counterRenewal, declineRenewal, facilityValue, marketValue, negotiationFor, openNegotiation,
  playerOverall, releaseFeeFor, releasePlayer, renewalAsk, respondToOffer, rosterOf, transferWindowOpen,
} from '../../game';
import type { PageProps } from '../App';
import { Ovr, PlayerName, Roles } from '../components/PlayerBits';
import { ROLE_NAME, money } from '../labels';

function YearsPicker({ value, set, max }: { value: number; set: (v: number) => void; max: number }) {
  return (
    <select value={value} onChange={(e) => set(Number(e.target.value))} aria-label="合同年限">
      {Array.from({ length: max }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{y} 年</option>)}
    </select>
  );
}

/** Renewal talk with one expiring player. */
function Renewal({ p, props }: { p: Player; props: PageProps }) {
  const { game, data, act, flash } = props;
  const k = data.economy.contracts;
  const n = negotiationFor(game, p.id);
  const ask = n?.ask ?? renewalAsk(data, p, facilityValue(game, data, PLAYER_CLUB_ID, 'OFFICE'));
  const [years, setYears] = useState(k.defaultYears);
  const [offer, setOffer] = useState(() => Math.round((ask * 0.95) / 50) * 50);
  if (p.retiring) return <span className="bad">本赛季结束后退役</span>;
  if (n?.status === 'AGREED') return <span className="good">已续约到第 {p.contractUntil} 赛季</span>;
  if (n?.status === 'REFUSED') return <span className="bad">已谈崩，赛季结束后离队</span>;
  const accept = () => {
    const r = act((d) => acceptRenewal(d, data, p.id, years));
    flash(r.ok ? `${p.name} 续约 ${years} 年，周薪 ${money(ask)}` : r.error);
  };
  const counter = () => {
    const r = act((d) => counterRenewal(d, data, p.id, offer, years));
    flash(!r.ok ? r.error : r.value.accepted ? `${p.name} 接受了你的还价：周薪 ${money(offer)}` : `${p.name} 拒绝了还价，有点不高兴。现在只能接受原价或放弃。`);
  };
  const decline = () => props.ask(`不和 ${p.name} 续约？他会在本赛季结束后离队，士气也会下降。`, '不续约', () => {
    const r = act((d) => { const o = openNegotiation(d, data, p.id); return o.ok ? declineRenewal(d, data, p.id) : o; });
    flash(r.ok ? `已放弃续约 ${p.name}` : r.error);
  });
  return (
    <div className="renewal">
      <div>他想要周薪 <b>{money(ask)}</b>（现在 {money(p.salaryPerWeek)}）</div>
      <div className="row">
        <YearsPicker value={years} set={setYears} max={k.maxYears} />
        <button className="primary small" onClick={accept}>接受开价</button>
        {!n?.countered && (
          <>
            <input type="number" inputMode="numeric" step={50} min={0} value={offer} onChange={(e) => setOffer(Number(e.target.value))} aria-label="还价周薪" className="num" />
            <button className="small" onClick={counter}>还价一次</button>
          </>
        )}
        <button className="small link danger" onClick={decline}>不续约</button>
      </div>
      {n?.countered && <div className="dim small-text">还价机会已经用掉了。</div>}
    </div>
  );
}

function Bid({ p, props }: { p: Player; props: PageProps }) {
  const { game, data, act, flash } = props;
  const value = marketValue(data, p);
  const [fee, setFee] = useState(Math.round((value * 1.2) / 500) * 500);
  const bid = () => props.ask(`向${clubById(game, p.clubId!).name}报价 ${money(fee)} 买 ${p.name}？成交后合同照旧：周薪 ${money(p.salaryPerWeek)}，到第 ${p.contractUntil} 赛季。`, '报价', () => {
    const r = act((d) => bidForPlayer(d, data, p.id, fee));
    flash(!r.ok ? r.error : r.value.accepted ? `成交！${p.name} 加入你的俱乐部` : `报价被拒：${r.value.reason}`);
  });
  return (
    <span className="row nowrap">
      <input type="number" inputMode="numeric" step={500} min={0} value={fee} onChange={(e) => setFee(Number(e.target.value))} aria-label="报价" className="num" />
      <button className="primary small" onClick={bid} disabled={game.funds < fee || game.club.roster.length >= data.economy.maxRoster}>报价</button>
    </span>
  );
}

export function ContractsPage(props: PageProps) {
  const { game, data, act, flash, ask, showPlayer } = props;
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const roster = rosterOf(game).sort((a, b) => (a.contractUntil ?? 99) - (b.contractUntil ?? 99) || playerOverall(b) - playerOverall(a));
  const season = game.calendar.season;
  const pending = game.offers.filter((o) => o.seller === PLAYER_CLUB_ID && o.status === 'PENDING');
  const windowOpen = transferWindowOpen(game);
  const targets = game.aiClubs.flatMap((c) => rosterOf(game, c.id))
    .filter((p) => role === 'ALL' || p.primaryRole === role)
    .sort((a, b) => playerOverall(b) - playerOverall(a));

  const release = (p: Player) => ask(`与 ${p.name} 解约需要支付违约金 ${money(releaseFeeFor(game, data, p))}（按剩余合同算）。`, '确认解约', () => {
    const r = act((d) => releasePlayer(d, data, p.id));
    flash(r.ok ? `已与 ${p.name} 解约` : r.error);
  });
  const answer = (id: number, accept: boolean) => {
    const o = game.offers.find((x) => x.id === id)!;
    const run = () => { const r = act((d) => respondToOffer(d, data, id, accept)); flash(r.ok ? (accept ? `卖出成功，收到 ${money(o.fee)}` : '已拒绝报价') : r.error); };
    if (accept) ask(`确认把 ${game.players[o.playerId]!.name} 卖给${clubById(game, o.buyer).name}，转会费 ${money(o.fee)}？`, '确认卖出', run);
    else run();
  };

  return (
    <div className="grid">
      <section className="card wide">
        <h2>我的合同</h2>
        <p className="dim">合同签到某个赛季结束。最后一个赛季可以谈续约：可以接受、还价一次或放弃；不续约的人赛季结束后离队。</p>
        <table className="table">
          <thead><tr><th>选手</th><th>能力</th><th className="hide-sm">年龄</th><th>周薪</th><th>合同</th><th className="hide-sm">身价</th><th /></tr></thead>
          <tbody>
            {roster.map((p) => {
              const expiring = p.contractUntil !== undefined && p.contractUntil <= season;
              const talk = expiring && game.calendar.phase !== 'FINISHED';
              return (
                <Fragment key={p.id}>
                  <tr className={expiring ? 'expiring' : ''}>
                    <td><PlayerName p={p} show={showPlayer} /> <span className="dim small-text">{ROLE_NAME[p.primaryRole]}</span></td>
                    <td><Ovr p={p} /></td>
                    <td className="hide-sm">{p.age}</td>
                    <td>{money(p.salaryPerWeek)}</td>
                    <td>{p.contractUntil ? `到第 ${p.contractUntil} 季` : '—'}{expiring && <div className="warn-text small-text">本赛季到期</div>}</td>
                    <td className="hide-sm">{money(marketValue(data, p))}</td>
                    <td>{!talk && <button className="link danger small" onClick={() => release(p)}>解约</button>}</td>
                  </tr>
                  {talk && <tr className="expiring renewal-row"><td colSpan={7}><Renewal p={p} props={props} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {roster.length === 0 && <p className="dim">还没有选手。</p>}
      </section>

      <section className="card">
        <h3>别人的报价</h3>
        {pending.length === 0 ? <p className="dim">{windowOpen ? '目前没有俱乐部向你报价。' : '转会窗口关闭中，休赛期才会有报价。'}</p> : (
          <ul className="plain offers">
            {pending.map((o) => {
              const p = game.players[o.playerId]!;
              return (
                <li key={o.id}>
                  <div><b>{clubById(game, o.buyer).name}</b> 想买 <PlayerName p={p} show={showPlayer} />：<b>{money(o.fee)}</b> <span className="dim">（身价约 {money(marketValue(data, p))}）</span></div>
                  <button className="primary small" onClick={() => answer(o.id, true)}>接受</button>
                  <button className="small" onClick={() => answer(o.id, false)}>拒绝</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card wide">
        <div className="row between">
          <h2>转会市场</h2>
          <div className="filters">
            <button className={role === 'ALL' ? 'chip on' : 'chip'} onClick={() => setRole('ALL')}>全部</button>
            {ROLES.map((r) => <button key={r} className={role === r ? 'chip on' : 'chip'} onClick={() => setRole(r)}>{ROLE_NAME[r]}</button>)}
          </div>
        </div>
        {!windowOpen ? (
          <p className="dim">转会窗口只在休赛期（每个赛季的前 {data.season.preseasonWeeks} 周）开放。现在可以先看看，开窗后再报价。</p>
        ) : (
          <p className="dim">向其他俱乐部报价买人。首发比替补贵，只剩 {data.economy.minRoster} 人的俱乐部不卖。转会费付给对方，合同跟着人走。</p>
        )}
        <table className="table">
          <thead><tr><th>选手</th><th className="hide-sm">俱乐部</th><th className="hide-sm">位置</th><th>能力</th><th className="hide-sm">年龄</th><th className="hide-sm">周薪</th><th>身价</th>{windowOpen && <th />}</tr></thead>
          <tbody>
            {targets.map((p) => (
              <tr key={p.id}>
                <td><PlayerName p={p} show={showPlayer} /><div className="dim small-text show-sm">{clubById(game, p.clubId!).shortName} · {ROLE_NAME[p.primaryRole]}</div></td>
                <td className="hide-sm">{clubById(game, p.clubId!).name}</td>
                <td className="hide-sm"><Roles p={p} /></td>
                <td><Ovr p={p} /></td>
                <td className="hide-sm">{p.age}</td>
                <td className="hide-sm">{money(p.salaryPerWeek)}</td>
                <td>{money(marketValue(data, p))}</td>
                {windowOpen && <td><Bid p={p} props={props} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
