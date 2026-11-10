import { useEffect, useMemo, useRef, useState } from 'react';
import { STAFF_ROLES, type GameData } from '../../core/types';
import type { GameState } from '../../game';
import { activitySummary, clubActivities } from '../../render/club/activities';
import { ClubScene, SCENE_H, SCENE_W, type Hotspot, type Marker } from '../../render/club/ClubScene';

type CameraZone = 'all' | 'lounge' | 'training' | 'office' | 'yard';

const CAMERA_PRESETS: Record<CameraZone, { label: string; zoom: number; panX: number; panY: number }> = {
  all: { label: '🏠 全景', zoom: 1, panX: 0, panY: 0 },
  lounge: { label: '🛋️ 休息直播', zoom: 1.48, panX: 25, panY: 8 },
  training: { label: '💻 训练大厅', zoom: 1.45, panX: -4, panY: 4 },
  office: { label: '📋 行政荣誉', zoom: 1.48, panX: -28, panY: -8 },
  yard: { label: '🌳 户外庭院', zoom: 1.38, panX: 4, panY: -20 },
};

const HOTSPOT_SHORT: Record<Hotspot, string> = {
  lineup: '阵容',
  training: '训练',
  schedule: '赛程',
  contracts: '合同',
  finance: '财务',
  history: '荣誉',
  report: '战报',
  inbox: '收件箱',
  market: '签人',
  facilities: '设施',
  staff: '管理层',
  group: '集团',
};

/** The club base, the main screen: single-floor Kairosoft studio with pan/drag, camera presets, and furniture labels. */
export function BaseView({ game, data, markers, cheer, onPlayer, onHotspot }: {
  game: GameState; data: GameData; markers: Partial<Record<Hotspot, Marker>>; cheer: boolean;
  onPlayer: (id: string) => void; onHotspot: (h: Hotspot) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ClubScene | null>(null);
  const activities = useMemo(() => clubActivities(game, data), [game, data]);
  const summaryLines = useMemo(() => activitySummary(game, activities), [game, activities]);

  const [zone, setZone] = useState<CameraZone>('all');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showTags, setShowTags] = useState(false);
  const [hoverTip, setHoverTip] = useState<string | null>(null);
  const [spots, setSpots] = useState<{ hotspot: Hotspot; label: string; x: number; y: number }[]>([]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    active: boolean;
    startDist: number;
    startMidX: number;
    startMidY: number;
    origZoom: number;
    origPanX: number;
    origPanY: number;
  }>({
    active: false, startDist: 1, startMidX: 0, startMidY: 0, origZoom: 1, origPanX: 0, origPanY: 0,
  });

  const dragRef = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frames = 0;
    let total = 0;
    const scene = new ClubScene(canvas, game.club.color, (ms) => {
      frames++;
      total += ms;
      if (frames % 30 === 0) canvas.dataset.frameMs = (total / frames).toFixed(2);
    });
    sceneRef.current = scene;
    scene.start();
    setSpots(scene.hotspotSpots());
    return () => { scene.stop(); sceneRef.current = null; };
  }, []);

  useEffect(() => { sceneRef.current?.setActivities(activities, game.club.color, cheer); }, [activities, game.club.color, cheer]);
  useEffect(() => { sceneRef.current?.setMarkers(markers); }, [markers]);
  const titles = game.history.filter((h) => h.playerPlayoff === 'CHAMPION').length;
  const finals = game.history.filter((h) => h.playerPlayoff === 'FINAL').length;
  const rooms = JSON.stringify(game.club.facilities);
  const staff = STAFF_ROLES.map((r) => game.delegation.roles[r].staffId).filter((x): x is string => !!x).join(',');
  const branches = Object.keys(game.branches).join(',');
  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.setExtras({
      titles, finals,
      facilities: JSON.parse(rooms),
      staff: staff ? staff.split(',') : [],
      branches: branches ? (branches.split(',') as ('FPS' | 'CARD')[]) : [],
    });
    setSpots(sceneRef.current.hotspotSpots());
  }, [titles, finals, rooms, staff, branches]);

  const clampPan = (nx: number, ny: number, z: number) => {
    if (z <= 1.02) return { x: 0, y: 0 };
    const maxPan = Math.max(18, (z - 1) * 44 + 14);
    return {
      x: Math.max(-maxPan, Math.min(maxPan, nx)),
      y: Math.max(-maxPan, Math.min(maxPan, ny)),
    };
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZone('all');
      setZoom((prevZoom) => {
        const nextZoom = Math.max(1, Math.min(2.6, prevZoom * Math.exp(-e.deltaY * 0.002)));
        setPan((prevPan) => clampPan(prevPan.x, prevPan.y, nextZoom));
        return nextZoom;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const applyZone = (z: CameraZone) => {
    const preset = CAMERA_PRESETS[z];
    setZone(z);
    setZoom(preset.zoom);
    setPan({ x: preset.panX, y: preset.panY });
  };

  const beginPinchIfTwoFingers = () => {
    const pts = [...pointersRef.current.values()];
    if (pts.length >= 2) {
      const p1 = pts[0]!;
      const p2 = pts[1]!;
      pinchRef.current = {
        active: true,
        startDist: Math.max(12, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
        startMidX: (p1.x + p2.x) / 2,
        startMidY: (p1.y + p2.y) / 2,
        origZoom: zoom,
        origPanX: pan.x,
        origPanY: pan.y,
      };
      dragRef.current.moved = true;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2) {
      beginPinchIfTwoFingers();
      return;
    }
    pinchRef.current.active = false;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointersRef.current.size >= 2 && canvas) {
      if (!pinchRef.current.active) beginPinchIfTwoFingers();
      const pts = [...pointersRef.current.values()];
      const p1 = pts[0]!;
      const p2 = pts[1]!;
      const dist = Math.max(12, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const p = pinchRef.current;
      const nextZoom = Math.max(1, Math.min(2.6, p.origZoom * (dist / p.startDist)));
      const rect = canvas.getBoundingClientRect();
      const baseW = Math.max(1, rect.width / zoom);
      const baseH = Math.max(1, rect.height / zoom);
      const pctX = ((midX - p.startMidX) / baseW) * 100;
      const pctY = ((midY - p.startMidY) / baseH) * 100;
      setZone('all');
      setZoom(nextZoom);
      setPan(clampPan(p.origPanX + pctX, p.origPanY + pctY, nextZoom));
      dragRef.current.moved = true;
      return;
    }

    const d = dragRef.current;
    if (d.active && canvas) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) > 6) {
        d.moved = true;
        const rect = canvas.getBoundingClientRect();
        const pctX = (dx / Math.max(1, rect.width / zoom)) * 100;
        const pctY = (dy / Math.max(1, rect.height / zoom)) * 100;
        setZone('all');
        setPan(clampPan(d.origX + pctX, d.origY + pctY, Math.max(1.15, zoom)));
      }
      return;
    }
    if (!canvas || !sceneRef.current) return;
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * SCENE_W;
    const sy = ((e.clientY - r.top) / r.height) * SCENE_H;
    const hit = sceneRef.current.tap(sx, sy);
    if (!hit) {
      setHoverTip(null);
    } else if (hit.kind === 'player') {
      const p = game.players[hit.id];
      const act = activities.find((a) => a.playerId === hit.id);
      setHoverTip(p ? `👤 ${p.name} · ${act?.reason ?? '在基地里'}（点击查看选手卡）` : null);
    } else {
      setHoverTip(`📌 ${HOTSPOT_SHORT[hit.name]}（点击打开）`);
    }
  };

  const stopPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    // A press released without dragging is a tap. It is handled here because the viewport holds the
    // pointer capture, so the browser's click lands on the viewport, never on the canvas.
    const single = pointersRef.current.size === 1 && pointersRef.current.has(e.pointerId);
    if (e.type === 'pointerup' && single && dragRef.current.active && !dragRef.current.moved && !pinchRef.current.active) tapAt(e.clientX, e.clientY);
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current.active = false;
    }
    if (pointersRef.current.size === 1) {
      const rem = [...pointersRef.current.values()][0]!;
      dragRef.current = {
        active: true,
        moved: true,
        startX: rem.x,
        startY: rem.y,
        origX: pan.x,
        origY: pan.y,
      };
    } else if (pointersRef.current.size === 0) {
      dragRef.current.active = false;
    }
  };

  const tapAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;
    const hit = sceneRef.current?.tap(((clientX - r.left) / r.width) * SCENE_W, ((clientY - r.top) / r.height) * SCENE_H);
    if (hit?.kind === 'player') onPlayer(hit.id);
    else if (hit?.kind === 'hotspot') onHotspot(hit.name);
  };

  return (
    <div className="base-wrap">
      <div className="base-toolbar" role="toolbar" aria-label="基地视角切换">
        <div className="camera-pills">
          {(Object.keys(CAMERA_PRESETS) as CameraZone[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`cam-pill ${zone === k && Math.abs(zoom - CAMERA_PRESETS[k].zoom) < 0.05 ? 'on' : ''}`}
              onClick={() => applyZone(k)}
            >
              {CAMERA_PRESETS[k].label}
            </button>
          ))}
        </div>
        <div className="camera-tools">
          <button
            type="button"
            className={`cam-pill ${showTags ? 'on' : ''}`}
            onClick={() => setShowTags((v) => !v)}
            title="显示或隐藏设施名称标签"
          >
            🏷️ 导览
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`base-viewport ${dragRef.current.active || pinchRef.current.active ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
        onPointerLeave={(e) => { stopPointer(e); setHoverTip(null); }}
      >
        <div
          className="base-stage"
          style={{
            transform: `translate(${pan.x}%, ${pan.y}%) scale(${zoom})`,
          }}
        >
          <canvas
            ref={canvasRef}
            className="base-canvas"
            aria-label="俱乐部基地。点白板排阵容，点电脑训练，点信箱看消息，点告示牌签人，点办公桌谈合同，点电视看赛程，点奖杯柜看历史，点屋顶招牌看集团分部，点小人看选手。"
          />
          <span className="roof-sign">{game.club.name}</span>
          {showTags && spots.map((s) => (
            <span
              key={s.hotspot}
              className={`hotspot-tag ${markers[s.hotspot] ? 'alert' : ''}`}
              style={{
                left: `${(s.x / SCENE_W) * 100}%`,
                top: `${(Math.max(8, s.y - 3) / SCENE_H) * 100}%`,
              }}
            >
              {HOTSPOT_SHORT[s.hotspot]}
            </span>
          ))}
        </div>
        {hoverTip && <div className="base-hover-tip">{hoverTip}</div>}
      </div>

      <div className="base-caption">
        <div className="base-caption-lines">
          {summaryLines.map((ln, idx) => (
            <span key={idx} className="caption-chip">{ln}</span>
          ))}
        </div>
        <span className="caption-hint">💡 双指捏合缩放 · 单指按住拖动 · 点击家具或选手操作</span>
      </div>
    </div>
  );
}
