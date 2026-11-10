import { useState } from 'react';
import { goalProgress } from '../../game';
import type { PageProps } from '../App';
import { money } from '../labels';

/** Milestones (P4, T41): what the group has reached and what comes next. No ending, only a direction. */
export function GoalsPage({ game, data }: PageProps) {
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'DONE'>('ALL');
  const done = data.goals.filter((g) => game.goals[g.id]);
  const openGoals = data.goals
    .filter((g) => !game.goals[g.id])
    .map((g) => {
      const now = Math.min(g.target, goalProgress(game, g));
      return { g, now, pct: Math.min(100, Math.round((now / g.target) * 100)) };
    });
  const nextUp = [...openGoals].sort((a, b) => b.pct - a.pct)[0];
  const shown = data.goals.filter((g) => filter === 'ALL' || (filter === 'DONE' ? !!game.goals[g.id] : !game.goals[g.id]));

  return (
    <div className="grid">
      <section className="card wide">
        <div className="row between">
          <h2>阶段目标 <span className="dim small-text">{done.length} / {data.goals.length}</span></h2>
          <div className="filters">
            <button className={filter === 'ALL' ? 'chip on' : 'chip'} onClick={() => setFilter('ALL')}>全部</button>
            <button className={filter === 'OPEN' ? 'chip on' : 'chip'} onClick={() => setFilter('OPEN')}>进行中（{openGoals.length}）</button>
            <button className={filter === 'DONE' ? 'chip on' : 'chip'} onClick={() => setFilter('DONE')}>已达成（{done.length}）</button>
          </div>
        </div>
        <p className="dim small-text">没有结局，想玩多久玩多久。每个目标第一次达成时发一次奖励。</p>
        {nextUp && (
          <div className="advice good">
            <b>🎯 离达成最近：{nextUp.g.name}</b>（{nextUp.now} / {nextUp.g.target}，已完成 {nextUp.pct}%）— {nextUp.g.description}，奖励 {money(nextUp.g.reward)}{nextUp.g.reputation > 0 ? ` · 声望 +${nextUp.g.reputation}` : ''}
          </div>
        )}
        <ul className="plain">
          {shown.map((g) => {
            const at = game.goals[g.id];
            const now = Math.min(g.target, goalProgress(game, g));
            const pct = Math.min(100, Math.round((now / g.target) * 100));
            return (
              <li key={g.id} className={`goal ${at ? 'done' : ''}`}>
                <div className="row between">
                  <b>{at ? '✅' : '⬜'} {g.name}</b>
                  <span className="small-text keep">{money(g.reward)}{g.reputation > 0 ? ` · 声望 +${g.reputation}` : ''}</span>
                </div>
                <div className="small-text">{g.description}</div>
                {at ? <div className="small-text good">第 {at.season} 赛季已达成（{g.target}/{g.target}）</div> : (
                  <div className="goal-progress">
                    <span className="bar"><i style={{ width: `${pct}%` }} /></span>
                    <b className="small-text keep">{now} / {g.target}（{pct}%）</b>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
