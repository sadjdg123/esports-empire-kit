import { useEffect, useMemo, useRef, useState } from 'react';
import type { RenderSnapshot } from '../../core/types';
import { PLAYER_CLUB_ID, clubById, commitWeek, prepareWeek, type WeekSummary } from '../../game';
import { MatchPlayer, type Speed } from '../../render/player';
import { describeEvent, nameBook } from '../../sim/events';
import type { PageProps } from '../App';
import { minutes, money } from '../labels';

const FEED_TYPES = new Set(['KILL', 'TOWER_DESTROYED', 'OBJECTIVE_TAKEN', 'TEAMFIGHT_START', 'TEAMFIGHT_END', 'GANK', 'SPLIT_PUSH', 'BASE_DAMAGED', 'BASE_DESTROYED', 'OVERTIME']);

function distinct(a: string, b: string): string {
  // Keep both teams readable when the clubs picked similar colours.
  const n = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = n(a);
  const [r2, g2, b2] = n(b);
  return Math.abs(r1! - r2!) + Math.abs(g1! - g2!) + Math.abs(b1! - b2!) < 120 ? (a.toLowerCase() === '#e84a7f' ? '#3ccf8e' : '#e84a7f') : b;
}

export function MatchPage({ game, data, act, go, flash, onDone }: PageProps & { onDone: (s: WeekSummary) => void }) {
  // Fixed for the lifetime of this page: the match must not change while it is being watched.
  const [prep] = useState(() => prepareWeek(game, data));
  const player = useMemo(() => (prep.playerMatch ? new MatchPlayer(prep.playerMatch, data) : null), [prep, data]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<RenderSnapshot | null>(player?.cur ?? null);
  const [feed, setFeed] = useState<string[]>([]);
  const [speed, setSpeed] = useState<Speed>(1);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const [finished, setFinished] = useState(false);
  const committed = useRef(false);

  const fixture = prep.fixture!;
  const blueClub = clubById(game, fixture?.blue ?? PLAYER_CLUB_ID);
  const redClub = clubById(game, fixture?.red ?? PLAYER_CLUB_ID);
  const colors = useMemo(() => ({ BLUE: blueClub.color, RED: distinct(blueClub.color, redClub.color) }), [blueClub.color, redClub.color]);
  const book = useMemo(() => (prep.playerMatch ? nameBook(prep.playerMatch, data.heroes) : null), [prep, data]);

  useEffect(() => {
    if (!player || !hostRef.current || !prep.playerMatch) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    const names: Record<string, string> = {};
    for (const t of [prep.playerMatch.blue, prep.playerMatch.red]) for (const p of t.players) names[p.id] = p.name;
    void import('../../render/MatchScene').then(({ mountMatch }) => {
      if (cancelled || !hostRef.current) return;
      cleanup = mountMatch(hostRef.current, {
        player, data, colors, names, onFps: setFps,
        onTick: (snaps) => {
          const last = snaps[snaps.length - 1]!;
          setSnap(last);
          const lines = snaps.flatMap((s) => s.newEvents.filter((e) => FEED_TYPES.has(e.type)).map((e) => describeEvent(e, book!, { BLUE: blueClub.name, RED: redClub.name })));
          if (lines.length) setFeed((f) => [...lines.reverse(), ...f].slice(0, 40));
          if (player.over) setFinished(true);
        },
      });
    });
    return () => { cancelled = true; cleanup?.(); };
  }, [player, prep, data, colors, book, blueClub.name, redClub.name]);

  if (!player || !prep.playerMatch) {
    return (
      <section className="card">
        <h2>还不能比赛</h2>
        <ul>{prep.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        <button className="primary" onClick={() => go('home')}>返回主页</button>
      </section>
    );
  }

  const setSpd = (s: Speed) => { player.speed = s; setSpeed(s); };
  const togglePause = () => { player.paused = !player.paused; setPaused(player.paused); };
  const skip = () => {
    player.skip();
    setSnap(player.cur);
    setFinished(true);
  };
  const settle = () => {
    if (committed.current) return;
    committed.current = true;
    const result = player.finish();
    const r = act((d) => commitWeek(d, data, result));
    if (!r.ok) { flash(r.error); go('home'); return; }
    onDone(r.value);
    go('report', { reportRound: r.value.round });
  };

  const s = snap ?? player.cur;
  const goldDiff = s.gold.BLUE - s.gold.RED;
  const winnerClub = s.winner ? (s.winner === 'BLUE' ? blueClub : redClub) : null;
  const won = winnerClub?.id === PLAYER_CLUB_ID;

  return (
    <div className="match-page">
      <div className="scoreboard">
        <div className="team blue"><span className="swatch" style={{ background: colors.BLUE }} /> {blueClub.name}</div>
        <div className="score"><b>{s.kills.BLUE}</b> : <b>{s.kills.RED}</b></div>
        <div className="team red">{redClub.name} <span className="swatch" style={{ background: colors.RED }} /></div>
        <div className="meta">
          <span>⏱ {minutes(s.t)}</span>
          <span>经济差 {goldDiff >= 0 ? `蓝 +${goldDiff}` : `红 +${-goldDiff}`}</span>
          <span>剩余塔 {s.towersStanding.BLUE} : {s.towersStanding.RED}</span>
        </div>
      </div>
      <div className="match-body">
        <div className="canvas-host" ref={hostRef} />
        <aside className="feed card">
          <h3>比赛事件</h3>
          <ol>{feed.map((line, i) => <li key={feed.length - i}>{line}</li>)}</ol>
        </aside>
      </div>
      <div className="controls">
        {!finished ? (
          <>
            <button onClick={togglePause}>{paused ? '▶ 继续' : '⏸ 暂停'}</button>
            {([1, 2, 4] as Speed[]).map((v) => <button key={v} className={speed === v ? 'primary' : ''} onClick={() => setSpd(v)}>{v}×</button>)}
            <button onClick={skip}>⏭ 跳过</button>
            <span className="dim">画面 {fps} 帧/秒</span>
          </>
        ) : (
          <div className={`result ${won ? 'won' : 'lost'}`}>
            <b>{won ? '胜利！' : '失利'}</b> {winnerClub?.name} 在 {minutes(s.t)} 获胜 · 奖金 {money(won ? data.economy.prizeWin : data.economy.prizeLoss)}
            <button className="primary big" onClick={settle}>查看战报 ▶</button>
          </div>
        )}
      </div>
    </div>
  );
}
