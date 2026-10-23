import type { GameData } from '../../core/types';
import { financeSummary, type GameState } from '../../game';
import { money } from '../labels';

export function FundsBar({ game, data }: { game: GameState; data: GameData }) {
  const f = financeSummary(game, data);
  const level = game.funds < 0 ? 'danger' : f.lowFunds ? 'warn' : 'ok';
  return (
    <header className={`funds-bar ${level}`}>
      <div className="club-name"><span className="swatch" style={{ background: game.club.color }} />{game.club.name}</div>
      <div className="funds">资金 <b>{money(game.funds)}</b></div>
      <div className="weekly">每周净 <span className={f.weeklyNet < 0 ? 'bad' : 'good'}>{f.weeklyNet >= 0 ? '+' : ''}{money(f.weeklyNet)}</span><span className="hide-sm">（不含奖金）</span></div>
      <div className="rep hide-sm">声望 {Math.round(game.club.reputation)}</div>
      {level === 'warn' && <div className="flag">资金偏低</div>}
      {level === 'danger' && <div className="flag">资金为负，暂停签约</div>}
    </header>
  );
}
