import { useEffect, useState } from 'react';
import { PLAYER_CLUB_ID, clubById, marketValue, respondToOffer, type InboxMessage } from '../../game';
import type { PageProps } from '../App';
import { money } from '../labels';

const KIND_NAME: Record<InboxMessage['kind'], string> = { INFO: '通知', MATCH: '比赛', OFFER: '报价', CONTRACT: '合同', FINANCE: '财务', SEASON: '赛季' };

export function InboxPage(props: PageProps) {
  const { game, data, act, go, flash, ask } = props;
  const [filter, setFilter] = useState<InboxMessage['kind'] | 'ALL'>('ALL');
  // Opening the inbox marks everything as read (the list below still shows what was new).
  const [unreadIds] = useState(() => new Set(game.inbox.filter((m) => !m.read).map((m) => m.id)));
  useEffect(() => {
    if (unreadIds.size === 0) return;
    act((d) => { for (const m of d.inbox) m.read = true; return { ok: true, value: undefined }; });
  }, [act, unreadIds]);

  const list = [...game.inbox].reverse().filter((m) => filter === 'ALL' || m.kind === filter);
  const answer = (offerId: number, accept: boolean) => {
    const o = game.offers.find((x) => x.id === offerId)!;
    const p = game.players[o.playerId]!;
    const run = () => {
      const r = act((d) => respondToOffer(d, data, offerId, accept));
      flash(r.ok ? (accept ? `${p.name} 已转会，收到 ${money(o.fee)}` : '已拒绝报价') : r.error);
    };
    if (accept) ask(`把 ${p.name} 以 ${money(o.fee)} 卖给${clubById(game, o.buyer).name}？他的身价约 ${money(marketValue(data, p))}。`, '确认卖出', run);
    else run();
  };

  return (
    <section className="card inbox">
      <div className="row between">
        <h2>收件箱</h2>
        <div className="filters">
          {(['ALL', 'OFFER', 'CONTRACT', 'FINANCE', 'MATCH', 'SEASON'] as const).map((k) => (
            <button key={k} className={filter === k ? 'chip on' : 'chip'} onClick={() => setFilter(k)}>{k === 'ALL' ? '全部' : KIND_NAME[k]}</button>
          ))}
        </div>
      </div>
      {list.length === 0 && <p className="dim">没有消息。</p>}
      <ul className="messages">
        {list.map((m) => {
          const offer = m.data?.offerId !== undefined ? game.offers.find((o) => o.id === m.data!.offerId) : undefined;
          return (
            <li key={m.id} className={unreadIds.has(m.id) ? 'unread' : ''}>
              <div className="row between">
                <b>{unreadIds.has(m.id) && <span className="dot" />}{m.title}</b>
                <span className="dim small-text">{KIND_NAME[m.kind]} · 第 {m.season} 赛季 第 {Math.floor(m.day / 7) + 1} 周</span>
              </div>
              <p>{m.body}</p>
              {offer && offer.seller === PLAYER_CLUB_ID && (
                offer.status === 'PENDING'
                  ? <div className="row"><button className="primary small" onClick={() => answer(offer.id, true)}>接受报价</button><button className="small" onClick={() => answer(offer.id, false)}>拒绝</button></div>
                  : <p className="dim">{offer.status === 'ACCEPTED' ? '已成交' : offer.status === 'REJECTED' ? '已拒绝' : '已失效'}</p>
              )}
              {m.kind === 'CONTRACT' && m.data?.players !== undefined && <button className="link" onClick={() => go('contracts')}>去谈续约 →</button>}
              {m.kind === 'FINANCE' && <button className="link" onClick={() => go('finance')}>去财务 →</button>}
              {m.kind === 'MATCH' && m.data?.round !== undefined && game.reports.some((r) => r.round === m.data!.round && r.season === m.season)
                && <button className="link" onClick={() => go('report', { reportRound: Number(m.data!.round) })}>看战报 →</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
