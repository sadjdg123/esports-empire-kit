import { PLAYER_CLUB_ID, clubById, playerFixture, readinessIssues, seasonOver, standings, type WeekSummary } from '../../game';
import type { PageProps } from '../App';
import { STYLE_NAME, money } from '../labels';

export function HomePage({ game, data, go, lastWeek }: PageProps & { lastWeek: WeekSummary | null }) {
  const table = standings(game);
  const myRank = table.findIndex((r) => r.clubId === PLAYER_CLUB_ID) + 1;
  const fixture = playerFixture(game);
  const issues = readinessIssues(game, data);
  const over = seasonOver(game);
  const opponent = fixture ? clubById(game, fixture.blue === PLAYER_CLUB_ID ? fixture.red : fixture.blue) : null;
  const lastReport = game.reports[game.reports.length - 1];
  const myRow = table.find((r) => r.clubId === PLAYER_CLUB_ID)!;

  return (
    <div className="grid">
      <section className="card hero-card">
        {over ? (
          <>
            <h2>赛季结束</h2>
            <p className="big-text">最终排名：第 <b>{myRank}</b> 名（{myRow.wins} 胜 {myRow.losses} 负）</p>
            <p>资金从 {money(game.startingFunds)} 变为 <b>{money(game.funds)}</b>。</p>
            <button className="primary" onClick={() => go('settings')}>开始新赛季（新游戏）</button>
          </>
        ) : (
          <>
            <h2>第 {game.week + 1} 轮</h2>
            {opponent && (
              <p className="big-text">对手：<span className="swatch" style={{ background: opponent.color }} /> <b>{opponent.name}</b>
                <span className="dim">（{STYLE_NAME[opponent.style]}）</span></p>
            )}
            {opponent && <p className="dim">{data.clubs.find((c) => c.id === opponent.id)?.description}</p>}
            {issues.length > 0 ? (
              <div className="todo">
                <b>开赛前还要做：</b>
                <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
                <button onClick={() => go(game.club.roster.length < data.economy.minRoster ? 'market' : 'lineup')} className="primary">
                  {game.club.roster.length < data.economy.minRoster ? '去市场签人' : '去设置阵容'}
                </button>
              </div>
            ) : (
              <>
                <p>首发和战术已就绪：<b>{data.match.tactics[game.lineup!.tactic].name}</b>。进入下一周会先发工资和赞助，再打本周比赛。</p>
                <button className="primary big" onClick={() => go('match')}>进入下一周 ▶</button>
                <button className="link" onClick={() => go('lineup')}>调整阵容</button>
              </>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h3>积分榜</h3>
        <table className="table compact">
          <thead><tr><th>#</th><th>俱乐部</th><th>胜</th><th>负</th></tr></thead>
          <tbody>
            {table.map((r, i) => (
              <tr key={r.clubId} className={r.clubId === PLAYER_CLUB_ID ? 'me' : ''}><td>{i + 1}</td><td>{r.name}</td><td>{r.wins}</td><td>{r.losses}</td></tr>
            ))}
          </tbody>
        </table>
        <button className="link" onClick={() => go('schedule')}>完整赛程 →</button>
      </section>

      {lastReport && (
        <section className="card">
          <h3>上一场：{lastReport.won ? '胜' : '负'}</h3>
          <p>{lastReport.headline}</p>
          {lastWeek && lastWeek.round === lastReport.round && (
            <p className="dim">本周资金 {money(lastWeek.fundsBefore)} → {money(lastWeek.fundsAfter)}</p>
          )}
          <button className="link" onClick={() => go('report', { reportRound: lastReport.round })}>查看战报 →</button>
        </section>
      )}
    </div>
  );
}
