import type { GameData, Player } from '../../core/types';
import { playerOverall } from '../../game';
import { ROLE_NAME } from '../labels';

export function Ovr({ p }: { p: Player }) {
  const v = Math.round(playerOverall(p));
  const tier = v >= 72 ? 's' : v >= 62 ? 'a' : v >= 52 ? 'b' : 'c';
  return <span className={`ovr ovr-${tier}`}>{v}</span>;
}

export function Roles({ p }: { p: Player }) {
  return <span>{ROLE_NAME[p.primaryRole]}{p.secondaryRole ? <span className="dim"> / {ROLE_NAME[p.secondaryRole]}</span> : null}</span>;
}

export function Heroes({ p, data }: { p: Player; data: GameData }) {
  const list = Object.entries(p.heroMastery).sort((a, b) => b[1] - a[1]);
  return (
    <span className="heroes">
      {list.map(([id, m]) => <span key={id} className="hero-tag">{data.heroById[id]?.name ?? id} <b>{Math.round(m)}</b></span>)}
    </span>
  );
}

export function Attrs({ p }: { p: Player }) {
  const a = p.attrs;
  return <span className="attrs" title="操作 / 意识 / 配合 / 心态">{Math.round(a.mechanics)} / {Math.round(a.awareness)} / {Math.round(a.teamwork)} / {Math.round(a.mental)}</span>;
}

export function Form({ p }: { p: Player }) {
  if (p.form === 0) return <span className="dim">状态平稳</span>;
  return <span className={p.form > 0 ? 'good' : 'bad'}>状态 {p.form > 0 ? '+' : ''}{p.form}</span>;
}

export function Fatigue({ p }: { p: Player }) {
  const f = Math.round(p.fatigue ?? 0);
  const cls = f >= 70 ? 'bad' : f >= 50 ? 'warn-text' : 'good';
  return (
    <span className="meter" title="疲劳：超过 50 后比赛发挥下降">
      <span className="meter-bar"><span className={`meter-fill ${cls}`} style={{ width: `${f}%` }} /></span>
      <span className={cls}>{f}</span>
    </span>
  );
}

export function Morale({ p }: { p: Player }) {
  const m = Math.round(p.morale ?? 60);
  return <span className={m >= 70 ? 'good' : m < 45 ? 'bad' : ''} title="士气：影响状态">{m >= 70 ? '😊' : m < 45 ? '😟' : '😐'} {m}</span>;
}

/** A player's name that opens the player card. */
export function PlayerName({ p, show }: { p: Player; show: (id: string) => void }) {
  return <button className="link name" onClick={() => show(p.id)}>{p.name}</button>;
}

/** A player's personality as small tags (T24); `full` adds the one-line description of each. */
export function Traits({ p, data, full = false }: { p: Player; data: GameData; full?: boolean }) {
  const list = (p.traits ?? []).map((id) => data.traits.traits.find((t) => t.id === id)).filter((t) => t !== undefined);
  if (list.length === 0) return full ? <span className="dim">没有特别的性格</span> : null;
  if (full) return <span className="traits full">{list.map((t) => <span key={t.id} className="trait-line"><b className={`trait ${t.tone}`}>{t.name}</b> {t.description}</span>)}</span>;
  return <span className="traits">{list.map((t) => <b key={t.id} className={`trait ${t.tone}`} title={t.description}>{t.name}</b>)}</span>;
}
