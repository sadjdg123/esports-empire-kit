import type { Page } from '../App';
import { iconUrl } from '../icons';

export const MENU: { page: Page; label: string; icon: string }[] = [
  { page: 'overview', label: '概况', icon: 'home' },
  { page: 'inbox', label: '收件箱', icon: 'inbox' },
  { page: 'lineup', label: '阵容', icon: 'lineup' },
  { page: 'training', label: '训练', icon: 'training' },
  { page: 'market', label: '签人', icon: 'market' },
  { page: 'contracts', label: '合同转会', icon: 'contracts' },
  { page: 'schedule', label: '赛程', icon: 'schedule' },
  { page: 'finance', label: '财务', icon: 'finance' },
  { page: 'facilities', label: '设施', icon: 'facilities' },
  { page: 'report', label: '战报', icon: 'report' },
  { page: 'history', label: '历史', icon: 'history' },
  { page: 'settings', label: '设置', icon: 'settings' },
];

/** The menu: a grid of big icon buttons, like a handheld management game. */
export function MenuGrid({ open, unread, hasReports }: { open: (p: Page) => void; unread: number; hasReports: boolean }) {
  return (
    <div className="menu-grid">
      {MENU.map((m) => (
        <button key={m.page} onClick={() => open(m.page)} disabled={m.page === 'report' && !hasReports}>
          <img src={iconUrl(m.icon)} alt="" className="px-icon big" />
          <span>{m.label}</span>
          {m.page === 'inbox' && unread > 0 && <span className="badge">{unread}</span>}
        </button>
      ))}
    </div>
  );
}
