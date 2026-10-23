import type { GameState } from '../../game';
import type { Page } from '../App';

const ITEMS: [Page, string][] = [
  ['home', '主页'], ['inbox', '收件箱'], ['lineup', '阵容'], ['training', '训练'], ['market', '市场'], ['contracts', '合同转会'],
  ['schedule', '赛程'], ['finance', '财务'], ['report', '战报'], ['history', '历史'], ['settings', '设置'],
];

export function Nav({ page, go, game }: { page: Page; go: (p: Page) => void; game: GameState }) {
  const unread = game.inbox.filter((m) => !m.read).length;
  return (
    <nav className="nav">
      {ITEMS.map(([p, label]) => (
        <button key={p} className={page === p ? 'active' : ''} onClick={() => go(p)} disabled={p === 'report' && game.reports.length === 0}>
          {label}{p === 'inbox' && unread > 0 && <span className="badge">{unread}</span>}
        </button>
      ))}
    </nav>
  );
}
