import { useEffect, useRef } from 'react';
import type { Archetype } from '../../core/types';
import { HERO_H, HERO_W, heroPalette, heroRows, type HeroFrame } from '../../render/pixel/heroArt';
import { makeSprite } from '../../render/pixel/raster';

/** A hero's pixel sprite in a team colour, scaled up crisply. */
export function HeroSprite({ heroId, archetype, color, frame = 'stand', scale = 2 }: { heroId: string; archetype?: Archetype; color: string; frame?: HeroFrame; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, HERO_W, HERO_H);
    ctx.drawImage(makeSprite(heroRows(heroId, frame, archetype), heroPalette(heroId, color, archetype)), 0, 0);
  }, [heroId, archetype, color, frame]);
  return <canvas ref={ref} className="hero-sprite" width={HERO_W} height={HERO_H} style={{ width: HERO_W * scale, height: HERO_H * scale }} />;
}
