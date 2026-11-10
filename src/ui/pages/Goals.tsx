import { goalProgress } from '../../game';
import type { PageProps } from '../App';
import { money } from '../labels';

/** Milestones (P4, T41): what the group has reached and what comes next. No ending, only a direction. */
export function GoalsPage({ game, data }: PageProps) {
  const done = data.goals.filter((g) => game.goals[g.id]);
  return (
    <div className="grid">
      <section className="card wide">
        <h2>阶段目标 <span className="dim small-text">{done.length} / {data.goals.length}</span></h2>
        <p className="dim small-text">没有结局，想玩多久玩多久。每个目标第一次达成时发一次奖励。</p>
        <ul className="plain">
          {data.goals.map((g) => {
            const at = game.goals[g.id];
            const now = Math.min(g.target, goalProgress(game, g));
            return (
              <li key={g.id} className={`goal ${at ? 'done' : ''}`}>
                <div className="row between">
                  <b>{at ? '✅' : '⬜'} {g.name}</b>
                  <span className="small-text keep">{money(g.reward)}{g.reputation > 0 ? ` · 声望 +${g.reputation}` : ''}</span>
                </div>
                <div className="small-text">{g.description}</div>
                {at ? <div className="small-text dim">第 {at.season} 赛季达成</div>
                  : <div className="skill-row"><span className="dim small-text">进度</span><span className="bar"><i style={{ width: `${(now / g.target) * 100}%` }} /></span><b className="small-text">{now}/{g.target}</b></div>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
