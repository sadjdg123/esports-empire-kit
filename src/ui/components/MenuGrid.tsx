import type { Hotspot, Marker } from '../../render/club/markers';
import type { Page } from '../App';
import { iconUrl } from '../icons';

export const MENU: { page: Page; label: string; icon: string; hotspot?: Hotspot }[] = [
  { page: 'overview', label: '概况', icon: 'home' },
  { page: 'inbox', label: '收件箱', icon: 'inbox', hotspot: 'inbox' },
  { page: 'lineup', label: '阵容', icon: 'lineup', hotspot: 'lineup' },
  { page: 'training', label: '训练', icon: 'training', hotspot: 'training' },
  { page: 'market', label: '签人', icon: 'market', hotspot: 'market' },
  { page: 'contracts', label: '合同转会', icon: 'contracts', hotspot: 'contracts' },
  { page: 'schedule', label: '赛程', icon: 'schedule', hotspot: 'schedule' },
  { page: 'finance', label: '财务', icon: 'finance', hotspot: 'finance' },
  { page: 'facilities', label: '设施', icon: 'facilities', hotspot: 'facilities' },
  { page: 'group', label: '集团', icon: 'group', hotspot: 'group' },
  { page: 'goals', label: '目标', icon: 'goals' },
  { page: 'staff', label: '负责人', icon: 'staff', hotspot: 'staff' },
  { page: 'reports', label: '报表', icon: 'reports' },
  { page: 'report', label: '战报', icon: 'report', hotspot: 'report' },
  { page: 'history', label: '历史', icon: 'history', hotspot: 'history' },
  { page: 'settings', label: '设置', icon: 'settings' },
];

/** The menu: a grid of big Kairosoft-style icon tiles with status badges. */
export function MenuGrid({ open, unread, hasReports, markers }: {
  open: (p: Page) => void; unread: number; hasReports: boolean;
  markers?: Partial<Record<Hotspot, Marker>>;
}) {
  return (
    <div className="menu-grid">
      {MENU.map((m) => {
        const mk = m.hotspot ? markers?.[m.hotspot] : undefined;
        return (
          <button key={m.page} onClick={() => open(m.page)} disabled={m.page === 'report' && !hasReports}>
            <span className="menu-icon-plate">
              <img src={iconUrl(m.icon)} alt="" className="px-icon big" />
            </span>
            <span>{m.label}</span>
            {m.page === 'inbox' && unread > 0 && <span className="badge">{unread}</span>}
            {m.page !== 'inbox' && mk === 'bang' && <span className="badge">!</span>}
          </button>
        );
      })}
    </div>
  );
}
