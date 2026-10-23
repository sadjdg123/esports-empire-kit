import { useState } from 'react';
import { validateLineup } from '../../core/config';
import { DEFAULT_MASTERY, ROLES, TACTICS, type Pick, type Role, type Tactic, type TeamLineup } from '../../core/types';
import { PLAYER_CLUB_ID, recommendLineup, rosterOf, setLineup } from '../../game';
import type { PageProps } from '../App';
import { Form, Ovr } from '../components/PlayerBits';
import { ARCHETYPE_NAME, ROLE_NAME } from '../labels';

export function LineupPage({ game, data, act, go, flash }: PageProps) {
  const roster = rosterOf(game);
  const [draft, setDraft] = useState<{ picks: Partial<Record<Role, Pick>>; tactic: Tactic }>(() => ({
    picks: Object.fromEntries((game.lineup?.picks ?? []).map((p) => [p.role, p])),
    tactic: game.lineup?.tactic ?? 'STEADY_MACRO',
  }));

  if (roster.length < data.economy.minRoster) {
    return (
      <section className="card">
        <h2>阵容</h2>
        <p>至少需要 {data.economy.minRoster} 名选手才能布阵，现在只有 {roster.length} 人。</p>
        <button className="primary" onClick={() => go('market')}>去市场签人</button>
      </section>
    );
  }

  const setPick = (role: Role, patch: Partial<Pick>) => {
    setDraft((d) => {
      const cur = d.picks[role] ?? { role, playerId: '', heroId: '' };
      const next = { ...cur, ...patch, role };
      if (patch.playerId && !patch.heroId) {
        const p = game.players[patch.playerId]!;
        const best = Object.entries(p.heroMastery).sort((a, b) => b[1] - a[1])[0];
        if (best) next.heroId = best[0];
      }
      return { ...d, picks: { ...d.picks, [role]: next } };
    });
  };

  const recommend = () => {
    const r = recommendLineup(game, data, draft.tactic);
    if (!r.ok) { flash(r.error); return; }
    setDraft({ picks: Object.fromEntries(r.value.picks.map((p) => [p.role, p])), tactic: draft.tactic });
    flash('已按位置和英雄熟练度推荐首发，记得点“保存阵容”');
  };

  const lineup: TeamLineup = { clubId: PLAYER_CLUB_ID, tactic: draft.tactic, picks: ROLES.flatMap((r) => (draft.picks[r] ? [draft.picks[r]!] : [])) };
  const issues = lineup.picks.length < 5 ? ['每个位置都要选一名选手'] : validateLineup(lineup, roster, data);
  const save = () => {
    const r = act((d) => setLineup(d, data, lineup));
    if (r.ok) { flash('阵容已保存'); go('home'); } else flash(r.error);
  };
  const usedPlayers = new Set(lineup.picks.map((p) => p.playerId));
  const usedHeroes = new Set(lineup.picks.map((p) => p.heroId));

  return (
    <div className="grid">
      <section className="card wide">
        <div className="row between">
          <h2>首发阵容</h2>
          <button onClick={recommend}>一键推荐</button>
        </div>
        <div className="role-cards">
          {ROLES.map((role) => {
            const pick = draft.picks[role];
            const player = pick?.playerId ? game.players[pick.playerId] : undefined;
            const fit = player ? (player.primaryRole === role ? 'primary' : player.secondaryRole === role ? 'secondary' : 'off') : null;
            const mastery = player && pick?.heroId ? player.heroMastery[pick.heroId] ?? DEFAULT_MASTERY : null;
            return (
              <div key={role} className={`role-card ${fit === 'off' ? 'warn' : ''}`}>
                <div className="role-title">{ROLE_NAME[role]}</div>
                <select value={pick?.playerId ?? ''} onChange={(e) => setPick(role, { playerId: e.target.value, heroId: '' })}>
                  <option value="">选择选手</option>
                  {roster.map((p) => (
                    <option key={p.id} value={p.id} disabled={usedPlayers.has(p.id) && pick?.playerId !== p.id}>
                      {p.name}（{ROLE_NAME[p.primaryRole]}{p.primaryRole === role ? ' ✓' : p.secondaryRole === role ? ' 副' : ''}）
                    </option>
                  ))}
                </select>
                {player && <div className="dim"><Ovr p={player} /> <Form p={player} /></div>}
                {fit === 'secondary' && <div className="hint">副位置：发挥略打折</div>}
                {fit === 'off' && <div className="hint bad">不擅长这个位置：发挥明显下降</div>}
                <select value={pick?.heroId ?? ''} onChange={(e) => setPick(role, { heroId: e.target.value })} disabled={!player}>
                  <option value="">选择英雄</option>
                  {data.heroes.map((h) => (
                    <option key={h.id} value={h.id} disabled={usedHeroes.has(h.id) && pick?.heroId !== h.id}>
                      {h.name}·{ARCHETYPE_NAME[h.archetype]} 熟练度 {Math.round(player?.heroMastery[h.id] ?? DEFAULT_MASTERY)}{h.preferredRoles.includes(role) ? '' : '（非本位置英雄）'}
                    </option>
                  ))}
                </select>
                {mastery !== null && <div className={mastery >= 70 ? 'good' : mastery < 45 ? 'bad' : 'dim'}>熟练度 {Math.round(mastery)}{mastery < 45 ? '：不熟练，技能效果差' : ''}</div>}
                {pick?.heroId && <div className="dim small-text">{data.heroById[pick.heroId]?.skill.name}：{data.heroById[pick.heroId]?.skill.description}</div>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card wide">
        <h3>全队战术</h3>
        <div className="tactics">
          {TACTICS.map((t) => (
            <label key={t} className={`tactic ${draft.tactic === t ? 'on' : ''}`}>
              <input type="radio" name="tactic" checked={draft.tactic === t} onChange={() => setDraft((d) => ({ ...d, tactic: t }))} />
              <b>{data.match.tactics[t].name}</b>
              <span>{data.match.tactics[t].description}</span>
            </label>
          ))}
        </div>
        {issues.length > 0 && <ul className="issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        <button className="primary big" onClick={save} disabled={issues.length > 0}>保存阵容</button>
      </section>
    </div>
  );
}
