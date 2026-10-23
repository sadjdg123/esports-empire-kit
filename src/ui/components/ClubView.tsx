import { useEffect, useMemo, useRef } from 'react';
import type { GameData } from '../../core/types';
import type { GameState } from '../../game';
import { activitySummary, clubActivities } from '../../render/club/activities';
import { ClubScene, SCENE_H, SCENE_W } from '../../render/club/ClubScene';

/** The club base on the home page. Tap a figure to open the player card. */
export function ClubView({ game, data, showPlayer }: { game: GameState; data: GameData; showPlayer: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ClubScene | null>(null);
  const activities = useMemo(() => clubActivities(game, data), [game, data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frames = 0;
    let total = 0;
    const scene = new ClubScene(canvas, game.club.color, (ms) => {
      // Average drawing time, exposed for the automated smoothness check.
      frames++;
      total += ms;
      if (frames % 30 === 0) canvas.dataset.frameMs = (total / frames).toFixed(2);
    });
    sceneRef.current = scene;
    scene.start();
    return () => { scene.stop(); sceneRef.current = null; };
  }, []); // created once; colours and activities are pushed in below

  useEffect(() => { sceneRef.current?.setActivities(activities, game.club.color); }, [activities, game.club.color]);

  const tap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = sceneRef.current?.pick(((e.clientX - r.left) / r.width) * SCENE_W, ((e.clientY - r.top) / r.height) * SCENE_H);
    if (id) showPlayer(id);
  };

  return (
    <section className="card club-view">
      <h3>俱乐部基地</h3>
      <canvas ref={canvasRef} className="club-canvas" onClick={tap} aria-label="俱乐部基地：训练室、休息室、办公室" />
      <ul className="plain small-text">{activitySummary(game, activities).map((l) => <li key={l}>{l}</li>)}</ul>
      <p className="dim small-text">点小人可以看选手详情。办公室里坐着的是你。</p>
    </section>
  );
}
