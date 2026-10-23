import { PLAYER_CLUB_ID, advanceDay, advanceToNextMatch, clubById, describeDate, nextPlayerFixture, readinessIssues, seasonOver, standings, type WeekSummary } from '../../game';
import type { PageProps } from '../App';
import { STYLE_NAME, money } from '../labels';

export function HomePage({ game, data, go, act, flash, lastWeek }: PageProps & { lastWeek: WeekSummary | null }) {
  const table = standings(game);
  const myRank = table.findIndex((r) => r.clubId === PLAYER_CLUB_ID) + 1;
  const next = nextPlayerFixture(game, data);
  const issues = readinessIssues(game, data);
  const over = seasonOver(game);
  const opponent = next ? clubById(game, next.opponent) : null;
  const stageName = next?.kind === 'SEMI' ? '季后赛半决赛' : next?.kind === 'FINAL' ? '总决赛' : `第 ${game.week + 1} 轮`;
  const awaitingPlayoffs = !next && game.calendar.phase === 'REGULAR' && game.week >= game.totalRounds;
  const headline = next ? stageName : awaitingPlayoffs ? '常规赛结束，季后赛下周开打' : '本赛季没有你的比赛了';
  const buttonText = next ? '前进到下一场比赛 ▶' : awaitingPlayoffs ? '前进到季后赛 ▶' : '前进到赛季结束 ▶';
  const record = game.history[game.history.length - 1];
  const toMatch = () => {
    let pause: string | null = null;
    act((d) => { pause = advanceToNextMatch(d, data).pause; return { ok: true, value: undefined }; });
    if (pause === 'MATCH_DAY') go('match');
    else flash('本赛季你已经没有比赛了');
  };
  const newSeason = () => {
    act((d) => { advanceDay(d, data); return { ok: true, value: undefined }; });
    flash('新赛季开始了：休赛期可以签人、调整阵容');
  };
  const lastReport = game.reports[game.reports.length - 1];
  const myRow = table.find((r) => r.clubId === PLAYER_CLUB_ID)!;

  return (
    <div className="grid">
      <section className="card hero-card">
        {over ? (
          <>
            <h2>第 {game.calendar.season} 赛季结束</h2>
            <p className="big-text">常规赛排名：第 <b>{myRank}</b> 名（{myRow.wins} 胜 {myRow.losses} 负）</p>
            {record && <p>季后赛：{record.playerPlayoff === 'CHAMPION' ? '🏆 总冠军！' : record.playerPlayoff === 'FINAL' ? '亚军' : record.playerPlayoff === 'SEMI' ? '半决赛止步' : '没有进入季后赛'}
              {record.champion && record.champion !== PLAYER_CLUB_ID ? `（冠军：${clubById(game, record.champion).name}）` : ''}</p>}
            <p>资金从 {money(game.startingFunds)} 变为 <b>{money(game.funds)}</b>。</p>
            <button className="primary big" onClick={newSeason}>进入第 {game.calendar.season + 1} 赛季 ▶</button>
          </>
        ) : (
          <>
            <p className="dim">{describeDate(game, data)}</p>
            <h2>{headline}</h2>
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
                <p>首发和战术已就绪：<b>{data.match.tactics[game.lineup!.tactic].name}</b>。时间会一天天走到比赛日，途中每周一发工资和赞助。</p>
                <button className="primary big" onClick={toMatch}>{buttonText}</button>
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
