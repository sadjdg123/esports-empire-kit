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
      {list.map(([id, m]) => <span key={id} className="hero-tag">{data.heroById[id]?.name ?? id} <b>{m}</b></span>)}
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
