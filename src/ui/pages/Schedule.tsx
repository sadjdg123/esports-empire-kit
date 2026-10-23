import { PLAYER_CLUB_ID, clubById, standings } from '../../game';
import type { PageProps } from '../App';

export function SchedulePage({ game, data, go }: PageProps) {
  const table = standings(game);
  const name = (id: string) => clubById(game, id).name;
  return (
    <div className="grid">
      <section className="card">
        <h2>积分榜</h2>
        <table className="table">
          <thead><tr><th>#</th><th>俱乐部</th><th className="hide-sm">场次</th><th>胜</th><th>负</th><th title="击杀数差">净击杀</th></tr></thead>
          <tbody>
            {table.map((r, i) => (
              <tr key={r.clubId} className={r.clubId === PLAYER_CLUB_ID ? 'me' : ''}>
                <td>{i + 1}{i < data.season.playoffTeams ? <span className="dim small-text"> ★</span> : ''}</td><td>{r.name}</td><td className="hide-sm">{r.played}</td><td>{r.wins}</td><td>{r.losses}</td><td>{r.killDiff > 0 ? '+' : ''}{r.killDiff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>季后赛</h2>
        {game.playoffs.length === 0 ? (
          <p className="dim">常规赛结束后，前 {data.season.playoffTeams} 名进入季后赛：半决赛第 1 对第 4、第 2 对第 3，胜者打总决赛，都是一局定胜负。</p>
        ) : (
          <div className="bracket">
            {(['SEMI', 'FINAL'] as const).map((stage) => (
              <div key={stage} className="round">
                <div className="round-title">{stage === 'SEMI' ? '半决赛' : '总决赛'}</div>
                {game.playoffs.filter((m) => m.stage === stage).map((m) => {
                  const mine = m.blue === PLAYER_CLUB_ID || m.red === PLAYER_CLUB_ID;
                  return (
                    <div key={m.index} className={`fixture ${mine ? 'me' : ''}`}>
                      <span className={m.winner === m.blue ? 'win' : ''}>{name(m.blue)}</span>
                      <span className="vs">{m.winner ? '✓' : 'vs'}</span>
                      <span className={m.winner === m.red ? 'win' : ''}>{name(m.red)}</span>
                    </div>
                  );
                })}
                {stage === 'FINAL' && !game.playoffs.some((m) => m.stage === 'FINAL') && <div className="dim">等待半决赛结果</div>}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card wide">
        <h2>常规赛赛程</h2>
        <div className="rounds">
          {game.schedule.map((round, ri) => (
            <div key={ri} className={`round ${ri === game.week ? 'current' : ''}`}>
              <div className="round-title">第 {ri + 1} 轮{ri === game.week ? '（下一轮）' : ''}</div>
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
