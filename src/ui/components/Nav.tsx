import type { GameState } from '../../game';
import type { Page } from '../App';

const ITEMS: [Page, string][] = [
  ['home', '主页'], ['market', '市场'], ['lineup', '阵容'], ['schedule', '赛程'], ['finance', '财务'], ['report', '战报'], ['settings', '设置'],
];

export function Nav({ page, go, game }: { page: Page; go: (p: Page) => void; game: GameState }) {
  return (
    <nav className="nav">
      {ITEMS.map(([p, label]) => (
        <button key={p} className={page === p ? 'active' : ''} onClick={() => go(p)} disabled={p === 'report' && game.reports.length === 0}>
          {label}
        </button>
      ))}
      <span className="week">第 {Math.min(game.week + 1, game.totalRounds)} / {game.totalRounds} 轮{game.week >= game.totalRounds ? '（已结束）' : ''}</span>
    </nav>
  );
}
