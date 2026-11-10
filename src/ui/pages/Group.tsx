import { useState } from 'react';
import {
  BRANCH_KINDS, PLAYER_CLUB_ID, branchActive, branchMatchDay, branchSponsorBonus, branchStandings, branchWeeklyMoney, canOpenBranch, openBranch, standings, weeklyMoney,
  type BranchKind,
} from '../../game';
import type { PageProps } from '../App';
import { money } from '../labels';
import { BranchPage } from './Branch';

const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'];

/** The group (P4): the MOBA club and the other divisions side by side; opens a division's own window. */
export function GroupPage(props: PageProps) {
  const { game, data, act, flash, ask, go } = props;
  const [kind, setKind] = useState<BranchKind | null>(null);
  if (kind && game.branches[kind]) return <BranchPage {...props} kind={kind} back={() => setKind(null)} />;

  const open = (k: BranchKind) => {
    const cfg = data.branches.kinds[k];
    const now = game.calendar.phase === 'PRESEASON';
    ask(`开办${cfg.name}？开办费 ${money(cfg.open.cost)}，之后每周运营费 ${money(cfg.weeklyUpkeep)}，还要付选手工资。${now ? '现在是休赛期，本赛季就能参赛。' : '赛季已经开始，要到下个赛季才参赛，现在可以先签人。'}`, '开办', () => {
      const r = act((d) => openBranch(d, data, k));
      flash(r.ok ? `${cfg.name}成立了` : r.error);
      if (r.ok) setKind(k);
    });
  };
  const moba = weeklyMoney(game, data);
  const mobaRank = standings(game).findIndex((r) => r.clubId === PLAYER_CLUB_ID) + 1;
  const mobaRow = standings(game)[mobaRank - 1];
  const total = moba.net + BRANCH_KINDS.reduce((a, k) => a + (game.branches[k] ? branchWeeklyMoney(game, data, game.branches[k]!).net : 0), 0);
  const sponsorBonus = branchSponsorBonus(game, data);

  return (
    <div className="grid">
      <section className="card wide">
        <h2>{game.club.name} 电竞集团</h2>
        <p className="small-text">
          声望 {Math.round(game.club.reputation)} · 资金 {money(game.funds)} · 全集团每周固定收支 <b className={total < 0 ? 'bad' : 'good'}>{money(total)}</b>（不含比赛奖金）
          {sponsorBonus > 0 ? <> · 集团赞助加成 <b className="good">+{Math.round(sponsorBonus * 100)}%</b></> : null}
        </p>
        <p className="dim small-text">三个项目各打各的联赛，选手和规则都不一样；钱、声望、赞助是一家的，新开分部参赛后还会提高全集团的每周赞助。</p>
      </section>
      <section className="card">
        <h3>MOBA 分部 <span className="dim small-text">5v5 推塔</span></h3>
        <div className="small-text">本季 {mobaRow?.wins ?? 0} 胜 {mobaRow?.losses ?? 0} 负 · 第 {mobaRank} 名 · 每周 {money(moba.net)}</div>
        <div className="row"><button className="small" onClick={() => go('overview')}>看概况</button><button className="small" onClick={() => go('lineup')}>阵容</button></div>
      </section>
      {BRANCH_KINDS.map((k) => {
        const cfg = data.branches.kinds[k];
        const b = game.branches[k];
        const bonusPct = Math.round(cfg.sponsorBonus * 100);
        if (!b) {
          const can = canOpenBranch(game, data, k);
          return (
            <section key={k} className="card">
              <h3>{cfg.name} <span className="dim small-text">{cfg.game} · 还没开</span></h3>
              <div className="small-text">条件：声望 {cfg.open.reputation}（现在 {Math.round(game.club.reputation)}）、开办费 {money(cfg.open.cost)}</div>
              <div className="small-text dim">每队 {cfg.squad} 人。{k === 'FPS' ? '5 打 5 攻防爆破，先赢 7 回合。' : '3 人团体赛，一对一打牌，每台三局两胜。'}参赛后集团每周赞助 +{bonusPct}%。</div>
              <button className="primary small" disabled={!can.ok} onClick={() => open(k)}>开办</button>
              {!can.ok && <div className="small-text bad">{can.error}</div>}
            </section>
          );
        }
        const active = branchActive(game, b);
        const table = branchStandings(game, b);
        const rank = table.findIndex((r) => r.teamId === PLAYER_CLUB_ID) + 1;
        const me = table[rank - 1];
        const m = branchWeeklyMoney(game, data, b);
        const nextDay = active && !b.finalDone ? branchMatchDay(game, data, b, Math.min(b.round, b.schedule.length)) : null;
        const short = b.roster.length < cfg.squad;
        return (
          <section key={k} className="card">
            <h3>{cfg.name} <span className="dim small-text">{cfg.game}{b.titles > 0 ? ` · 🏆×${b.titles}` : ''}</span></h3>
            {active ? <div className="small-text">本季 {me?.wins ?? 0} 胜 {me?.losses ?? 0} 负 · 第 {rank} 名 · 每周 {money(m.net)} · 赞助 <span className="good">+{bonusPct}%</span></div>
              : <div className="small-text">第 {b.startSeason} 赛季开始参赛（届时赞助 +{bonusPct}%） · 每周 {money(m.net)}</div>}
            <div className="small-text dim">
              {b.managed && b.director ? `总监 ${b.director.name} 在管` : '你亲自管'}
              {nextDay !== null && nextDay >= game.calendar.day ? ` · 下一场：周${WEEKDAY[cfg.matchWeekday]}（${nextDay - game.calendar.day} 天后）` : b.finalDone ? ' · 本季打完了' : ''}
            </div>
            {short && <div className="small-text bad">只有 {b.roster.length} 人，凑不齐 {cfg.squad} 人会判负</div>}
            <button className="primary small" onClick={() => setKind(k)}>进入{cfg.name}</button>
          </section>
        );
      })}
    </div>
  );
}
