import { TRAINING_FOCI } from '../../core/types';
import { PLAYER_CLUB_ID, playerOverall, rosterOf, trainingFocusOf, type TrainingPlan } from '../../game';
import type { PageProps } from '../App';
import { Fatigue, Form, Morale, Ovr, PlayerName, Roles } from '../components/PlayerBits';
import { FOCUS_HINT, FOCUS_NAME, growthRoom, money } from '../labels';

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function TrainingPage({ game, data, act, flash, showPlayer }: PageProps) {
  const roster = rosterOf(game).sort((a, b) => playerOverall(b) - playerOverall(a));
  const tired = roster.filter((p) => (p.fatigue ?? 0) >= 50);
  const cost = roster.length * data.economy.finance.trainingCostPerPlayer;
  const choose = (f: TrainingPlan) => {
    act((d) => { d.training = f; return { ok: true, value: undefined }; });
    flash(f === 'AUTO' ? '训练改为自动安排' : `本周训练：${FOCUS_NAME[f]}`);
  };
  const next = trainingFocusOf(game, data, PLAYER_CLUB_ID);
  const avg = roster.reduce((a, p) => a + (p.fatigue ?? 0), 0) / Math.max(1, roster.length);
  const last = game.lastTraining;
  const lastByPlayer = new Map(last?.players.map((x) => [x.playerId, x]) ?? []);
  const topGrower = last && last.focus !== 'REST'
    ? [...last.players].sort((a, b) => b.ovrDelta - a.ovrDelta)[0]
    : undefined;
  const masteryLines = last?.players.flatMap((pl) => pl.masteryGains.map((m) => `${pl.name}（${data.heroById[m.heroId]?.name ?? m.heroId} +${m.delta}）`)) ?? [];

  return (
    <div className="grid">
      <section className="card wide">
        <h2>本周训练</h2>
        <p className="dim">每周一结算一次，全队一起练。练得越多越累，疲劳超过 50 比赛就会发挥变差；年轻选手长得快，27 岁后很难再涨，30 岁后会慢慢下滑。</p>
        <div className="tactics">
          <label className={`tactic ${game.training === 'AUTO' ? 'on' : ''}`}>
            <input type="radio" name="focus" checked={game.training === 'AUTO'} onChange={() => choose('AUTO')} />
            <b>自动安排（推荐）</b>
            <span>全队平均疲劳到 {data.growth.autoRestFatigue} 就休息一周，其余几周轮流练操作、意识、配合、心态、英雄熟练度</span>
            {game.training === 'AUTO' && roster.length > 0 && <span>现在平均疲劳 {Math.round(avg)}，下周一会安排：{FOCUS_NAME[next]}</span>}
          </label>
          {TRAINING_FOCI.map((f) => (
            <label key={f} className={`tactic ${game.training === f ? 'on' : ''}`}>
              <input type="radio" name="focus" checked={game.training === f} onChange={() => choose(f)} />
              <b>{FOCUS_NAME[f]}</b>
              <span>{FOCUS_HINT[f]}</span>
              <span>{f === 'REST' ? '疲劳 −' + data.growth.fatigueRestRecovery + ' · 免费' : `疲劳 +${data.growth.fatiguePerTrainingWeek} · 每周 ${money(cost)}`}</span>
            </label>
          ))}
        </div>
        {tired.length > 0 && game.training !== 'AUTO' && <p className="bad">{tired.map((p) => p.name).join('、')} 已经比较累了（疲劳 ≥50），可以考虑练一周“休息”。</p>}
      </section>
      {last && (
        <section className="card wide">
          <h3>上周训练成果 <span className="dim small-text">第 {last.season} 季 第 {last.week} 周 · {FOCUS_NAME[last.focus]}</span></h3>
          {last.focus === 'REST' ? (
            <p className="small-text good">全队休息一周，队员疲劳大幅恢复（{last.players.map((p) => `${p.name} 疲劳 ${signed(p.fatigueDelta)}`).join('、')}）。</p>
          ) : (
            <div className="small-text">
              {topGrower && topGrower.ovrDelta > 0 && <div>📈 进步最快：<b>{topGrower.name}</b>（能力 {signed(topGrower.ovrDelta)}，单项 {signed(topGrower.focusAttrDelta)}）</div>}
              {last.chemistryGain > 0 && <div className="good">🤝 全队两两默契 +{last.chemistryGain}</div>}
              {masteryLines.length > 0 && <div>🎯 英雄熟练度提升：{masteryLines.join('、')}</div>}
              <div className="dim">全队明细：{last.players.map((p) => `${p.name} 能力 ${signed(p.ovrDelta)}`).join(' · ')}</div>
            </div>
          )}
        </section>
      )}
      <section className="card wide">
        <h3>队员状况</h3>
        <table className="table">
          <thead><tr><th>选手</th><th className="hide-sm">位置</th><th>能力</th>{last && <th>上周</th>}<th className="hide-sm">年龄</th><th className="hide-sm">成长空间</th><th>疲劳</th><th>士气</th><th className="hide-sm">状态</th></tr></thead>
          <tbody>
            {roster.map((p) => {
              const lp = lastByPlayer.get(p.id);
              return (
                <tr key={p.id}>
                  <td><PlayerName p={p} show={showPlayer} /></td>
                  <td className="hide-sm"><Roles p={p} /></td>
                  <td><Ovr p={p} /></td>
                  {last && (
                    <td className={`small-text keep ${!lp ? 'dim' : last.focus === 'REST' ? 'good' : lp.ovrDelta > 0 ? 'good' : lp.ovrDelta < 0 ? 'bad' : 'dim'}`}>
                      {!lp ? '—' : last.focus === 'REST' ? `疲劳 ${signed(lp.fatigueDelta)}` : signed(lp.ovrDelta)}
                    </td>
                  )}
                  <td className="hide-sm">{p.age}</td>
                  <td className="hide-sm">{growthRoom(p.potential, playerOverall(p))}</td>
                  <td><Fatigue p={p} /></td>
                  <td><Morale p={p} /></td>
                  <td className="hide-sm"><Form p={p} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {roster.length === 0 && <p className="dim">还没有选手。</p>}
      </section>
    </div>
  );
}
