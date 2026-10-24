import { useEffect, useMemo, useRef } from 'react';
import { STAFF_ROLES, type GameData } from '../../core/types';
import type { GameState } from '../../game';
import { clubActivities } from '../../render/club/activities';
import { ClubScene, SCENE_H, SCENE_W, type Hotspot, type Marker } from '../../render/club/ClubScene';

/** The club base, the main screen. Taps on players and furniture are passed up. */
export function BaseView({ game, data, markers, cheer, onPlayer, onHotspot }: {
  game: GameState; data: GameData; markers: Partial<Record<Hotspot, Marker>>; cheer: boolean;
  onPlayer: (id: string) => void; onHotspot: (h: Hotspot) => void;
}) {
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
  }, []); // created once; colours, activities and markers are pushed in below

  useEffect(() => { sceneRef.current?.setActivities(activities, game.club.color, cheer); }, [activities, game.club.color, cheer]);
  useEffect(() => { sceneRef.current?.setMarkers(markers); }, [markers]);
  const titles = game.history.filter((h) => h.playerPlayoff === 'CHAMPION').length;
  const finals = game.history.filter((h) => h.playerPlayoff === 'FINAL').length;
  const rooms = JSON.stringify(game.club.facilities);
  const staff = STAFF_ROLES.map((r) => game.delegation.roles[r].staffId).filter((x): x is string => !!x).join(',');
  useEffect(() => { sceneRef.current?.setExtras({ titles, finals, facilities: JSON.parse(rooms), staff: staff ? staff.split(',') : [] }); }, [titles, finals, rooms, staff]);

  const tap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const hit = sceneRef.current?.tap(((e.clientX - r.left) / r.width) * SCENE_W, ((e.clientY - r.top) / r.height) * SCENE_H);
    if (hit?.kind === 'player') onPlayer(hit.id);
    else if (hit?.kind === 'hotspot') onHotspot(hit.name);
  };

  return (
    <div className="base-stage">
      <canvas ref={canvasRef} className="base-canvas" onClick={tap} aria-label="俱乐部基地。点白板排阵容，点电脑训练，点信箱看消息，点告示牌签人，点办公桌谈合同，点电视看赛程，点奖杯柜看历史，点小人看选手。" />
      <span className="roof-sign">{game.club.name}</span>
    </div>
  );
}
