import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadGameData } from '../core/config';
import type { GameData } from '../core/types';
import {
  PLAYER_CLUB_ID, advanceDay, advanceToNextMatch, clubById, commitWeek, nextPlayerFixture, prepareWeek, readinessIssues, refreshStaffMarket,
  type DayResult, type GameState, type InboxMessage, type Result, type WeekSummary,
} from '../game';
import { lookFor } from '../render/pixel/chibi';
import type { Hotspot } from '../render/club/ClubScene';
import { markersFor } from '../render/club/markers';
import { loadGame, saveGame, type LoadOutcome } from '../save';
import { runMatch } from '../sim';
import { BaseView } from './components/BaseView';
import { ConfirmDialog, type ConfirmRequest } from './components/Confirm';
import { EventDialog, type DialogLine } from './components/EventDialog';
import { Hud } from './components/Hud';
import { MENU, MenuGrid } from './components/MenuGrid';
import { PlayerCard } from './components/PlayerCard';
import { ASSISTANT } from './components/Portrait';
import { GameWindow } from './components/Window';
import { iconUrl } from './icons';
import { ContractsPage } from './pages/Contracts';
import { FacilitiesPage } from './pages/Facilities';
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
import { ReportsPage } from './pages/Reports';
import { StaffPage } from './pages/Staff';
import { StartPage } from './pages/Start';
import { TrainingPage } from './pages/Training';
import { SAVE_KEY, browserStorage } from './storage';
import './styles.css';

export type Page =
  | 'start' | 'home' | 'overview' | 'inbox' | 'market' | 'lineup' | 'training' | 'contracts' | 'schedule' | 'finance' | 'history'
  | 'report' | 'settings' | 'match' | 'menu' | 'matchday' | 'seasonend' | 'facilities' | 'staff' | 'reports';

export interface PageProps {
  game: GameState;
  data: GameData;
  /** Runs a change on a copy of the game; the copy replaces the game only when the change succeeds. */
  act: <T>(fn: (draft: GameState) => Result<T>) => Result<T>;
  /** Opens a window ('home' goes back to the base, 'match' to the match screen). */
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

const HOTSPOT_PAGE: Record<Hotspot, Page> = {
  lineup: 'lineup', training: 'training', schedule: 'schedule', contracts: 'contracts', finance: 'finance',
  history: 'history', report: 'report', inbox: 'inbox', market: 'market', facilities: 'facilities', staff: 'staff',
};
const TITLES: Partial<Record<Page, [string, string]>> = {
  menu: ['菜单', 'home'], matchday: ['比赛日', 'schedule'], seasonend: ['赛季结束', 'history'],
  ...Object.fromEntries(MENU.map((m) => [m.page, [m.label, m.icon]])),
};
const TUTORIAL_KEY = 'esports-empire.tutorial.v1';

function initialLoad(): { outcome: LoadOutcome; game: GameState | null } {
  const outcome = loadGame(browserStorage, SAVE_KEY);
  const game = outcome.save ? (outcome.save.game as GameState) : null;
  // Saves from before P3 have no staff candidates yet: give them this season's batch.
  if (game && game.staffMarket.length === 0 && Object.keys(game.staff).length === 0) refreshStaffMarket(game, data);
  return { outcome, game };
}

function readTutorialSeen(): boolean {
  try { return browserStorage.read(TUTORIAL_KEY) === '1'; } catch { return false; }
}

export function App() {
  const first = useMemo(initialLoad, []);
  const [game, setGame] = useState<GameState | null>(first.game);
  const [screen, setScreen] = useState<'start' | 'base' | 'match'>(first.game ? 'base' : 'start');
  const [win, setWin] = useState<Page | null>(null);
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
  const [cheerDay, setCheerDay] = useState(-1);
  const [seasonEndSeen, setSeasonEndSeen] = useState(-1);
  const [tutorialSeen, setTutorialSeen] = useState(readTutorialSeen);
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
    if (p === 'match') { setRunning(false); setWin(null); setScreen('match'); window.scrollTo(0, 0); return; }
    if (p === 'start') { setRunning(false); setWin(null); setScreen('start'); return; }
    setScreen('base');
    setWin(p === 'home' ? null : p);
  }, []);

  /** After a match, watched or not: remember the week and cheer on a win. */
  const matchDone = useCallback((summary: WeekSummary) => {
    setLastWeek(summary);
    if (summary.playerResult?.winner === PLAYER_CLUB_ID) setCheerDay(gameRef.current!.calendar.day);
  }, []);

  /** What to do when the calendar stops on its own. */
  const handlePause = useCallback((r: DayResult) => {
    if (r.pause === 'MATCH_DAY') { setWin('matchday'); return; }
    if (r.pause === 'SEASON_END') { setWin('seasonend'); return; }
    if (r.pause === 'DECISION') { setWin('staff'); flash('有件大事要你拍板'); return; }
    const last = r.messages[r.messages.length - 1];
    if (last) flash(last.title);
  }, [flash]);

  // The calendar clock: one day per tick, paused while a window is open (like a handheld management game).
  useEffect(() => {
    if (!running || !game || screen !== 'base' || win || confirmReq) return;
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
  }, [running, speed, screen, win, confirmReq, game === null, act, handlePause]);

  const toNextMatch = useCallback(() => {
    setRunning(false);
    let res: DayResult | null = null;
    act((d) => { res = advanceToNextMatch(d, data); return { ok: true, value: undefined }; });
    const r = res as DayResult | null;
    if (r?.pause === 'MATCH_DAY') handlePause(r);
    else { setWin('seasonend'); flash('本赛季你已经没有比赛了'); }
  }, [act, flash, handlePause]);

  // The end of a season opens its summary once.
  useEffect(() => {
    if (game && screen === 'base' && !win && game.calendar.phase === 'FINISHED' && seasonEndSeen !== game.calendar.season) {
      setSeasonEndSeen(game.calendar.season);
      setWin('seasonend');
    }
  }, [game, screen, win, seasonEndSeen]);

  if (!game || screen === 'start') {
    return (
      <div className="app">
        {notice && <div className="notice">{notice}<button className="link" onClick={() => setNotice(null)}>知道了</button></div>}
        <StartPage
          data={data}
          hasGame={!!game}
          ask={ask}
          onStart={(g) => { setGame(g); gameRef.current = g; setLastWeek(null); setRunning(false); setScreen('base'); setWin('market'); flash('俱乐部成立！先在告示牌（签人）签下至少 5 名选手。'); }}
          onCancel={game ? () => setScreen('base') : undefined}
        />
        {toast && <div className="toast">{toast}</div>}
        {dialog}
      </div>
    );
  }

  const props: PageProps = { game, data, act, go, flash, ask, showPlayer: setPlayerId, toNextMatch };
  const unread = game.inbox.filter((m) => !m.read).length;

  if (screen === 'match') {
    return (
      <div className="app match-screen">
        <main className="page">
          <MatchPage {...props} onDone={matchDone} />
        </main>
        {toast && <div className="toast">{toast}</div>}
        {dialog}
      </div>
    );
  }

  const line = !win ? dialogLine(game, act, go, tutorialSeen, () => {
    setTutorialSeen(true);
    try { browserStorage.write(TUTORIAL_KEY, '1'); } catch { /* per-viewer hint only */ }
  }) : null;
  const [title, icon] = win ? (TITLES[win] ?? ['', 'home']) : ['', ''];

  return (
    <div className="app base-screen">
      <Hud game={game} data={data} running={running} speed={speed} setRunning={setRunning} setSpeed={setSpeed} toNextMatch={toNextMatch} openPending={() => go('staff')} />
      {notice && <div className="notice">{notice}<button className="link" onClick={() => setNotice(null)}>知道了</button></div>}
      <BaseView
        game={game} data={data} markers={markersFor(game, data)} cheer={game.calendar.day === cheerDay}
        onPlayer={setPlayerId} onHotspot={(h) => go(HOTSPOT_PAGE[h])}
      />
      {line && <EventDialog line={line} />}
      <button className="menu-btn" onClick={() => setWin('menu')} aria-label="菜单">
        <img src={iconUrl('home')} alt="" className="px-icon" />菜单{unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {win && (
        <GameWindow title={title} icon={icon} onClose={() => setWin(null)}>
          {win === 'menu' && <MenuGrid open={(p) => go(p)} unread={unread} hasReports={game.reports.length > 0} />}
          {(win === 'overview' || win === 'seasonend') && <HomePage {...props} lastWeek={lastWeek} />}
          {win === 'matchday' && <MatchDay {...props} onDone={matchDone} />}
          {win === 'inbox' && <InboxPage {...props} />}
          {win === 'market' && <MarketPage {...props} />}
          {win === 'lineup' && <LineupPage {...props} />}
          {win === 'training' && <TrainingPage {...props} />}
          {win === 'contracts' && <ContractsPage {...props} />}
          {win === 'schedule' && <SchedulePage {...props} />}
          {win === 'finance' && <FinancePage {...props} />}
          {win === 'facilities' && <FacilitiesPage {...props} />}
          {win === 'staff' && <StaffPage {...props} />}
          {win === 'reports' && <ReportsPage {...props} />}
          {win === 'history' && <HistoryPage {...props} />}
          {win === 'report' && <ReportPage {...props} round={reportRound} lastWeek={lastWeek} />}
          {win === 'settings' && <SettingsPage {...props} onReplace={(g) => { setGame(g); gameRef.current = g; setLastWeek(null); setRunning(false); setWin(null); }} onNewGame={() => go('start')} />}
        </GameWindow>
      )}
      {playerId && game.players[playerId] && <PlayerCard {...props} playerId={playerId} close={() => setPlayerId(null)} />}
      {toast && <div className="toast">{toast}</div>}
      {dialog}
    </div>
  );
}

/** The match-day pop-up: who we play, and whether the team is ready. */
function MatchDay({ game, data, go, act, flash, onDone }: PageProps & { onDone: (s: WeekSummary) => void }) {
  const next = nextPlayerFixture(game, data);
  const issues = readinessIssues(game, data);
  if (!next || next.day !== game.calendar.day) return <p>今天没有你的比赛。</p>;
  const opp = clubById(game, next.opponent);
  const stage = next.kind === 'SEMI' ? '季后赛半决赛' : next.kind === 'FINAL' ? '总决赛' : `常规赛第 ${game.week + 1} 轮`;
  // Same match as watching it (watching, skipping and runMatch give the same result), without the match screen.
  const quick = () => {
    const prep = prepareWeek(game, data);
    if (!prep.playerMatch) { flash(prep.issues.join('；') || '今天不能比赛'); return; }
    const result = runMatch(prep.playerMatch, data);
    const r = act((d) => commitWeek(d, data, result));
    if (!r.ok) { flash(r.error); return; }
    onDone(r.value);
    go('report', { reportRound: r.value.round });
  };
  return (
    <div className="matchday">
      <p className="big-text">{stage}：对阵 <span className="swatch" style={{ background: opp.color }} /> <b>{opp.name}</b></p>
      {issues.length > 0 ? (
        <>
          <p className="bad">还不能开赛：{issues.join('；')}</p>
          <button className="primary" onClick={() => go(game.club.roster.length < data.economy.minRoster ? 'market' : 'lineup')}>{game.club.roster.length < data.economy.minRoster ? '去签人' : '去排阵容'}</button>
        </>
      ) : (
        <>
          <p>首发和战术已就绪：<b>{data.match.tactics[game.lineup!.tactic].name}</b>。</p>
          <div className="row">
            <button className="primary big" onClick={() => go('match')}>开始比赛 ▶</button>
            <button onClick={quick}>直接看结果 ⏭</button>
            <button onClick={() => go('lineup')}>调整阵容</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Who says what at the bottom of the base: a tutorial first, then unread news (match results stay in the inbox). */
function dialogLine(g: GameState, act: PageProps['act'], go: PageProps['go'], tutorialSeen: boolean, seeTutorial: () => void): DialogLine | null {
  if (!tutorialSeen) {
    return {
      key: 'tutorial', speaker: '助理 小禾', look: ASSISTANT,
      text: '老板好！基地里的东西都能点：白板排阵容，电脑定训练，门口信箱看消息，告示牌签选手，楼上办公桌谈合同，电视看赛程，奖杯柜看历史。右下角是菜单。',
      dismiss: seeTutorial,
    };
  }
  // A staff weekly summary only speaks up when something waits for the player.
  const m = g.inbox.find((x) => !x.read && x.kind !== 'MATCH' && !(x.kind === 'STAFF' && !x.data?.pending));
  if (!m) return null;
  const markRead = () => act((d) => { const x = d.inbox.find((y) => y.id === m.id); if (x) x.read = true; return { ok: true, value: undefined }; });
  const speakerFor = (msg: InboxMessage) => {
    const pid = msg.kind === 'OFFER' && msg.data?.offerId !== undefined ? g.offers.find((o) => o.id === msg.data!.offerId)?.playerId
      : msg.kind === 'CONTRACT' && typeof msg.data?.players === 'string' ? String(msg.data.players).split(',')[0] : undefined;
    const p = pid ? g.players[pid] : undefined;
    return p ? { speaker: p.name, look: lookFor(p.id, g.club.color) } : { speaker: '助理 小禾', look: ASSISTANT };
  };
  const target: Page | null = m.kind === 'OFFER' || m.kind === 'CONTRACT' ? 'contracts' : m.kind === 'FINANCE' ? 'finance' : m.kind === 'SEASON' ? 'schedule' : m.kind === 'STAFF' ? 'staff' : null;
  return {
    key: `msg-${m.id}`, ...speakerFor(m), text: `${m.title}：${m.body}`,
    action: target ? { label: '去看看', run: () => { markRead(); go(target); } } : undefined,
    dismiss: markRead,
  };
}
