import { useState } from 'react';
import { validateLineup } from '../../core/config';
import { DEFAULT_MASTERY, ROLES, TACTICS, type Pick, type Role, type Tactic, type TeamLineup } from '../../core/types';
import { PLAYER_CLUB_ID, chemistryWith, groupChemistry, recommendLineup, rosterOf, setLineup } from '../../game';
import type { PageProps } from '../App';
import { HeroSprite } from '../components/HeroSprite';
import { Fatigue, Form, Ovr } from '../components/PlayerBits';
import { ARCHETYPE_NAME, ROLE_NAME, chemistryLabel } from '../labels';

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
        {(() => {
          // Picks out of position, loud at the top (GATE-4 feedback: easy to miss inside the role cards).
          const off = lineup.picks.filter((pk) => { const p = game.players[pk.playerId]; return p && p.primaryRole !== pk.role && p.secondaryRole !== pk.role; });
          if (off.length === 0) return null;
          const lacking = ROLES.filter((r) => !roster.some((p) => p.primaryRole === r));
          return (
            <div className="advice bad">
              ⚠ {off.map((pk) => `${game.players[pk.playerId]!.name} 在打${ROLE_NAME[pk.role]}`).join('，')}，这不是他会的位置，发挥会明显打折。
              {lacking.length > 0 && <> 队里没有{lacking.map((r) => ROLE_NAME[r]).join('、')}，<button className="link" onClick={() => go('market')}>去签人</button>补一个。</>}
            </div>
          );
        })()}
        {lineup.picks.length >= 2 && (() => {
          const chem = Math.round(groupChemistry(game, lineup.picks.map((p) => p.playerId)));
          const k = data.match.coefficients.chemistry;
          return (
            <div className="chemistry">
              <div className="row between"><b>首发默契 {chem} / 100 · {chemistryLabel(chem)}</b></div>
              <div className="bar"><i style={{ width: `${chem}%` }} /></div>
              <p className="dim small-text">一起首发打比赛、练"配合"会涨，换进来的新人和队友从 0 开始。满默契时操作 +{Math.round(k.mechanics * 100)}%、配合 +{Math.round(k.teamwork * 100)}%。</p>
            </div>
          );
        })()}
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
                      {p.name}（{ROLE_NAME[p.primaryRole]}{p.primaryRole === role ? ' ✓' : p.secondaryRole === role ? ' 副' : ''}）{(p.fatigue ?? 0) >= 50 ? ` 疲劳${Math.round(p.fatigue!)}` : ''}
                    </option>
                  ))}
                </select>
                {player && <div className="dim"><Ovr p={player} /> <Form p={player} /> <Fatigue p={player} /></div>}
                {player && lineup.picks.length >= 2 && <div className="dim small-text">和其他首发默契 {Math.round(chemistryWith(game, player.id, lineup.picks.map((p) => p.playerId)))}</div>}
                {player && (player.fatigue ?? 0) >= 50 && <div className="hint">比较累：疲劳超过 50 后发挥下降</div>}
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
                {pick?.heroId && data.heroById[pick.heroId] && (
                  <div className="hero-pick">
                    <HeroSprite heroId={pick.heroId} archetype={data.heroById[pick.heroId]!.archetype} color={game.club.color} />
                    <div className="dim small-text">
                      <b>{data.heroById[pick.heroId]!.name}</b> · {data.heroById[pick.heroId]!.title}<br />
                      {data.heroById[pick.heroId]!.skill.name}：{data.heroById[pick.heroId]!.skill.description}
                    </div>
                  </div>
                )}
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
