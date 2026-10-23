import type { ReactNode } from 'react';
import { iconUrl } from '../icons';

/** A framed pop-up window over the club base. */
export function GameWindow({ title, icon, onClose, children }: { title: string; icon?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="win-back" onClick={onClose}>
      <div className="win" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="win-title">
          {icon && <img src={iconUrl(icon)} alt="" className="px-icon" />}
          <span>{title}</span>
          <button className="win-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="win-body">{children}</div>
      </div>
    </div>
  );
}
