import { useState } from 'react';
import type { GameData } from '../../core/types';
import { newGame, type GameState } from '../../game';
import { lookFor } from '../../render/pixel/chibi';
import { Portrait } from '../components/Portrait';
import { iconUrl } from '../icons';
import { CLUB_COLORS, money } from '../labels';

export function StartPage({ data, onStart, onCancel, hasGame, ask }: { data: GameData; onStart: (g: GameState) => void; onCancel?: () => void; hasGame: boolean; ask: (text: string, yes: string, onYes: () => void) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(CLUB_COLORS[0]!);
  const displayName = name.trim() || '星火电竞';
  const start = () => {
    const go = () => {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
      onStart(newGame(name.trim() || '无名战队', color, seed, data));
    };
    if (hasGame) ask('开始新游戏会替换当前进度（旧存档会保留一份备份）。', '开始新游戏', go);
    else go();
  };
  return (
    <div className="start">
      <div className="start-hero">
        <div className="start-ribbon">KAIRO STYLE · 电竞俱乐部物语</div>
        <h1>电竞帝国</h1>
        <p className="sub">从草根五人小队到三栖电竞豪门 · 单机像素经营模拟</p>
      </div>
      <div className="card start-card">
        <div className="start-preview" style={{ borderColor: color }}>
          <div className="start-emblem" style={{ background: color }}>
            <img src={iconUrl('history')} alt="" className="px-icon big" />
          </div>
          <div className="start-preview-info">
            <div className="small-text dim">即将挂牌的俱乐部</div>
            <strong className="start-preview-name">{displayName}</strong>
          </div>
          <Portrait look={lookFor('captain_preview', color)} size={48} />
        </div>
        <label>俱乐部名称
          <input value={name} maxLength={12} placeholder="例如：星火电竞" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} autoFocus />
        </label>
        <div className="label">战队代表色</div>
        <div className="swatches">
          {CLUB_COLORS.map((c) => (
            <button key={c} className={`swatch-btn ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <div className="goal">
          <b>🎯 创队目标</b>：用 {money(data.economy.startingFunds)} 启动资金签下至少 5 名选手，率队征战 6 队双循环联赛与季后赛，逐步扩建基地、聘请管理层、开拓射击与卡牌分部！
        </div>
        <button className="primary big" onClick={start}>成立俱乐部</button>
        {onCancel && <button className="link" onClick={onCancel}>返回当前游戏</button>}
      </div>
    </div>
  );
}
