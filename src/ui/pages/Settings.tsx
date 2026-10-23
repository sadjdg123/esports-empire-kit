import { useRef, useState } from 'react';
import type { GameState } from '../../game';
import { exportFileName, importSave, serialize } from '../../save';
import type { PageProps } from '../App';
import { today } from '../storage';

export function SettingsPage({ game, flash, ask, onReplace, onNewGame }: PageProps & { onReplace: (g: GameState) => void; onNewGame: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showText, setShowText] = useState(false);
  const [pasted, setPasted] = useState('');
  const saveText = () => serialize(game, { createdAt: new Date().toISOString() });

  const download = () => {
    const blob = new Blob([saveText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(game, today());
    document.body.appendChild(a); // some browsers ignore clicks on detached links
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    flash('已开始下载存档文件。没有反应的话，请用下面的“复制存档文本”');
  };

  const copy = async () => {
    setShowText(true);
    try {
      await navigator.clipboard.writeText(saveText());
      flash('存档文本已复制，可以粘贴到备忘录里保存');
    } catch {
      flash('无法自动复制，请长按下面的文本框全选复制');
    }
  };

  const load = (text: string) => {
    const r = importSave(text);
    if (!r.ok) { flash(`导入失败：${r.error}`); return; }
    const g = r.save.game as GameState;
    ask(`导入「${g.club.name}」第 ${g.week} 轮的存档，会替换当前进度（当前进度会留一份备份）。`, '导入', () => {
      onReplace(g);
      setPasted('');
      flash('存档已导入');
    });
  };

  return (
    <div className="grid">
      <section className="card">
        <h2>存档</h2>
        <p className="dim">游戏会自动存在这个浏览器里，刷新页面不会丢进度。换手机、换电脑或换浏览器前，先把存档导出来。</p>
        <div className="row">
          <button className="primary" onClick={() => void copy()}>复制存档文本</button>
          <button onClick={download}>下载存档文件</button>
          <button onClick={() => fileRef.current?.click()}>读取存档文件</button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(load); e.target.value = ''; }} />
        {showText && <textarea id="save-out" className="save-text" readOnly value={saveText()} onFocus={(e) => e.currentTarget.select()} />}
        <h3>粘贴存档文本导入</h3>
        <textarea id="save-in" className="save-text" placeholder="把之前复制的存档文本粘贴到这里" value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <button onClick={() => load(pasted)} disabled={!pasted.trim()}>导入粘贴的存档</button>
      </section>
      <section className="card">
        <h2>新游戏</h2>
        <p className="dim">重新起名、重新签人，从第 1 轮开始。</p>
        <button className="danger-btn" onClick={onNewGame}>开始新游戏</button>
      </section>
    </div>
  );
}
