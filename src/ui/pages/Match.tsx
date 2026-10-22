import { useEffect, useRef } from 'react';
import { commitWeek, type WeekSummary } from '../../game';
import type { PageProps } from '../App';

/** Placeholder until T10: settles the week directly (same result as watching). */
export function MatchPage(props: PageProps & { onDone: (s: WeekSummary) => void }) {
  // Latest props for the one-shot timer below (the page re-renders while it waits).
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const id = window.setTimeout(() => {
      const { act, data, flash, go, onDone } = latest.current;
      const r = act((d) => commitWeek(d, data));
      if (!r.ok) { flash(r.error); go('home'); return; }
      onDone(r.value);
      go('report', { reportRound: r.value.round });
    }, 50);
    return () => window.clearTimeout(id);
  }, []);
  return <section className="card center"><h2>比赛进行中…</h2><p className="dim">（比赛画面在 T10 加入，现在直接出结果）</p></section>;
}
