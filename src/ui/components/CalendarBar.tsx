import type { GameData } from '../../core/types';
import { describeDate, nextPlayerFixture, type GameState } from '../../game';
import type { ClockSpeed } from '../App';

/** Date, clock controls and the "skip to the next match" shortcut. */
export function CalendarBar({ game, data, running, speed, setRunning, setSpeed, toNextMatch }: {
  game: GameState; data: GameData; running: boolean; speed: ClockSpeed;
  setRunning: (v: boolean) => void; setSpeed: (v: ClockSpeed) => void; toNextMatch: () => void;
}) {
  const next = nextPlayerFixture(game, data);
  const daysToMatch = next ? next.day - game.calendar.day : null;
  return (
    <div className="calendar-bar">
      <div className="date">
        <b>{describeDate(game, data)}</b>
        {daysToMatch !== null && <span className="dim">{daysToMatch === 0 ? ' · 今天比赛' : ` · ${daysToMatch} 天后比赛`}</span>}
      </div>
      <div className="clock">
        <button className={running ? '' : 'primary'} onClick={() => setRunning(!running)} aria-label={running ? '暂停' : '开始'}>
          {running ? '⏸ 暂停' : game.calendar.phase === 'FINISHED' ? '▶ 新赛季' : '▶ 开始'}
        </button>
        {data.season.speeds.map((v) => (
          <button key={v} className={`speed ${speed === v ? 'on' : ''}`} onClick={() => setSpeed(v as ClockSpeed)}>{v}×</button>
        ))}
        <button onClick={toNextMatch} disabled={game.calendar.phase === 'FINISHED'}>⏭ 下一场</button>
      </div>
    </div>
  );
}
