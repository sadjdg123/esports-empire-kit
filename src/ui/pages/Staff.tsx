import { AUTHORITIES, STAFF_ROLES, type Authority, type StaffMember, type StaffRole } from '../../core/types';
import { approvePending, describePendingContext, fireStaff, hireStaff, hiredStaff, mainSkill, rejectPending, renewStaff, setAuthority, setDelegationLimits, staffReleaseFee, staffWages } from '../../game';
import type { PageProps } from '../App';
import { Portrait } from '../components/Portrait';
import { lookFor } from '../../render/pixel/chibi';
import { money } from '../labels';

const SKILL_NAME = { scouting: '识人', leading: '带队', money: '理财' } as const;
const LIMITS = [10000, 30000, 50000, 100000];
const STATUS = { DONE: '已办', ADVICE: '建议', APPROVED: '已批', REJECTED: '驳回', EXPIRED: '过期' } as const;

/** The last few things this staff member did or suggested, newest first. */
function Recent({ game, role }: { game: PageProps['game']; role: StaffRole }) {
  const list = game.decisionLog.filter((e) => e.role === role).slice(-4).reverse();
  if (list.length === 0) return <p className="dim small-text">还没做过决定。</p>;
  return (
    <ul className="plain decisions small-text">
      {list.map((e) => (
        <li key={e.id}>
          <b className="tag">{STATUS[e.status as keyof typeof STATUS] ?? e.status}</b> {e.text} <span className="dim">— {e.reason}{e.result ? `（结果：${e.result}）` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

function Skills({ s }: { s: StaffMember }) {
  return (
    <div className="staff-skills">
      {(Object.keys(SKILL_NAME) as (keyof typeof SKILL_NAME)[]).map((k) => (
        <div key={k} className="skill-row">
          <span className="dim small-text">{SKILL_NAME[k]}</span>
          <span className="bar"><i style={{ width: `${s.skills[k]}%` }} /></span>
          <b className="small-text">{s.skills[k]}</b>
        </div>
      ))}
    </div>
  );
}

/** Staff (P3, T30): hire a manager, a coach and a finance chief, and decide how freely each may act. */
export function StaffPage({ game, data, act, flash, ask, go }: PageProps) {
  const cfg = data.staff;
  const hire = (s: StaffMember) => {
    ask(`聘请${cfg.roles[s.role].name} ${s.name}？签约费 ${money(s.signingFee)}，之后每周工资 ${money(s.salaryPerWeek)}，合同 ${cfg.market.contractYears} 个赛季。`, '聘请', () => {
      const r = act((d) => hireStaff(d, data, s.id));
      flash(r.ok ? `${s.name} 上任了，权限是"${cfg.authorityNames[game.delegation.roles[s.role].authority === 'SELF' ? 'SMALL' : game.delegation.roles[s.role].authority]}"` : r.error);
    });
  };
  const fire = (role: StaffRole, s: StaffMember) => {
    ask(`解雇 ${s.name}？要付违约金 ${money(staffReleaseFee(game, data, s))}，${cfg.roles[role].name}的工作回到你手上。`, '解雇', () => {
      const r = act((d) => fireStaff(d, data, role));
      flash(r.ok ? `已解雇 ${s.name}` : r.error);
    });
  };
  const renew = (role: StaffRole, s: StaffMember) => {
    ask(`和 ${s.name} 续约 ${cfg.market.contractYears} 个赛季？续约费 ${money(s.signingFee)}，工资不变。`, '续约', () => {
      const r = act((d) => renewStaff(d, data, role));
      flash(r.ok ? `${s.name} 续约到第 ${r.value} 赛季` : r.error);
    });
  };
  const authority = (role: StaffRole, a: Authority) => {
    const r = act((d) => setAuthority(d, role, a));
    if (!r.ok) flash(r.error);
  };
  const limits = (limit: number, protectTop: number) => {
    const r = act((d) => setDelegationLimits(d, limit, protectTop));
    if (!r.ok) flash(r.error);
  };
  const decide = (id: number, yes: boolean) => {
    const p = game.pending.find((x) => x.id === id);
    const r = act((d) => (yes ? approvePending(d, data, id) : rejectPending(d, data, id)));
    flash(r.ok ? `${yes ? '已批准' : '已驳回'}：${p?.text ?? ''}` : r.error);
  };
  const candidates = (role: StaffRole) => game.staffMarket.map((id) => game.staff[id]!).filter((s) => s.role === role)
    .sort((a, b) => mainSkill(data, b) - mainSkill(data, a) || a.id.localeCompare(b.id));

  return (
    <div className="grid">
      <section className="card wide">
        <h2>负责人</h2>
        <p className="dim">雇人替你管日常的事。每个岗位可以选：亲自管（他只给建议）、小事自己办（额度内自己做，超出的交给你批）、全权托管。现在负责人每周工资合计 {money(staffWages(game))}。</p>
        <button className="small" onClick={() => go('reports')}>📊 看报表和决策日志</button>
        <div className="row wrap">
          <label className="small-text">单笔额度
            <select value={game.delegation.limit} onChange={(e) => limits(Number(e.target.value), game.delegation.protectTop)}>
              {LIMITS.map((v) => <option key={v} value={v}>{money(v)} 以内自己做主</option>)}
            </select>
          </label>
          <label className="small-text">核心保护
            <select value={game.delegation.protectTop} onChange={(e) => limits(game.delegation.limit, Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v === 0 ? '不保护' : `首发最强 ${v} 人不卖`}</option>)}
            </select>
          </label>
        </div>
      </section>
      {game.pending.length > 0 && (
        <section className="card wide pending">
          <h2>待你拍板 <span className="badge">{game.pending.length}</span></h2>
          <ul className="plain">
            {game.pending.map((p) => {
              const ctx = describePendingContext(game, data, p);
              return (
                <li key={p.id} className={`pending-item ${p.big ? 'big' : ''}`}>
                  <div className="small-text dim">{cfg.roles[p.role].name} {game.staff[p.staffId]?.name ?? ''}{p.big ? ' · 大事' : ''} · {Math.max(0, p.expiresDay - game.calendar.day)} 天后作废</div>
                  <div><b>{p.text}</b></div>
                  <div className="small-text">为什么：{p.reason}</div>
                  {ctx.detail && <div className="small-text dim">{ctx.detail}</div>}
                  <div className="small-text warn-text">{ctx.trigger}</div>
                  <div className="small-text">
                    {p.cost === 0 ? '不花钱' : p.cost > 0 ? `进账 ${money(p.cost)}` : `花费 ${money(-p.cost)}`}
                    {p.cost !== 0 && <span className="dim">（批准后资金：{money(game.funds)} → <b className={ctx.fundsAfter < 0 ? 'bad' : ''}>{money(ctx.fundsAfter)}</b>）</span>}
                  </div>
                  <div className="row pending-buttons">
                    <button className="primary" onClick={() => decide(p.id, true)}>批准</button>
                    <button onClick={() => decide(p.id, false)}>驳回</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {STAFF_ROLES.map((role) => {
        const s = hiredStaff(game, role);
        const slot = game.delegation.roles[role];
        return (
          <section key={role} className="card staff-role">
            <h3>{cfg.roles[role].name} <span className="dim small-text">{cfg.roles[role].description}</span></h3>
            {s ? (
              <div className="staff-card hired">
                <div className="row">
                  <Portrait look={lookFor(s.id, game.club.color)} size={44} />
                  <div>
                    <b>{s.name}</b> <span className="dim small-text">{cfg.styles[s.style].name} · {s.origin === 'RETIRED' ? '退役选手' : '职业负责人'}</span>
                    <div className="small-text">周薪 {money(s.salaryPerWeek)} · 合同到第 {s.hired?.until} 赛季</div>
                  </div>
                </div>
                <Skills s={s} />
                <div className="authority">
                  {AUTHORITIES.map((a) => (
                    <label key={a} className={`tactic ${slot.authority === a ? 'on' : ''}`}>
                      <input type="radio" name={`auth-${role}`} checked={slot.authority === a} onChange={() => authority(role, a)} />
                      <b>{cfg.authorityNames[a]}</b>
                    </label>
                  ))}
                </div>
                <h4 className="small-text">最近的决定</h4>
                <Recent game={game} role={role} />
                <div className="row">
                  {s.hired && s.hired.until <= game.calendar.season && <button className="small" onClick={() => renew(role, s)}>续约</button>}
                  <button className="small link danger" onClick={() => fire(role, s)}>解雇</button>
                </div>
              </div>
            ) : (
              <>
                <p className="dim small-text">空缺：这部分现在由你亲自管。下面是这个休赛期的候选人。</p>
                {candidates(role).length === 0 && <p className="dim small-text">暂时没有候选人，下个休赛期会有新的一批。</p>}
                <ul className="plain staff-list">
                  {candidates(role).map((c) => (
                    <li key={c.id} className="staff-card">
                      <div className="row between">
                        <div><b>{c.name}</b> <span className="dim small-text">{cfg.styles[c.style].name}{c.origin === 'RETIRED' ? ' · 退役选手' : ''}</span></div>
                        <button className="primary small" onClick={() => hire(c)} disabled={game.funds < c.signingFee}>聘请</button>
                      </div>
                      <Skills s={c} />
                      <div className="dim small-text">周薪 {money(c.salaryPerWeek)} · 签约费 {money(c.signingFee)} · {cfg.styles[c.style].description}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
