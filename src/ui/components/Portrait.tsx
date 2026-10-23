import { useEffect, useRef } from 'react';
import { chibi, type ChibiLook } from '../../render/pixel/chibi';

/** A chibi head-and-shoulders portrait for dialogs. */
export function Portrait({ look, size = 48 }: { look: ChibiLook; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = chibi(look, 'stand');
    c.width = 14;
    c.height = 14;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 14, 14);
    ctx.drawImage(img, 0, 0, 12, 14, 1, 1, 12, 14);
  }, [look]);
  return <canvas ref={ref} className="portrait" style={{ width: size, height: size }} />;
}

export const ASSISTANT: ChibiLook = { hair: 'bun', hairColor: '#7a4a26', skin: '#f6d3b3', shirt: '#e07a5f', accent: '#ffffff', trousers: '#3a3a3a' };
