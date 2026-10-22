import type { GameData } from '../../core/types';
import { financeSummary, type GameState } from '../../game';
import { money } from '../labels';

export function FundsBar({ game, data }: { game: GameState; data: GameData }) {
  const f = financeSummary(game, data);
  const level = game.funds < 0 ? 'danger' : f.lowFunds ? 'warn' : 'ok';
  const runway = f.weeklySalaries === 0 ? '尚无工资支出' : f.runwayWeeks === Infinity ? '赞助足够支付工资' : `按当前开销可撑 ${Math.floor(f.runwayWeeks)} 周`;
  return (
    <header className={`funds-bar ${level}`}>
      <div className="club-name"><span className="swatch" style={{ background: game.club.color }} />{game.club.name}</div>
      <div className="funds">资金 <b>{money(game.funds)}</b></div>
      <div className="runway">{runway}</div>
      <div className="weekly">每周工资 {money(f.weeklySalaries)} · 赞助 {money(f.weeklySponsor)}</div>
      {level === 'warn' && <div className="flag">资金偏低</div>}
      {level === 'danger' && <div className="flag">资金为负，暂停签约</div>}
    </header>
  );
}
