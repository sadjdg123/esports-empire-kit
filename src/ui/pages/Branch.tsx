import { useState } from 'react';
import { CARD_DECKS, type CardDeck } from '../../sim-card';
import { FPS_ROLES, FPS_TACTICS, type FpsRole, type FpsTactic } from '../../sim-fps';
import {
  PLAYER_CLUB_ID, branchActive, branchAttrName, branchExpiring, branchMarket, branchOverall, branchReleaseFee, branchRenewalAsk, branchRoster, branchStandings,
  branchWeeklyMoney, effectiveBranchTraining, fireDirector, hireDirector, recommendBranchLineup, releaseBranchPlayer, renewBranchPlayer, setBranchLineup, setBranchManaged, setBranchTraining,
  signBranchPlayer, validateBranchLineup, type BranchKind, type BranchLineup, type BranchPlayer,
} from '../../game';
import type { PageProps } from '../App';
import { BranchReplayView } from '../components/BranchReplay';
import { money } from '../labels';

type Tab = 'home' | 'players' | 'lineup' | 'matches' | 'director';
const TABS: [Tab, string][] = [['home', '概况'], ['players', '选手'], ['lineup', '阵容'], ['matches', '比赛'], ['director', '总监']];

/** One division's own window (P4, T39): squad, lineup, league, matches and its director. */
export function BranchPage({ game, data, act, flash, ask, kind, back }: PageProps & { kind: BranchKind; back: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  const [role, setRole] = useState<FpsRole | 'ALL'>('ALL'); // market filter
  const [edited, setEdited] = useState<BranchLineup | null>(null); // the lineup being edited, until saved
  const b = game.branches[kind]!;
  const cfg = data.branches.kinds[kind];
  const attrs = Object.keys(kind === 'FPS' ? data.fps.attrs : data.card.attrs);
  const roster = branchRoster(b);
  const ovr = (p: BranchPlayer) => Math.round(branchOverall(data, kind, p));
  const roleName = (r?: FpsRole) => (r ? data.fps.roles[r].name : '');
  const deckName = (d: CardDeck) => data.card.decks[d].name;
  const describe = (p: BranchPlayer) => (kind === 'FPS'
    ? `${roleName(p.primaryRole)}${p.secondaryRole ? ` / ${roleName(p.secondaryRole)}` : ''}`
    : CARD_DECKS.filter((d) => (p.decks?.[d] ?? 0) >= 55).map((d) => `${deckName(d)} ${Math.round(p.decks![d]!)}`).join(' · ') || '没有拿手卡组');
  const attrLine = (p: BranchPlayer) => attrs.map((a) => `${branchAttrName(data, kind, a)} ${Math.round(p.attrs[a] ?? 0)}`).join(' · ');

  return (
    <div className="grid">
      <div className="filters wide tabs">
        <button className="chip" onClick={back}>‹ 集团</button>
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'chip on' : 'chip'} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {b.managed && b.director && tab !== 'director' && tab !== 'matches' && (
        <p className="advice wide small-text">这个分部现在由总监 {b.director.name} 管。你改的阵容和训练，他下次做决定时会改回去；想自己管，到"总监"里收回。</p>
      )}
      {tab === 'home' && homeTab()}
      {tab === 'players' && playersTab()}
      {tab === 'lineup' && lineupTab()}
      {tab === 'matches' && matchesTab()}
      {tab === 'director' && directorTab()}
    </div>
  );

  function homeTab() {
    const table = branchStandings(game, b);
    const m = branchWeeklyMoney(game, data, b);
    const specificPlans: [string, string][] = [
      ...attrs.map((a): [string, string] => [a, `练${branchAttrName(data, kind, a)}`]),
      ...(kind === 'CARD' ? CARD_DECKS.map((d): [string, string] => [`DECK_${d}`, `练「${deckName(d)}」卡组`]) : []),
      ['REST', '休息（恢复状态）'],
    ];
    const plans: [string, string][] = [['AUTO', '自动轮换（状态差自动休息）'], ...specificPlans];
    const actual = effectiveBranchTraining(game, b);
    const actualLabel = specificPlans.find(([v]) => v === actual)?.[1] ?? actual;
    return (
      <>
        <section className="card wide">
          <h2>{cfg.name} <span className="dim small-text">{cfg.game}</span></h2>
          {!branchActive(game, b) && <p className="small-text">第 {b.startSeason} 赛季开始参赛。现在可以先签人、排阵容。</p>}
          {roster.length < cfg.squad && <p className="small-text bad">现在 {roster.length} 人，至少要 {cfg.squad} 人才能比赛，不够会判负。到"选手"里签人。</p>}
          <p className="small-text">每周：联赛分成 {money(m.league)} · 工资 {money(-m.salaries)} · 运营 {money(-m.upkeep)}{m.director > 0 ? ` · 总监 ${money(-m.director)}` : ''} · 合计 <b className={m.net < 0 ? 'bad' : 'good'}>{money(m.net)}</b></p>
          <p className="small-text dim">赢一场 {money(cfg.prizeWin)}，输一场 {money(cfg.prizeLoss)}；冠军 {money(cfg.finalPrize.champion)}，亚军 {money(cfg.finalPrize.runnerUp)}。常规赛前两名打总决赛。</p>
          <div className="row small-text">
            <label>本周训练{' '}
              <select value={b.training} onChange={(e) => { const r = act((d) => setBranchTraining(d, kind, e.target.value)); if (!r.ok) flash(r.error); }}>
                {plans.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            {b.training === 'AUTO' && <span className="dim">（本周：{actualLabel}）</span>}
          </div>
        </section>
        {b.schedule.length > 0 && (
          <section className="card">
            <h3>积分榜 <span className="dim small-text">第 {Math.min(b.round + 1, b.schedule.length)} / {b.schedule.length} 轮</span></h3>
            <table className="report-money">
              <thead><tr><th>#</th><th>队伍</th><th className="num">胜</th><th className="num">负</th></tr></thead>
              <tbody>{table.map((r, i) => <tr key={r.teamId} className={r.teamId === PLAYER_CLUB_ID ? 'me' : ''}><td>{i + 1}</td><td className="keep">{r.name}</td><td className="num">{r.wins}</td><td className="num">{r.losses}</td></tr>)}</tbody>
            </table>
          </section>
        )}
        {b.history.length > 0 && (
          <section className="card">
            <h3>历届成绩</h3>
            <ul className="plain small-text">{[...b.history].reverse().map((h) => <li key={h.season}>第 {h.season} 赛季：{h.result === 'CHAMPION' ? '🏆 冠军' : h.result === 'FINAL' ? '亚军' : `第 ${h.rank} 名`}（{h.wins} 胜 {h.losses} 负）· 冠军 {h.champion}</li>)}</ul>
          </section>
        )}
      </>
    );
  }

  function PlayerRow({ p, children }: { p: BranchPlayer; children: React.ReactNode }) {
    return (
      <li className="staff-card">
        <div className="row between">
          <div><b>{p.name}</b> <span className="dim small-text">{p.age} 岁 · 能力 {ovr(p)}{p.form >= 3 ? ' · 状态好' : p.form <= -3 ? ' · 状态差' : ''}</span></div>
          <div className="row">{children}</div>
        </div>
        <div className="small-text">{describe(p)}</div>
        <div className="small-text dim">{attrLine(p)}</div>
      </li>
    );
  }

  function playersTab() {
    const expiring = new Set(branchExpiring(game, b).map((p) => p.id));
    const market = branchMarket(b).filter((p) => role === 'ALL' || p.primaryRole === role).sort((x, y) => ovr(y) - ovr(x));
    const sign = (p: BranchPlayer) => { const r = act((d) => signBranchPlayer(d, data, kind, p.id)); flash(r.ok ? `签下 ${p.name}，签约费 ${money(p.signingFee)}` : r.error); };
    const release = (p: BranchPlayer) => ask(`与 ${p.name} 解约要付 ${money(branchReleaseFee(p))}。`, '确认解约', () => { const r = act((d) => releaseBranchPlayer(d, data, kind, p.id)); flash(r.ok ? `已与 ${p.name} 解约` : r.error); });
    const renew = (p: BranchPlayer) => ask(`和 ${p.name} 续约 ${cfg.contractYears} 个赛季？周薪 ${money(branchRenewalAsk(data, kind, p))}（现在 ${money(p.salaryPerWeek)}）。`, '续约', () => { const r = act((d) => renewBranchPlayer(d, data, kind, p.id)); flash(r.ok ? `${p.name} 续约到第 ${r.value} 赛季` : r.error); });
    return (
      <>
        <section className="card wide">
          <h3>我的队伍 <span className="dim small-text">{roster.length} / {cfg.rosterMax} 人，首发 {cfg.squad} 人</span></h3>
          {roster.length === 0 && <p className="dim small-text">还没有选手。从下面的自由市场签。</p>}
          <ul className="plain staff-list">
            {roster.map((p) => (
              <PlayerRow key={p.id} p={p}>
                {expiring.has(p.id) && <button className="small" onClick={() => renew(p)}>续约</button>}
                <button className="small link danger" onClick={() => release(p)}>解约</button>
              </PlayerRow>
            ))}
          </ul>
          <p className="dim small-text">工资和合同：{roster.map((p) => `${p.name} ${money(p.salaryPerWeek)}/周 到第 ${p.contractUntil} 季${expiring.has(p.id) ? '（本季到期）' : ''}`).join('；') || '—'}</p>
        </section>
        <section className="card wide">
          <div className="row between">
            <h3>自由市场 <span className="dim small-text">每个赛季换一批</span></h3>
            {kind === 'FPS' && (
              <div className="filters">
                <button className={role === 'ALL' ? 'chip on' : 'chip'} onClick={() => setRole('ALL')}>全部</button>
                {FPS_ROLES.map((r) => <button key={r} className={role === r ? 'chip on' : 'chip'} onClick={() => setRole(r)}>{roleName(r)}</button>)}
              </div>
            )}
          </div>
          <ul className="plain staff-list">
            {market.map((p) => (
              <PlayerRow key={p.id} p={p}>
                <span className="small-text keep">{money(p.salaryPerWeek)}/周</span>
                <button className="primary small" onClick={() => sign(p)} disabled={roster.length >= cfg.rosterMax}>签约</button>
              </PlayerRow>
            ))}
          </ul>
        </section>
      </>
    );
  }

  function lineupTab() {
    const start = (): BranchLineup | null => (b.lineup && validateBranchLineup(data, b, b.lineup).length === 0 ? b.lineup : recommendBranchLineup(data, kind, roster));
    const draft = edited && edited.kind === kind ? edited : start();
    const setDraft = setEdited;
    if (roster.length < cfg.squad || !draft) return <section className="card wide"><p className="dim">人数不够，先到"选手"里签满 {cfg.squad} 人。</p></section>;
    const issues = validateBranchLineup(data, b, draft);
    const saved = JSON.stringify(draft) === JSON.stringify(b.lineup);
    const save = () => { const r = act((d) => setBranchLineup(d, data, kind, draft)); flash(r.ok ? '阵容已保存' : r.error); if (r.ok) setEdited(null); };
    const recommend = () => setDraft(recommendBranchLineup(data, kind, roster, draft.kind === 'FPS' ? draft.tactic : 'DEFAULT'));
    const pick = (id: string) => roster.find((p) => p.id === id)!;
    return (
      <section className="card wide">
        <div className="row between"><h3>首发阵容</h3><button className="small" onClick={recommend}>一键推荐</button></div>
        {draft.kind === 'FPS' && (
          <>
            <ul className="plain">
              {FPS_ROLES.map((role) => {
                const slot = draft.slots.find((s) => s.role === role);
                const p = slot ? pick(slot.playerId) : undefined;
                const fit = !p ? '' : p.primaryRole === role ? '本职' : p.secondaryRole === role ? '副位置' : '不是他的位置';
                return (
                  <li key={role} className="lineup-row">
                    <b className="keep">{roleName(role)}</b>
                    <select value={slot?.playerId ?? ''} onChange={(e) => setDraft({ ...draft, slots: [...draft.slots.filter((s) => s.role !== role && s.playerId !== e.target.value), { playerId: e.target.value, role }] })}>
                      <option value="" disabled>选人</option>
                      {roster.map((x) => <option key={x.id} value={x.id}>{x.name}（{roleName(x.primaryRole)} {ovr(x)}）</option>)}
                    </select>
                    <span className={`small-text ${fit === '不是他的位置' ? 'bad' : 'dim'}`}>{fit}</span>
                  </li>
                );
              })}
            </ul>
            <h4 className="small-text">打法</h4>
            <div className="authority">
              {FPS_TACTICS.map((t: FpsTactic) => (
                <label key={t} className={`tactic ${draft.tactic === t ? 'on' : ''}`}>
                  <input type="radio" name="fps-tactic" checked={draft.tactic === t} onChange={() => setDraft({ ...draft, tactic: t })} />
                  <b>{data.fps.tactics[t].name}</b>
                  <span className="small-text dim">{data.fps.tactics[t].description}</span>
                </label>
              ))}
            </div>
            <p className="dim small-text">克制：默认控图 › 快攻 › 慢打残局 › 假打转点 › 默认控图。指挥的配合和心态越高，克制发挥得越足。</p>
          </>
        )}
        {draft.kind === 'CARD' && (
          <>
            <ul className="plain">
              {draft.seats.map((seat, i) => {
                const p = pick(seat.playerId);
                return (
                  <li key={i} className="lineup-row">
                    <b className="keep">第 {i + 1} 台</b>
                    <select value={seat.playerId} onChange={(e) => {
                      const seats = draft.seats.map((s) => ({ ...s }));
                      const other = seats.findIndex((s) => s.playerId === e.target.value);
                      if (other >= 0) seats[other]!.playerId = seat.playerId; // swap seats
                      seats[i]!.playerId = e.target.value;
                      setDraft({ ...draft, seats });
                    }}>
                      {roster.map((x) => <option key={x.id} value={x.id}>{x.name}（{ovr(x)}）</option>)}
                    </select>
                    <select value={seat.deck} onChange={(e) => setDraft({ ...draft, seats: draft.seats.map((s, k) => (k === i ? { ...s, deck: e.target.value as CardDeck } : s)) })}>
                      {CARD_DECKS.map((d) => <option key={d} value={d}>{deckName(d)}（熟练 {Math.round(p.decks?.[d] ?? 30)}）</option>)}
                    </select>
                  </li>
                );
              })}
            </ul>
            <p className="dim small-text">克制：快攻 › 组合技 › 控制 › 快攻，中速不怕谁也不克谁。对面每台带什么卡组不固定，排自己最熟的通常最稳。</p>
          </>
        )}
        {issues.length > 0 && <p className="bad small-text">{issues.join('；')}</p>}
        <button className="primary" disabled={issues.length > 0 || saved} onClick={save}>{saved ? '已保存' : '保存阵容'}</button>
      </section>
    );
  }

  function matchesTab() {
    const reports = [...b.reports].reverse();
    return (
      <>
        {b.replay ? <BranchReplayView replay={b.replay} data={data} /> : <section className="card wide"><p className="dim">还没有比赛。{cfg.name}的比赛每周自动打，打完这里能看回放。</p></section>}
        {reports.length > 0 && (
          <section className="card wide">
            <h3>最近的比赛</h3>
            <ul className="plain decisions small-text">
              {reports.map((r, i) => (
                <li key={i} className="log-entry">
                  <div><b className={`tag ${r.won ? 'good' : 'bad'}`}>{r.won ? '胜' : '负'}</b> 第 {r.season} 赛季 {r.final ? '总决赛' : `第 ${r.round + 1} 轮`} · 对 {r.opponent} <b>{r.score[0]}:{r.score[1]}</b></div>
                  <div className="dim">{r.keyReasons.join('；')}{r.mvp ? ` · 最佳：${r.mvp}` : ''}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  function directorTab() {
    const hire = (id: string, name: string, fee: number, salary: number) => ask(`聘请 ${name} 当${cfg.name}总监？签约费 ${money(fee)}，每周工资 ${money(salary)}。雇了以后这个分部先交给他管，随时可以收回。`, '聘请', () => {
      const r = act((d) => hireDirector(d, data, kind, id));
      flash(r.ok ? `${name} 上任，${cfg.name}交给他了` : r.error);
    });
    const fire = () => ask(`解雇总监 ${b.director!.name}？要付 ${money(b.director!.salaryPerWeek * 4)} 违约金，分部回到你手上。`, '解雇', () => { const r = act((d) => fireDirector(d, data, kind)); flash(r.ok ? '已解雇' : r.error); });
    const managed = (v: boolean) => { const r = act((d) => setBranchManaged(d, kind, v)); if (!r.ok) flash(r.error); };
    return (
      <>
        <section className="card wide">
          <h3>分部总监 <span className="dim small-text">一个人管整个分部：签人、续约、训练、排阵{kind === 'FPS' ? '、选打法' : ''}</span></h3>
          {b.director ? (
            <div className="staff-card hired">
              <div><b>{b.director.name}</b> <span className="dim small-text">能力 {b.director.skill} · 周薪 {money(b.director.salaryPerWeek)}</span></div>
              <div className="authority">
                <label className={`tactic ${!b.managed ? 'on' : ''}`}><input type="radio" name="managed" checked={!b.managed} onChange={() => managed(false)} /><b>我亲自管</b></label>
                <label className={`tactic ${b.managed ? 'on' : ''}`}><input type="radio" name="managed" checked={b.managed} onChange={() => managed(true)} /><b>交给总监</b></label>
              </div>
              <button className="small link danger" onClick={fire}>解雇</button>
            </div>
          ) : (
            <>
              <p className="dim small-text">现在你亲自管。能力高的总监看人更准，{kind === 'FPS' ? '选打法更对路，' : ''}也更贵。</p>
              <ul className="plain staff-list">
                {b.candidates.map((c) => (
                  <li key={c.id} className="staff-card row between">
                    <div><b>{c.name}</b> <span className="dim small-text">能力 {c.skill} · 周薪 {money(c.salaryPerWeek)} · 签约费 {money(c.signingFee)}</span></div>
                    <button className="primary small" disabled={game.funds < c.signingFee} onClick={() => hire(c.id, c.name, c.signingFee, c.salaryPerWeek)}>聘请</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="card wide">
          <h3>总监做过的事</h3>
          {b.log.length === 0 ? <p className="dim small-text">还没有记录。</p> : (
            <ul className="plain decisions small-text">
              {[...b.log].reverse().slice(0, 30).map((l, i) => (
                <li key={i} className="log-entry"><div>{l.text}{l.cost !== 0 ? `（${money(l.cost)}）` : ''}</div><div className="dim">第 {l.season} 赛季 第 {Math.floor(l.day / 7) + 1} 周 · {l.reason}</div></li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }
}
