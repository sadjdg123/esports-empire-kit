import { PLAYER_CLUB_ID, clubById, standings } from '../../game';
import type { PageProps } from '../App';
import { PLAYOFF_NAME, money } from '../labels';

export function HistoryPage({ game }: PageProps) {
  const seasons = [...game.history].reverse();
  const titles = game.history.filter((h) => h.champion === PLAYER_CLUB_ID).length;
  const name = (id: string | null) => (id ? clubById(game, id).name : '—');
  const table = standings(game);
  return (
    <div className="grid">
      <section className="card wide">
        <h2>赛季历史</h2>
        <p>你已经打了 {game.history.length} 个完整赛季{titles > 0 ? `，拿过 ${titles} 次总冠军 🏆` : ''}。现在是第 {game.calendar.season} 赛季，常规赛暂列第 {table.findIndex((r) => r.clubId === PLAYER_CLUB_ID) + 1} 名。</p>
        {seasons.length === 0 && <p className="dim">第一个赛季打完后，这里会记录每个赛季的排名和冠军。</p>}
        {seasons.length > 0 && (
          <table className="table">
            <thead><tr><th>赛季</th><th>冠军</th><th>我的排名</th><th>季后赛</th><th className="hide-sm">赛季末资金</th></tr></thead>
            <tbody>
              {seasons.map((h) => {
                const me = h.table.find((r) => r.clubId === PLAYER_CLUB_ID);
                return (
                  <tr key={h.season} className={h.champion === PLAYER_CLUB_ID ? 'me' : ''}>
                    <td>第 {h.season} 季</td>
                    <td>{name(h.champion)}</td>
                    <td>第 {h.playerRank} 名{me ? `（${me.wins} 胜 ${me.losses} 负）` : ''}</td>
                    <td>{PLAYOFF_NAME[h.playerPlayoff]}</td>
                    <td className="hide-sm">{money(h.fundsEnd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
