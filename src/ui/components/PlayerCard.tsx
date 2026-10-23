import { PLAYER_CLUB_ID, clubById, marketValue, playerOverall } from '../../game';
import { lookFor } from '../../render/pixel/chibi';
import type { PageProps } from '../App';
import { GROWTH_NAME, growthRoom, money, ROLE_NAME } from '../labels';
import { Attrs, Fatigue, Form, Heroes, Morale, Ovr, Roles, Traits } from './PlayerBits';
import { Portrait } from './Portrait';

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="dim">在你队里训练满两周后，这里会显示能力变化曲线。</p>;
  const w = 300;
  const h = 70;
  const lo = Math.min(...points) - 1;
  const hi = Math.max(...points) + 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <div>
      <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="能力变化曲线">
        <polyline points={points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
      </svg>
      <div className="gold-labels"><span>{points.length} 周前 {first.toFixed(1)}</span><span className={last >= first ? 'good' : 'bad'}>现在 {last.toFixed(1)}（{last >= first ? '+' : ''}{(last - first).toFixed(1)}）</span></div>
    </div>
  );
}

export function PlayerCard({ game, data, playerId, close }: PageProps & { playerId: string; close: () => void }) {
  const p = game.players[playerId]!;
  const st = p.stats ?? { played: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
  const kda = st.deaths === 0 ? st.kills + st.assists : (st.kills + st.assists) / st.deaths;
  const club = p.clubId ? clubById(game, p.clubId) : null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" onClick={close}>
      <div className="modal card player-card" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <div className="row">
            <Portrait look={lookFor(p.id, club?.color ?? '#9a8f80')} size={52} />
            <h2>{p.name} <Ovr p={p} /></h2>
          </div>
          <button className="small" onClick={close}>关闭</button>
        </div>
        <p>{p.age} 岁 · <Roles p={p} /> · {club ? (club.id === PLAYER_CLUB_ID ? '你的选手' : club.name) : '自由球员'}</p>
        {p.retiring && <p className="bad">打完本赛季就退役</p>}
        <dl className="kv">
          <dt>操作 / 意识 / 配合 / 心态</dt><dd><Attrs p={p} /></dd>
          <dt>成长空间</dt><dd>{growthRoom(p.potential, playerOverall(p))}</dd>
          <dt>性格</dt><dd><Traits p={p} data={data} full /></dd>
          <dt>成长类型</dt><dd>{GROWTH_NAME[p.growthType ?? 'NORMAL']}</dd>
          <dt>疲劳</dt><dd><Fatigue p={p} /></dd>
          <dt>士气</dt><dd><Morale p={p} /></dd>
          <dt>状态</dt><dd><Form p={p} /></dd>
          <dt>周薪</dt><dd>{money(p.salaryPerWeek)}</dd>
          <dt>合同</dt><dd>{p.contractUntil ? `到第 ${p.contractUntil} 赛季${p.contractUntil <= game.calendar.season ? '（本赛季到期）' : ''}` : '无'}</dd>
          <dt>身价</dt><dd>{money(marketValue(data, p))}</dd>
          <dt>生涯</dt><dd>{st.played} 场 {st.wins} 胜 · KDA {kda.toFixed(1)}（{st.kills}/{st.deaths}/{st.assists}）</dd>
        </dl>
        <h3>英雄熟练度</h3>
        <Heroes p={p} data={data} />
        <h3>能力变化</h3>
        <Sparkline points={p.ovrHistory ?? []} />
        <p className="dim small-text">主位置 {ROLE_NAME[p.primaryRole]}。成长空间只是大概判断，真实潜力是隐藏的。</p>
      </div>
    </div>
  );
}
