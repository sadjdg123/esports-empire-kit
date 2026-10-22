import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadGameData } from '../core/config';
import type { GameData } from '../core/types';
import type { GameState, Result, WeekSummary } from '../game';
import { loadGame, saveGame, type LoadOutcome } from '../save';
import { FundsBar } from './components/FundsBar';
import { Nav } from './components/Nav';
import { FinancePage } from './pages/Finance';
import { HomePage } from './pages/Home';
import { LineupPage } from './pages/Lineup';
import { MarketPage } from './pages/Market';
import { MatchPage } from './pages/Match';
import { ReportPage } from './pages/Report';
import { SchedulePage } from './pages/Schedule';
import { SettingsPage } from './pages/Settings';
import { StartPage } from './pages/Start';
import { SAVE_KEY, browserStorage } from './storage';
import './styles.css';

export type Page = 'start' | 'home' | 'market' | 'lineup' | 'schedule' | 'finance' | 'report' | 'settings' | 'match';

export interface PageProps {
  game: GameState;
  data: GameData;
  /** Runs a change on a copy of the game; the copy replaces the game only when the change succeeds. */
  act: <T>(fn: (draft: GameState) => Result<T>) => Result<T>;
  go: (page: Page, opts?: { reportRound?: number }) => void;
  flash: (text: string) => void;
}

const data = loadGameData();

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
  const toastTimer = useRef<number | undefined>(undefined);
  const loadFailed = useRef(first.outcome.status === 'failed');

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
    if (!game) return { ok: false, error: '还没有开始游戏' };
    const draft = structuredClone(game);
    const r = fn(draft);
    if (r.ok) setGame(draft);
    return r;
  }, [game]);

  const go = useCallback((p: Page, opts?: { reportRound?: number }) => {
    if (opts?.reportRound !== undefined) setReportRound(opts.reportRound);
    else if (p === 'report') setReportRound(null);
    setPage(p);
    window.scrollTo(0, 0);
  }, []);

  if (!game || page === 'start') {
    return (
      <div className="app">
        {notice && <div className="notice">{notice}<button className="link" onClick={() => setNotice(null)}>知道了</button></div>}
        <StartPage
          data={data}
          hasGame={!!game}
          onStart={(g) => { setGame(g); setLastWeek(null); go('market'); flash('俱乐部成立！先去自由市场签下至少 5 名选手。'); }}
          onCancel={game ? () => go('home') : undefined}
        />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const props: PageProps = { game, data, act, go, flash };
  return (
    <div className="app">
      <FundsBar game={game} data={data} />
      <Nav page={page} go={go} game={game} />
      {notice && <div className="notice">{notice}<button className="link" onClick={() => setNotice(null)}>知道了</button></div>}
      <main className="page">
        {page === 'home' && <HomePage {...props} lastWeek={lastWeek} />}
        {page === 'market' && <MarketPage {...props} />}
        {page === 'lineup' && <LineupPage {...props} />}
        {page === 'schedule' && <SchedulePage {...props} />}
        {page === 'finance' && <FinancePage {...props} />}
        {page === 'report' && <ReportPage {...props} round={reportRound} lastWeek={lastWeek} />}
        {page === 'settings' && <SettingsPage {...props} onReplace={(g) => { setGame(g); setLastWeek(null); go('home'); }} onNewGame={() => go('start')} />}
        {page === 'match' && <MatchPage {...props} onDone={(summary) => { setLastWeek(summary); }} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
