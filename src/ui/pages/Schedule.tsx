import { PLAYER_CLUB_ID, clubById, standings } from '../../game';
import type { PageProps } from '../App';

export function SchedulePage({ game, go }: PageProps) {
  const table = standings(game);
  const name = (id: string) => clubById(game, id).name;
  return (
    <div className="grid">
      <section className="card">
        <h2>积分榜</h2>
        <table className="table">
          <thead><tr><th>#</th><th>俱乐部</th><th>场次</th><th>胜</th><th>负</th><th title="击杀数差">净击杀</th></tr></thead>
          <tbody>
            {table.map((r, i) => (
              <tr key={r.clubId} className={r.clubId === PLAYER_CLUB_ID ? 'me' : ''}>
                <td>{i + 1}</td><td>{r.name}</td><td>{r.played}</td><td>{r.wins}</td><td>{r.losses}</td><td>{r.killDiff > 0 ? '+' : ''}{r.killDiff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card wide">
        <h2>赛程</h2>
        <div className="rounds">
          {game.schedule.map((round, ri) => (
            <div key={ri} className={`round ${ri === game.week ? 'current' : ''}`}>
              <div className="round-title">第 {ri + 1} 轮{ri === game.week ? '（本周）' : ''}</div>
              {round.map((f) => {
                const res = game.results.find((r) => r.round === f.round && r.index === f.index);
                const mine = f.blue === PLAYER_CLUB_ID || f.red === PLAYER_CLUB_ID;
                return (
                  <div key={f.index} className={`fixture ${mine ? 'me' : ''}`}>
                    <span className={res?.winner === f.blue ? 'win' : ''}>{name(f.blue)}</span>
                    <span className="vs">{res ? `${res.kills.blue} : ${res.kills.red}` : 'vs'}</span>
                    <span className={res?.winner === f.red ? 'win' : ''}>{name(f.red)}</span>
                    {res && mine && <button className="link" onClick={() => go('report', { reportRound: f.round })}>战报</button>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
