import { TRAINING_FOCI, type TrainingFocus } from '../../core/types';
import { playerOverall, rosterOf } from '../../game';
import type { PageProps } from '../App';
import { Fatigue, Form, Morale, Ovr, PlayerName, Roles } from '../components/PlayerBits';
import { FOCUS_HINT, FOCUS_NAME, growthRoom, money } from '../labels';

export function TrainingPage({ game, data, act, flash, showPlayer }: PageProps) {
  const roster = rosterOf(game).sort((a, b) => playerOverall(b) - playerOverall(a));
  const tired = roster.filter((p) => (p.fatigue ?? 0) >= 50);
  const cost = roster.length * data.economy.finance.trainingCostPerPlayer;
  const choose = (f: TrainingFocus) => {
    act((d) => { d.training = f; return { ok: true, value: undefined }; });
    flash(`本周训练：${FOCUS_NAME[f]}`);
  };
  return (
    <div className="grid">
      <section className="card wide">
        <h2>本周训练</h2>
        <p className="dim">每周一结算一次，全队一起练。练得越多越累，疲劳超过 50 比赛就会发挥变差；年轻选手长得快，27 岁后很难再涨，30 岁后会慢慢下滑。</p>
        <div className="tactics">
          {TRAINING_FOCI.map((f) => (
            <label key={f} className={`tactic ${game.training === f ? 'on' : ''}`}>
              <input type="radio" name="focus" checked={game.training === f} onChange={() => choose(f)} />
              <b>{FOCUS_NAME[f]}</b>
              <span>{FOCUS_HINT[f]}</span>
              <span>{f === 'REST' ? '疲劳 −' + data.growth.fatigueRestRecovery + ' · 免费' : `疲劳 +${data.growth.fatiguePerTrainingWeek} · 每周 ${money(cost)}`}</span>
            </label>
          ))}
        </div>
        {tired.length > 0 && <p className="bad">{tired.map((p) => p.name).join('、')} 已经比较累了（疲劳 ≥50），可以考虑练一周“休息”。</p>}
      </section>
      <section className="card wide">
        <h3>队员状况</h3>
        <table className="table">
          <thead><tr><th>选手</th><th className="hide-sm">位置</th><th>能力</th><th className="hide-sm">年龄</th><th className="hide-sm">成长空间</th><th>疲劳</th><th>士气</th><th className="hide-sm">状态</th></tr></thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id}>
                <td><PlayerName p={p} show={showPlayer} /></td>
                <td className="hide-sm"><Roles p={p} /></td>
                <td><Ovr p={p} /></td>
                <td className="hide-sm">{p.age}</td>
                <td className="hide-sm">{growthRoom(p.potential, playerOverall(p))}</td>
                <td><Fatigue p={p} /></td>
                <td><Morale p={p} /></td>
                <td className="hide-sm"><Form p={p} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {roster.length === 0 && <p className="dim">还没有选手。</p>}
      </section>
    </div>
  );
}
