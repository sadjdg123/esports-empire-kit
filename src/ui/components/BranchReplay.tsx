import { useEffect, useState } from 'react';
import type { GameData } from '../../core/types';
import type { BranchReplay } from '../../game';
import type { CardGame, CardNote, CardSide } from '../../sim-card';
import type { FpsEvent, FpsRound, FpsSide } from '../../sim-fps';

const REASON: Record<FpsRound['reason'], string> = { ELIMINATION: '全歼', EXPLODE: '爆破成功', DEFUSE: '拆除成功', TIMEOUT: '时间到' };
const NOTE: Record<CardNote, string> = { MISPLAY: '失误', READ: '被读牌', STABILIZE: '稳住了', COMBO: '组合技！', COMBO_STOPPED: '组合技被拦', LETHAL: '斩杀' };
const other = (s: FpsSide): FpsSide => (s === 'BLUE' ? 'RED' : 'BLUE');

/** A stepper: `step` runs from 0 to `max`, advancing on its own while playing. */
function useStepper(max: number, ms: number, key: string) {
  const [step, setStep] = useState(max);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setStep(max); setPlaying(false); }, [key, max]);
  useEffect(() => {
    if (!playing) return;
    if (step >= max) { setPlaying(false); return; }
    const id = window.setTimeout(() => setStep((s) => Math.min(max, s + 1)), ms);
    return () => window.clearTimeout(id);
  }, [playing, step, max, ms]);
  return { step, playing, play: () => { setStep(0); setPlaying(true); }, end: () => { setPlaying(false); setStep(max); } };
}

/** The player's latest match of a division, round by round (shooter) or turn by turn (cards). */
export function BranchReplayView({ replay, data }: { replay: BranchReplay; data: GameData }) {
  const title = `第 ${replay.season} 赛季 ${replay.final ? '总决赛' : `第 ${replay.round + 1} 轮`}`;
  return (
    <section className="card wide replay">
      <h3>最近一场回放 <span className="dim small-text">{title}</span></h3>
      {replay.fps && <FpsReplay replay={replay} data={data} />}
      {replay.card && <CardReplay replay={replay} data={data} />}
    </section>
  );
}

function ScoreLine({ replay, score }: { replay: BranchReplay; score: Record<FpsSide, number> }) {
  return (
    <div className="replay-score">
      <span style={{ color: replay.teams.BLUE.color }}>{replay.teams.BLUE.name}{replay.mySide === 'BLUE' ? '（我）' : ''}</span>
      <b>{score.BLUE} : {score.RED}</b>
      <span style={{ color: replay.teams.RED.color }}>{replay.teams.RED.name}{replay.mySide === 'RED' ? '（我）' : ''}</span>
    </div>
  );
}

function FpsReplay({ replay, data }: { replay: BranchReplay; data: GameData }) {
  const r = replay.fps!;
  const [n, setN] = useState(r.rounds.length);
  const round = r.rounds[n - 1]!;
  const { step, playing, play, end } = useStepper(round.events.length, 700, `${replay.season}:${replay.round}:${n}`);
  const name = (id: string) => replay.names[id] ?? id;
  const shown = round.events.slice(0, step);
  const dead = new Set(shown.filter((e): e is Extract<FpsEvent, { type: 'KILL' }> => e.type === 'KILL').map((e) => e.victim));
  const planted = shown.some((e) => e.type === 'PLANT');
  const done = step >= round.events.length;
  const before = n > 1 ? r.rounds[n - 2]!.score : { BLUE: 0, RED: 0 };
  const side = (s: FpsSide) => r.stats.filter((p) => p.side === s);
  const text = (e: FpsEvent): string => {
    switch (e.type) {
      case 'KILL': return `${name(e.killer)} 击倒 ${name(e.victim)}${e.opening ? '（首杀）' : e.trade ? '（补枪）' : e.flank ? '（绕后）' : ''}`;
      case 'FAKE': return `进攻方在 ${e.site} 点佯攻，${e.worked ? '把防守骗过去了' : '被看穿了'}`;
      case 'PLANT': return `${name(e.by)} 在 ${e.site} 点安放了装置`;
      case 'DEFUSE': return `${name(e.by)} 拆除了装置`;
      case 'EXPLODE': return '装置爆炸';
      case 'TIMEOUT': return '时间到，进攻方没能下包';
    }
  };
  return (
    <>
      <ScoreLine replay={replay} score={done ? round.score : before} />
      <div className="round-chips">
        {r.rounds.map((x) => (
          <button key={x.n} className={`round-chip ${x.winner === replay.mySide ? 'won' : 'lost'} ${x.n === n ? 'on' : ''}`} onClick={() => setN(x.n)} aria-label={`第 ${x.n} 回合`}>{x.n}</button>
        ))}
      </div>
      <div className="small-text">
        第 {round.n} 回合 · <span style={{ color: replay.teams[round.attackers].color }}>{replay.teams[round.attackers].name}</span> 进攻 {round.site} 点 ·
        装备：{(['BLUE', 'RED'] as const).map((s) => data.fps.economy.loadouts.find((l) => l.id === round.buy[s])?.name).join(' 对 ')}
      </div>
      <div className="fps-map" aria-hidden="true">
        <div className={`site ${round.site === 'A' ? 'target' : ''} ${planted && round.site === 'A' ? 'planted' : ''}`}>A</div>
        <div className="site mid">中路</div>
        <div className={`site ${round.site === 'B' ? 'target' : ''} ${planted && round.site === 'B' ? 'planted' : ''}`}>B</div>
      </div>
      <div className="fps-teams">
        {(['BLUE', 'RED'] as const).map((s) => (
          <ul key={s} className="plain small-text">
            {side(s).map((p) => (
              <li key={p.id} className={dead.has(p.id) ? 'down' : ''}>
                <i className="dot" style={{ background: replay.teams[s].color }} />{p.name} <span className="dim">{data.fps.roles[p.role].name}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
      <ul className="plain small-text feed">
        {shown.map((e, i) => <li key={i}><span className="dim">{e.t}″</span> {text(e)}</li>)}
        {done && <li><b>{replay.teams[round.winner].name} 拿下这一回合（{REASON[round.reason]}）{round.clutch ? `，${name(round.clutch)} 一打多残局` : ''}</b></li>}
      </ul>
      <div className="row">
        <button className="small" onClick={play} disabled={playing}>▶ 重放这一回合</button>
        {playing && <button className="small" onClick={end}>⏭ 直接看结果</button>}
        <button className="small" disabled={n <= 1} onClick={() => setN(n - 1)}>‹ 上一回合</button>
        <button className="small" disabled={n >= r.rounds.length} onClick={() => setN(n + 1)}>下一回合 ›</button>
      </div>
      <h4 className="small-text">全场数据</h4>
      <table className="report-money">
        <thead><tr><th>选手</th><th className="num">杀</th><th className="num">死</th><th className="num">首杀</th><th className="num">评分</th></tr></thead>
        <tbody>
          {[...side(replay.mySide), ...side(other(replay.mySide))].map((p) => (
            <tr key={p.id} className={p.side === replay.mySide ? 'me' : ''}><td className="keep">{p.name}{p.id === r.report.mvp ? ' ⭐' : ''}</td><td className="num">{p.kills}</td><td className="num">{p.deaths}</td><td className="num">{p.openings}</td><td className="num">{p.rating.toFixed(1)}</td></tr>
          ))}
        </tbody>
      </table>
      <ul className="small-text">{r.report.keyReasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </>
  );
}

function CardReplay({ replay, data }: { replay: BranchReplay; data: GameData }) {
  const r = replay.card!;
  const games = r.series.flatMap((s) => s.games.map((g, i) => ({ s, g, i })));
  const [k, setK] = useState(games.length - 1);
  const { s, g, i } = games[Math.min(k, games.length - 1)]!;
  const { step, playing, play, end } = useStepper(g.turns.length, 650, `${replay.season}:${replay.round}:${k}`);
  const name = (id: string) => replay.names[id] ?? id;
  const who: Record<CardSide, string> = { BLUE: name(s.blue), RED: name(s.red) };
  const life = step === 0 ? startLife(g, data) : g.turns[step - 1]!.life;
  const max = data.card.life + data.card.skill.secondPlayerLife;
  const done = step >= g.turns.length;
  const seriesScore = (upTo: number): Record<CardSide, number> => {
    const sc = { BLUE: 0, RED: 0 };
    for (const x of r.series.slice(0, upTo)) sc[x.winner]++;
    return sc;
  };
  return (
    <>
      <ScoreLine replay={replay} score={seriesScore(done && i === s.games.length - 1 ? s.seat + 1 : s.seat)} />
      <div className="round-chips">
        {games.map((x, idx) => (
          <button key={idx} className={`round-chip wide ${x.g.winner === replay.mySide ? 'won' : 'lost'} ${idx === k ? 'on' : ''}`} onClick={() => setK(idx)}>{x.s.seat + 1} 台·{x.i + 1}</button>
        ))}
      </div>
      <div className="small-text">第 {s.seat + 1} 台 第 {i + 1} 局 · {g.first === 'BLUE' ? who.BLUE : who.RED} 先手</div>
      {(['BLUE', 'RED'] as const).map((side) => (
        <div key={side} className="life-row">
          <span className="keep small-text"><i className="dot" style={{ background: replay.teams[side].color }} />{who[side]} <span className="dim">{data.card.decks[s.decks[side]].name}</span></span>
          <span className="bar life"><i style={{ width: `${(life[side] / max) * 100}%`, background: replay.teams[side].color }} /></span>
          <b className="small-text">{life[side]}</b>
        </div>
      ))}
      <ul className="plain small-text feed">
        {g.turns.slice(0, step).map((t, idx) => (
          <li key={idx}>
            <span className="dim">回合 {t.turn}</span> {who[t.side]}：{t.damage > 0 ? `打出 ${t.damage} 点伤害` : '没打出伤害'}{t.healed > 0 ? `，回 ${t.healed} 血` : ''}
            {t.notes.length > 0 && <b> {t.notes.map((x) => NOTE[x]).join(' · ')}</b>}
          </li>
        ))}
        {done && <li><b>{who[g.winner]} 赢下这一局{g.byTime ? '（打满回合，血多的赢）' : ''}</b></li>}
      </ul>
      <div className="row">
        <button className="small" onClick={play} disabled={playing}>▶ 重放这一局</button>
        {playing && <button className="small" onClick={end}>⏭ 直接看结果</button>}
        <button className="small" disabled={k <= 0} onClick={() => setK(k - 1)}>‹ 上一局</button>
        <button className="small" disabled={k >= games.length - 1} onClick={() => setK(k + 1)}>下一局 ›</button>
      </div>
      <h4 className="small-text">各台结果</h4>
      <ul className="plain small-text">
        {r.series.map((x) => (
          <li key={x.seat}>第 {x.seat + 1} 台：{name(x.blue)}（{data.card.decks[x.decks.BLUE].name}）{x.games.filter((y) => y.winner === 'BLUE').length} : {x.games.filter((y) => y.winner === 'RED').length} {name(x.red)}（{data.card.decks[x.decks.RED].name}）</li>
        ))}
      </ul>
      <ul className="small-text">{r.report.keyReasons.map((x, idx) => <li key={idx}>{x}</li>)}</ul>
    </>
  );
}

function startLife(g: CardGame, data: GameData): Record<CardSide, number> {
  const base = data.card.life, extra = data.card.skill.secondPlayerLife;
  return { BLUE: base + (g.first === 'BLUE' ? 0 : extra), RED: base + (g.first === 'RED' ? 0 : extra) };
}
