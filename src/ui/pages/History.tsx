import { PLAYER_CLUB_ID, clubById, standings } from '../../game';
import type { PageProps } from '../App';
import { PLAYOFF_NAME, money } from '../labels';

export function HistoryPage({ game, data, showPlayer }: PageProps) {
  const seasons = [...game.history].reverse();
  const titles = game.history.filter((h) => h.champion === PLAYER_CLUB_ID).length;
  const short = (id: string | null) => (id ? clubById(game, id).shortName : '—');
  const table = standings(game);
  const mvp = (season: number) => {
    const a = game.awards.find((w) => w.season === season);
    if (!a) return '—';
    const p = game.players[a.mvpId];
    return <span>{p ? <button className="link name" onClick={() => showPlayer(p.id)}>{a.mvpName}</button> : a.mvpName}<span className="dim small-text"> {short(a.clubId)}</span></span>;
  };
  const hall = [...game.hallOfFame].sort((a, b) => b.titles - a.titles || (b.mvps ?? 0) - (a.mvps ?? 0) || b.peakOvr - a.peakOvr || a.name.localeCompare(b.name));
  return (
    <div className="grid">
      <section className="card wide">
        <h2>赛季历史</h2>
        <p>你已经打了 {game.history.length} 个完整赛季{titles > 0 ? `，拿过 ${titles} 次总冠军 🏆` : ''}。现在是第 {game.calendar.season} 赛季，常规赛暂列第 {table.findIndex((r) => r.clubId === PLAYER_CLUB_ID) + 1} 名。</p>
        {seasons.length === 0 && <p className="dim">第一个赛季打完后，这里会记录每个赛季的排名和冠军。</p>}
        {seasons.length > 0 && (
          <table className="table">
            <thead><tr><th>赛季</th><th>冠军</th><th>MVP</th><th>我的排名</th><th>季后赛</th><th className="hide-sm">赛季末资金</th></tr></thead>
            <tbody>
              {seasons.map((h) => {
                const me = h.table.find((r) => r.clubId === PLAYER_CLUB_ID);
                return (
                  <tr key={h.season} className={h.champion === PLAYER_CLUB_ID ? 'me' : ''}>
                    <td className="keep">第{h.season}季</td>
                    <td className="keep">{short(h.champion)}</td>
                    <td>{mvp(h.season)}</td>
                    <td><span className="keep">第{h.playerRank}名</span>{me && <span className="dim small-text hide-sm">（{me.wins} 胜 {me.losses} 负）</span>}</td>
                    <td className="keep">{PLAYOFF_NAME[h.playerPlayoff]}</td>
                    <td className="hide-sm">{money(h.fundsEnd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="card wide">
        <h2>🏛 名人堂</h2>
        <p className="dim small-text">退役选手中，作为主力拿过 {data.season.awards.hallOfFame.titles} 个以上冠军、当过 MVP，或者当了 {data.season.awards.hallOfFame.regularSeasons} 个赛季以上主力的，会进名人堂。</p>
        {hall.length === 0 && <p className="dim">还没有人入选。打得久了，传奇选手退役时会出现在这里。</p>}
        {hall.length > 0 && (
          <ul className="plain hall">
            {hall.map((h) => (
              <li key={h.playerId}>
                <b>{h.name}</b> <span className="dim small-text">第 {h.retiredSeason} 季退役 · 主要效力{h.mainClub || '—'}</span>
                <div className="small-text">{h.titles > 0 && <span>🏆×{h.titles} </span>}{(h.mvps ?? 0) > 0 && <span>⭐MVP×{h.mvps} </span>}{h.seasons} 个赛季 · {h.played} 场 · 巅峰能力 {h.peakOvr}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {seasons.map((h) => (
        <section key={h.season} className="card">
          <h3>第 {h.season} 赛季常规赛</h3>
          <table className="table compact">
            <thead><tr><th>#</th><th>俱乐部</th><th>胜</th><th>负</th></tr></thead>
            <tbody>
              {h.table.map((r, i) => <tr key={r.clubId} className={r.clubId === PLAYER_CLUB_ID ? 'me' : ''}><td>{i + 1}</td><td>{r.name}{r.clubId === h.champion ? ' 🏆' : ''}</td><td>{r.wins}</td><td>{r.losses}</td></tr>)}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
