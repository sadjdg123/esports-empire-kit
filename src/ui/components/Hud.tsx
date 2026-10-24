import type { GameData } from '../../core/types';
import { describeDate, financeSummary, nextPlayerFixture, type GameState } from '../../game';
import type { ClockSpeed } from '../App';
import { money } from '../labels';

/** The status bar over the base: date, money, reputation, the clock. */
export function Hud({ game, data, running, speed, setRunning, setSpeed, toNextMatch, openPending }: {
  game: GameState; data: GameData; running: boolean; speed: ClockSpeed;
  setRunning: (v: boolean) => void; setSpeed: (v: ClockSpeed) => void; toNextMatch: () => void; openPending: () => void;
}) {
  const f = financeSummary(game, data);
  const next = nextPlayerFixture(game, data);
  const days = next ? next.day - game.calendar.day : null;
  const level = game.funds < 0 ? 'danger' : f.lowFunds ? 'warn' : '';
  return (
    <header className="hud">
      <div className="hud-row">
        <span className="hud-date">{describeDate(game, data)}</span>
        {days !== null && <span className="hud-next">{days === 0 ? '今天比赛！' : `${days} 天后比赛`}</span>}
      </div>
      <div className="hud-row">
        <span className={`hud-money ${level}`}>{money(game.funds)}</span>
        <span className="hud-rep">声望 {Math.round(game.club.reputation)}</span>
        {game.pending.length > 0 && <button className="hud-pending" onClick={openPending}>待批 {game.pending.length}</button>}
        <span className="hud-clock">
          <button className={running ? 'on' : ''} onClick={() => setRunning(!running)} aria-label={running ? '暂停' : '开始'}>
            {running ? '⏸ 暂停' : game.calendar.phase === 'FINISHED' ? '▶ 新赛季' : '▶ 开始'}
          </button>
          {data.season.speeds.map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v as ClockSpeed)}>{v}×</button>
          ))}
          <button onClick={toNextMatch} disabled={game.calendar.phase === 'FINISHED'}>⏭ 下一场</button>
        </span>
      </div>
    </header>
  );
}
