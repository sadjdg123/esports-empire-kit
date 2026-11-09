import { useState } from 'react';
import { STAFF_ROLES, type StaffRole } from '../../core/types';
import { reportWeeks, seasonReport, weekReport, type DecisionEntry, type LedgerKind, type MoneyBreakdown, type StaffPerformance } from '../../game';
import type { PageProps } from '../App';
import { money } from '../labels';

const KIND_MONEY: Record<LedgerKind, string> = {
  SALARY: '选手工资', SPONSOR: '赞助', PRIZE: '奖金', SIGNING: '签约费', RELEASE: '解约', TRANSFER: '转会', LEAGUE: '联赛分成',
  MERCH: '周边', TRAINING: '训练', FACILITY: '设施', UPKEEP: '设施维护', STAFF: '负责人', BRANCH: '分部开办与运营',
};
const KIND_DECISION: Record<string, string> = {
  SIGN: '签人', RENEW: '续约', SELL: '卖人', REJECT: '拒绝报价', TRAINING: '训练', TACTIC: '战术', SPONSOR: '赞助', RESCUE: '救急', FACILITY: '设施',
};
/** Decisions that get a result later (signings at the season's end, match plans after the match). */
const HAS_RESULT = new Set(['SIGN', 'RENEW', 'TACTIC']);
const STATUS: Record<DecisionEntry['status'], string> = { DONE: '已办', ADVICE: '建议', APPROVED: '已批', REJECTED: '驳回', EXPIRED: '过期' };

function MoneyTable({ m }: { m: MoneyBreakdown }) {
  const rows = (side: Partial<Record<LedgerKind, number>>) => (Object.entries(side) as [LedgerKind, number][]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return (
    <table className="report-money">
      <tbody>
        {rows(m.income).map(([k, v]) => <tr key={`i${k}`}><td>{KIND_MONEY[k]}</td><td className="num good">{money(v)}</td></tr>)}
        <tr className="sum-row"><td>收入合计</td><td className="num good">{money(m.totalIncome)}</td></tr>
        {rows(m.expense).map(([k, v]) => <tr key={`e${k}`}><td>{KIND_MONEY[k]}</td><td className="num bad">{money(v)}</td></tr>)}
        <tr className="sum-row"><td>支出合计</td><td className="num bad">{money(m.totalExpense)}</td></tr>
        <tr className="sum-row"><td><b>净收支</b></td><td className={`num ${m.net < 0 ? 'bad' : 'good'}`}><b>{money(m.net)}</b></td></tr>
      </tbody>
    </table>
  );
}

function Entry({ e }: { e: DecisionEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`log-entry ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
      <div><b className="tag">{STATUS[e.status]}</b> {e.text}</div>
      {open && (
        <div className="small-text log-detail">
          <div>为什么：{e.reason}</div>
          <div>钱：{e.cost === 0 ? '不花钱' : e.cost > 0 ? `进账 ${money(e.cost)}` : `花费 ${money(-e.cost)}`}</div>
          {(e.result || HAS_RESULT.has(e.kind)) && <div>结果：{e.result ?? (e.status === 'ADVICE' ? '只是建议' : '还没有结果')}</div>}
          <div className="dim">{e.staffName} · 第 {e.season} 赛季 第 {Math.floor(e.day / 7) + 1} 周</div>
        </div>
      )}
    </li>
  );
}

function WeekTab({ game, data }: Pick<PageProps, 'game' | 'data'>) {
  const weeks = reportWeeks(game);
  const [week, setWeek] = useState<number | null>(null);
  const shown = week ?? weeks[0] ?? 0;
  const r = weekReport(game, shown);
  return (
    <>
      <section className="card wide">
        <div className="row between">
          <h3>第 {shown + 1} 周</h3>
          {weeks.length > 1 && (
            <select value={shown} onChange={(e) => setWeek(Number(e.target.value))}>
              {weeks.map((w) => <option key={w} value={w}>第 {w + 1} 周</option>)}
            </select>
          )}
        </div>
        {r.money.totalIncome === 0 && r.money.totalExpense === 0 ? <p className="dim small-text">这周没有进出账。</p> : <MoneyTable m={r.money} />}
      </section>
      {STAFF_ROLES.map((role) => (
        <section key={role} className="card">
          <h3>{data.staff.roles[role].name}</h3>
          {r.decisions[role].length === 0 ? <p className="dim small-text">这周没有动作。</p> : (
            <ul className="plain decisions small-text">{[...r.decisions[role]].reverse().map((e) => <Entry key={e.id} e={e} />)}</ul>
          )}
        </section>
      ))}
    </>
  );
}

function Performance({ p, name }: { p: StaffPerformance; name: string }) {
  return (
    <section className="card">
      <h3>{name} <span className="dim small-text">{p.staffName ?? '空缺（你亲自管）'}</span></h3>
      <div className="small-text">办了 {p.done} 件{p.approved > 0 ? `（其中你批的 ${p.approved}）` : ''} · 建议 {p.advice} · 驳回 {p.rejected} · 过期 {p.expired}</div>
      {(p.spent !== 0 || p.earned !== 0) && <div className="small-text">经手花费 {money(-p.spent)}{p.earned > 0 ? ` · 进账 ${money(p.earned)}` : ''}</div>}
      {p.role === 'MANAGER' && (p.signings.length === 0 ? <p className="dim small-text">本季没签人。</p> : (
        <table className="report-money">
          <thead><tr><th>签下的人</th><th className="num">场</th><th className="num">胜</th></tr></thead>
          <tbody>{p.signings.map((s) => <tr key={s.playerId}><td className="keep">{s.name}{s.stillHere ? '' : '（已离队）'}</td><td className="num">{s.played}</td><td className="num">{s.wins}</td></tr>)}</tbody>
        </table>
      ))}
      {p.role === 'COACH' && <div className="small-text">排过 {p.plans} 场战术，赢了 {p.planWins} 场{p.plans > 0 ? `（${Math.round((p.planWins / p.plans) * 100)}%）` : ''} · 安排休息 {p.restWeeks} 周</div>}
      {p.role === 'FINANCE' && <div className="small-text">本季最低资金 {money(p.lowestFunds)} · 资金为负 {p.weeksInDebt} 周</div>}
    </section>
  );
}

function SeasonTab({ game, data }: Pick<PageProps, 'game' | 'data'>) {
  const r = seasonReport(game);
  return (
    <>
      <section className="card wide">
        <h3>第 {r.season} 赛季</h3>
        <p className="small-text">战绩 {r.wins} 胜 {r.losses} 负 · 资金 {money(r.fundsStart)} → <b>{money(r.fundsNow)}</b></p>
        <MoneyTable m={r.money} />
      </section>
      {r.staff.map((p) => <Performance key={p.role} p={p} name={data.staff.roles[p.role].name} />)}
    </>
  );
}

function LogTab({ game, data }: Pick<PageProps, 'game' | 'data'>) {
  const [role, setRole] = useState<StaffRole | 'ALL'>('ALL');
  const [kind, setKind] = useState<string>('ALL');
  const kinds = [...new Set(game.decisionLog.map((e) => e.kind))];
  const list = game.decisionLog.filter((e) => (role === 'ALL' || e.role === role) && (kind === 'ALL' || e.kind === kind)).reverse();
  return (
    <section className="card wide">
      <div className="filters">
        {(['ALL', ...STAFF_ROLES] as const).map((r) => (
          <button key={r} className={role === r ? 'chip on' : 'chip'} onClick={() => setRole(r)}>{r === 'ALL' ? '全部' : data.staff.roles[r].name}</button>
        ))}
      </div>
      {kinds.length > 1 && (
        <div className="filters">
          {['ALL', ...kinds].map((k) => (
            <button key={k} className={kind === k ? 'chip on' : 'chip'} onClick={() => setKind(k)}>{k === 'ALL' ? '全部类型' : KIND_DECISION[k] ?? k}</button>
          ))}
        </div>
      )}
      <p className="dim small-text">共 {list.length} 条，点一条看原因和结果。最多保留最近 {data.staff.delegation.logMax} 条。</p>
      {list.length === 0 ? <p className="dim">还没有记录。雇了负责人之后，他们做的每件事都会记在这里。</p> : (
        <ul className="plain decisions small-text">{list.map((e) => <Entry key={e.id} e={e} />)}</ul>
      )}
    </section>
  );
}

/** Group reports (P3, T33): this week, this season, and the decision log. */
export function ReportsPage({ game, data }: PageProps) {
  const [tab, setTab] = useState<'week' | 'season' | 'log'>('week');
  return (
    <div className="grid">
      <div className="filters wide tabs">
        {([['week', '本周'], ['season', '本赛季'], ['log', '决策日志']] as const).map(([k, label]) => (
          <button key={k} className={tab === k ? 'chip on' : 'chip'} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'week' && <WeekTab game={game} data={data} />}
      {tab === 'season' && <SeasonTab game={game} data={data} />}
      {tab === 'log' && <LogTab game={game} data={data} />}
    </div>
  );
}
