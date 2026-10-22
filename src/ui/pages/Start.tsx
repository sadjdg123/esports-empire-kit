import { useState } from 'react';
import type { GameData } from '../../core/types';
import { newGame, type GameState } from '../../game';
import { CLUB_COLORS, money } from '../labels';

export function StartPage({ data, onStart, onCancel, hasGame }: { data: GameData; onStart: (g: GameState) => void; onCancel?: () => void; hasGame: boolean }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(CLUB_COLORS[0]!);
  const start = () => {
    if (hasGame && !window.confirm('开始新游戏会替换当前进度（旧存档会保留一份备份）。确定吗？')) return;
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    onStart(newGame(name.trim() || '无名战队', color, seed, data));
  };
  return (
    <div className="start">
      <h1>电竞帝国</h1>
      <p className="sub">P0 试玩版 · 经营一支 MOBA 草根战队</p>
      <div className="card start-card">
        <label>俱乐部名称
          <input value={name} maxLength={12} placeholder="例如：星火电竞" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} autoFocus />
        </label>
        <div className="label">队伍颜色</div>
        <div className="swatches">
          {CLUB_COLORS.map((c) => (
            <button key={c} className={`swatch-btn ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <div className="goal">
          <b>本赛季目标</b>：用 {money(data.economy.startingFunds)} 的预算组一支五人队，打完 10 场小联赛（6 支队伍主客场各打一次），看最终排名。
        </div>
        <button className="primary big" onClick={start}>成立俱乐部</button>
        {onCancel && <button className="link" onClick={onCancel}>返回当前游戏</button>}
      </div>
    </div>
  );
}
