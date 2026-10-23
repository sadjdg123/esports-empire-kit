import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadGameData } from '../core/config';
import type { GameData } from '../core/types';
import { advanceDay, advanceToNextMatch, readinessIssues, type DayResult, type GameState, type Result, type WeekSummary } from '../game';
import { loadGame, saveGame, type LoadOutcome } from '../save';
import { CalendarBar } from './components/CalendarBar';
import { ConfirmDialog, type ConfirmRequest } from './components/Confirm';
import { FundsBar } from './components/FundsBar';
import { Nav } from './components/Nav';
import { PlayerCard } from './components/PlayerCard';
import { ContractsPage } from './pages/Contracts';
import { FinancePage } from './pages/Finance';
import { HistoryPage } from './pages/History';
import { HomePage } from './pages/Home';
import { InboxPage } from './pages/Inbox';
import { LineupPage } from './pages/Lineup';
import { MarketPage } from './pages/Market';
import { MatchPage } from './pages/Match';
import { ReportPage } from './pages/Report';
import { SchedulePage } from './pages/Schedule';
import { SettingsPage } from './pages/Settings';
import { StartPage } from './pages/Start';
import { TrainingPage } from './pages/Training';
import { SAVE_KEY, browserStorage } from './storage';
import './styles.css';

export type Page =
  | 'start' | 'home' | 'inbox' | 'market' | 'lineup' | 'training' | 'contracts' | 'schedule' | 'finance' | 'history' | 'report' | 'settings' | 'match';

export interface PageProps {
  game: GameState;
  data: GameData;
  /** Runs a change on a copy of the game; the copy replaces the game only when the change succeeds. */
  act: <T>(fn: (draft: GameState) => Result<T>) => Result<T>;
  go: (page: Page, opts?: { reportRound?: number }) => void;
  flash: (text: string) => void;
  /** Ask the player to confirm before `onYes` runs. */
  ask: (text: string, yes: string, onYes: () => void) => void;
  /** Opens the player card. */
  showPlayer: (id: string) => void;
  /** Skips the calendar to the player's next match (or the end of the season). */
  toNextMatch: () => void;
}

const data = loadGameData();
export type ClockSpeed = 1 | 2 | 4;

function initialLoad(): { outcome: LoadOutcome; game: GameState | null } {
  const outcome = loadGame(browserStorage, SAVE_KEY);
  return { outcome, game: outcome.save ? (outcome.save.game as GameState) : null };
}

export function App() {
  const first = useMemo(initialLoad, []);
  const [game, setGame] = useState<GameState | null>(first.game);
  const [page, setPage] = useState<Page>(first.game ? 'home' : 'start');
  const [reportRound, setReportRound] = useState<number | null>(null);
  const [lastWeek, setLastWeek] = useState<WeekSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(
    first.outcome.status === 'loaded-backup' ? `主存档无法读取（${first.outcome.error}），已自动读取上一份备份。`
      : first.outcome.status === 'failed' ? `存档无法读取：${first.outcome.error}。原存档没有被删除；你可以在“设置”里导入备份文件，或开始新游戏。` : null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<ClockSpeed>(1);
  const ask = useCallback((text: string, yes: string, onYes: () => void) => setConfirmReq({ text, yes, onYes }), []);
  const dialog = confirmReq && <ConfirmDialog req={confirmReq} close={() => setConfirmReq(null)} />;
  const toastTimer = useRef<number | undefined>(undefined);
  const loadFailed = useRef(first.outcome.status === 'failed');
  const gameRef = useRef(game);
  gameRef.current = game;

  const flash = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // Autosave on every change.
  useEffect(() => {
    if (!game) return;
    if (loadFailed.current) {
      // Keep the unreadable save (e.g. from a newer version) instead of overwriting it.
      const raw = browserStorage.read(SAVE_KEY);
      if (raw) {
        try { browserStorage.write(`${SAVE_KEY}.unreadable`, raw); } catch { /* ignore */ }
      }
      loadFailed.current = false;
    }
    try {
      const r = saveGame(browserStorage, SAVE_KEY, game, { createdAt: new Date().toISOString() });
      if (!r.ok) setNotice(`自动存档失败：${r.error}`);
    } catch (e) {
      setNotice(`自动存档失败（浏览器可能禁止了本地存储）：${String(e)}`);
    }
  }, [game]);

  const act = useCallback(<T,>(fn: (draft: GameState) => Result<T>): Result<T> => {
    const current = gameRef.current;
    if (!current) return { ok: false, error: '还没有开始游戏' };
    const draft = structuredClone(current);
    const r = fn(draft);
    if (r.ok) {
      gameRef.current = draft;
      setGame(draft);
    }
    return r;
  }, []);

  const go = useCallback((p: Page, opts?: { reportRound?: number }) => {
    if (opts?.reportRound !== undefined) setReportRound(opts.reportRound);
    else if (p === 'report') setReportRound(null);
    if (p === 'match') setRunning(false);
    setPage(p);
    window.scrollTo(0, 0);
  }, []);

  /** What to do when the calendar stops on its own. */
  const handlePause = useCallback((r: DayResult) => {
    const g = gameRef.current!;
    if (r.pause === 'MATCH_DAY') {
      const issues = readinessIssues(g, data);
      if (issues.length === 0) go('match');
      else { go('home'); flash(`今天有比赛，但${issues[0]}`); }
      return;
    }
    const last = r.messages[r.messages.length - 1];
    if (r.pause === 'SEASON_END') { go('home'); flash('赛季结束了'); return; }
    if (last) flash(`${last.title}（详情见收件箱）`);
  }, [go, flash]);

  // The calendar clock: one day per tick; stops at the events listed in season.json (autoPause).
  useEffect(() => {
    if (!running || !game || page === 'match' || page === 'start' || confirmReq) return;
    const ms = (data.season.secondsPerDayAt1x * 1000) / speed;
    const id = window.setInterval(() => {
      let res: DayResult | null = null;
      act((d) => { res = advanceDay(d, data); return { ok: true, value: undefined }; });
      const r = res as DayResult | null;
      if (r?.pause && data.season.autoPause.includes(r.pause)) {
        setRunning(false);
        handlePause(r);
      }
    }, ms);
    return () => window.clearInterval(id);
  }, [running, speed, page, confirmReq, game === null, act, handlePause]);

  const toNextMatch = useCallback(() => {
    setRunning(false);
    let res: DayResult | null = null;
    act((d) => { res = advanceToNextMatch(d, data); return { ok: true, value: undefined }; });
    const r = res as DayResult | null;
    if (r?.pause === 'MATCH_DAY') handlePause(r);
    else { go('home'); flash('本赛季你已经没有比赛了'); }
  }, [act, go, flash, handlePause]);

  if (!game || page === 'start') {
    return (
      <div className="app">
        {notice && <div className="notice">{notice}<button className="link" onClick={() => setNotice(null)}>知道了</button></div>}
        <StartPage
          data={data}
          hasGame={!!game}
          ask={ask}
          onStart={(g) => { setGame(g); gameRef.current = g; setLastWeek(null); setRunning(false); go('market'); flash('俱乐部成立！先去自由市场签下至少 5 名选手。'); }}
          onCancel={game ? () => go('home') : undefined}
        />
        {toast && <div className="toast">{toast}</div>}
        {dialog}
      </div>
    );
  }

  const props: PageProps = { game, data, act, go, flash, ask, showPlayer: setPlayerId, toNextMatch };
  return (
    <div className="app">
      <div className="top">
        <FundsBar game={game} data={data} />
        {page !== 'match' && <CalendarBar game={game} data={data} running={running} speed={speed} setRunning={setRunning} setSpeed={setSpeed} toNextMatch={toNextMatch} />}
      </div>
      <Nav page={page} go={go} game={game} />
      {notice && <div className="notice">{notice}<button className="link" onClick={() => setNotice(null)}>知道了</button></div>}
      <main className="page">
        {page === 'home' && <HomePage {...props} lastWeek={lastWeek} />}
        {page === 'inbox' && <InboxPage {...props} />}
        {page === 'market' && <MarketPage {...props} />}
        {page === 'lineup' && <LineupPage {...props} />}
        {page === 'training' && <TrainingPage {...props} />}
        {page === 'contracts' && <ContractsPage {...props} />}
        {page === 'schedule' && <SchedulePage {...props} />}
        {page === 'finance' && <FinancePage {...props} />}
        {page === 'history' && <HistoryPage {...props} />}
        {page === 'report' && <ReportPage {...props} round={reportRound} lastWeek={lastWeek} />}
        {page === 'settings' && <SettingsPage {...props} onReplace={(g) => { setGame(g); gameRef.current = g; setLastWeek(null); setRunning(false); go('home'); }} onNewGame={() => { setRunning(false); go('start'); }} />}
        {page === 'match' && <MatchPage {...props} onDone={(summary) => { setLastWeek(summary); }} />}
      </main>
      {playerId && game.players[playerId] && <PlayerCard {...props} playerId={playerId} close={() => setPlayerId(null)} />}
      {toast && <div className="toast">{toast}</div>}
      {dialog}
    </div>
  );
}
