import { useRef } from 'react';
import type { GameState } from '../../game';
import { exportFileName, importSave, serialize } from '../../save';
import type { PageProps } from '../App';
import { today } from '../storage';

export function SettingsPage({ game, flash, onReplace, onNewGame }: PageProps & { onReplace: (g: GameState) => void; onNewGame: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const exportSave = () => {
    const text = serialize(game, { createdAt: new Date().toISOString() });
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(game, today());
    document.body.appendChild(a); // some browsers ignore clicks on detached links
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    flash('存档文件已下载');
  };

  const importFile = async (file: File) => {
    const r = importSave(await file.text());
    if (!r.ok) { flash(`导入失败：${r.error}`); return; }
    const g = r.save.game as GameState;
    if (!window.confirm(`导入「${g.club.name}」第 ${g.week} 轮的存档，会替换当前进度（当前进度会留一份备份）。确定吗？`)) return;
    onReplace(g);
    flash('存档已导入');
  };

  return (
    <div className="grid">
      <section className="card">
        <h2>存档</h2>
        <p className="dim">游戏会自动存在这个浏览器里，刷新页面不会丢进度。换电脑或换浏览器前，先导出存档文件。</p>
        <button className="primary" onClick={exportSave}>导出存档文件</button>
        <button onClick={() => fileRef.current?.click()}>导入存档文件</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </section>
      <section className="card">
        <h2>新游戏</h2>
        <p className="dim">重新起名、重新签人，从第 1 轮开始。</p>
        <button className="danger-btn" onClick={onNewGame}>开始新游戏</button>
      </section>
    </div>
  );
}
