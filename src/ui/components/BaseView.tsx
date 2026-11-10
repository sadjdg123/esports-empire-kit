import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STAFF_ROLES, type GameData } from '../../core/types';
import type { GameState } from '../../game';
import { activitySummary, clubActivities } from '../../render/club/activities';
import { ClubScene, SCENE_H, SCENE_W, type Hotspot, type Marker } from '../../render/club/ClubScene';

type CameraZone = 'all' | 'lounge' | 'training' | 'office' | 'yard';

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.6;

const CAMERA_PRESETS: Record<CameraZone, { label: string; zoom: number; panX: number; panY: number }> = {
  all: { label: '🏠 全景', zoom: 1.18, panX: -1, panY: -3 },
  lounge: { label: '🛋️ 休息直播', zoom: 1.55, panX: 22, panY: 6 },
  training: { label: '💻 训练大厅', zoom: 1.48, panX: -3, panY: 4 },
  office: { label: '📋 行政荣誉', zoom: 1.55, panX: -22, panY: -6 },
  yard: { label: '🌳 户外庭院', zoom: 1.45, panX: 4, panY: -18 },
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

/** The club base, the main screen: single-floor Kairosoft studio with 1:1 finger-locked pan/pinch, camera presets, and furniture labels. */
export function BaseView({ game, data, markers, cheer, onPlayer, onHotspot }: {
  game: GameState; data: GameData; markers: Partial<Record<Hotspot, Marker>>; cheer: boolean;
  onPlayer: (id: string) => void; onHotspot: (h: Hotspot) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ClubScene | null>(null);
  const activities = useMemo(() => clubActivities(game, data), [game, data]);
  const summaryLines = useMemo(() => activitySummary(game, activities), [game, activities]);

  const [zone, setZone] = useState<CameraZone>('all');
  const zoneRef = useRef<CameraZone>('all');
  const [showTags, setShowTags] = useState(false);
  const [hoverTip, setHoverTip] = useState<string | null>(null);
  const [spots, setSpots] = useState<{ hotspot: Hotspot; label: string; x: number; y: number }[]>([]);
  const lastTouchTimeRef = useRef(0);

  // Live camera state in screen pixels (tx, ty) and scale (zoom), updated synchronously on DOM
  // during touch/mouse gestures so there is zero React render or CSS transition lag.
  const camRef = useRef<{ zoom: number; tx: number; ty: number }>({
    zoom: CAMERA_PRESETS.all.zoom,
    tx: 0,
    ty: 0,
  });

  const clampAndApply = useCallback((nextZoom: number, nextTx: number, nextTy: number, animate = false) => {
    const vp = viewportRef.current;
    const stage = stageRef.current;
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    const vpW = vp ? vp.clientWidth : 360;
    const vpH = vp ? vp.clientHeight : 240;
    const stW = stage ? stage.offsetWidth || vpW : vpW;
    const stH = stage ? stage.offsetHeight || vpH : vpH;
    // Strict edge clamp: scaled stage is (z * stW, z * stH), so maximum shift from center before
    // the canvas edge reaches the viewport border is ((z * stW - vpW) / 2, (z * stH - vpH) / 2).
    const maxTx = Math.max(0, (z * stW - vpW) / 2);
    const maxTy = Math.max(0, (z * stH - vpH) / 2);
    const tx = Math.max(-maxTx, Math.min(maxTx, nextTx));
    const ty = Math.max(-maxTy, Math.min(maxTy, nextTy));
    camRef.current = { zoom: z, tx, ty };
    if (stage) {
      stage.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
      stage.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${z.toFixed(4)})`;
    }
  }, []);

  const tapAt = useCallback((clientX: number, clientY: number): boolean => {
    const vp = viewportRef.current;
    const canvas = canvasRef.current;
    if (!vp || !canvas) return false;
    const vpRect = vp.getBoundingClientRect();
    if (clientX < vpRect.left || clientX > vpRect.right || clientY < vpRect.top || clientY > vpRect.bottom) return false;
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    const hit = sceneRef.current?.tap(
      ((clientX - r.left) / r.width) * SCENE_W,
      ((clientY - r.top) / r.height) * SCENE_H,
    );
    if (hit?.kind === 'player') {
      onPlayer(hit.id);
      return true;
    }
    if (hit?.kind === 'hotspot') {
      onHotspot(hit.name);
      return true;
    }
    return false;
  }, [onPlayer, onHotspot]);

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
    const vp = viewportRef.current;
    const w = vp ? vp.clientWidth : 360;
    const h = vp ? vp.clientHeight : 240;
    const preset = CAMERA_PRESETS.all;
    clampAndApply(preset.zoom, (preset.panX / 100) * w, (preset.panY / 100) * h, false);
    return () => { scene.stop(); sceneRef.current = null; };
  }, [clampAndApply]);

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

  // Native touch (1-finger drag + 2-finger focal-point pinch-zoom) and wheel zoom on the viewport
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let touchMode: 'none' | 'single' | 'pinch' = 'none';
    let moved = false;
    let hadMultiTouch = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let prevMidX = 0;
    let prevMidY = 0;
    let prevDist = 1;
    let lastTouchEnd = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const markManualCamera = () => {
      if (zoneRef.current !== 'all') {
        zoneRef.current = 'all';
        setZone('all');
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      lastTouchTimeRef.current = Date.now();
      if (e.touches.length === 1) {
        const t = e.touches[0]!;
        touchMode = 'single';
        moved = false;
        hadMultiTouch = false;
        startX = t.clientX;
        startY = t.clientY;
        lastX = t.clientX;
        lastY = t.clientY;
        if (stageRef.current) stageRef.current.style.transition = 'none';
      } else if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        const t0 = e.touches[0]!;
        const t1 = e.touches[1]!;
        touchMode = 'pinch';
        moved = true;
        hadMultiTouch = true;
        prevMidX = (t0.clientX + t1.clientX) / 2;
        prevMidY = (t0.clientY + t1.clientY) / 2;
        prevDist = Math.max(10, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
        if (stageRef.current) stageRef.current.style.transition = 'none';
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      lastTouchTimeRef.current = Date.now();
      // Always prevent default inside the viewport so iOS Safari / WeChat WebView never hijacks
      // a drag or pinch into page scrolling or elastic rubber-banding.
      if (e.cancelable) e.preventDefault();

      if (e.touches.length >= 2) {
        const t0 = e.touches[0]!;
        const t1 = e.touches[1]!;
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const dist = Math.max(10, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));

        if (touchMode !== 'pinch') {
          touchMode = 'pinch';
          hadMultiTouch = true;
          moved = true;
          prevMidX = midX;
          prevMidY = midY;
          prevDist = dist;
          return;
        }

        const vpRect = el.getBoundingClientRect();
        const cx = vpRect.left + vpRect.width / 2;
        const cy = vpRect.top + vpRect.height / 2;
        const { zoom: z0, tx: tx0, ty: ty0 } = camRef.current;
        const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z0 * (dist / prevDist)));
        const ratio = z1 / z0;
        // Keep the exact building point under (prevMidX, prevMidY) locked under (midX, midY)
        const nextTx = (midX - cx) - ratio * ((prevMidX - cx) - tx0);
        const nextTy = (midY - cy) - ratio * ((prevMidY - cy) - ty0);

        prevMidX = midX;
        prevMidY = midY;
        prevDist = dist;
        markManualCamera();
        clampAndApply(z1, nextTx, nextTy, false);
        return;
      }

      if (e.touches.length === 1 && touchMode === 'single') {
        const t = e.touches[0]!;
        if (!moved) {
          if (Math.hypot(t.clientX - startX, t.clientY - startY) <= 4) return;
          moved = true;
          lastX = startX;
          lastY = startY;
        }
        const dx = t.clientX - lastX;
        const dy = t.clientY - lastY;
        lastX = t.clientX;
        lastY = t.clientY;
        const { zoom, tx, ty } = camRef.current;
        markManualCamera();
        clampAndApply(zoom, tx + dx, ty + dy, false);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastTouchTimeRef.current = Date.now();
      if (e.touches.length === 1) {
        // Transition seamlessly from 2-finger pinch down to 1-finger pan without jumping
        const t = e.touches[0]!;
        touchMode = 'single';
        lastX = t.clientX;
        lastY = t.clientY;
        return;
      }
      if (e.touches.length === 0) {
        const now = Date.now();
        if (!moved && !hadMultiTouch) {
          if (e.cancelable) e.preventDefault();
          const hit = tapAt(startX, startY);
          if (hit) {
            lastTouchEnd = 0;
          } else if (now - lastTouchEnd < 280 && Math.hypot(startX - lastTapX, startY - lastTapY) < 24) {
            // Double-tap on empty floor/sky zooms in on that spot (or resets if already zoomed in)
            const vpRect = el.getBoundingClientRect();
            const cx = vpRect.left + vpRect.width / 2;
            const cy = vpRect.top + vpRect.height / 2;
            const { zoom: z0, tx: tx0, ty: ty0 } = camRef.current;
            if (z0 < 1.65) {
              const z1 = 1.85;
              const ratio = z1 / z0;
              clampAndApply(z1, (startX - cx) - ratio * ((startX - cx) - tx0), (startY - cy) - ratio * ((startY - cy) - ty0), true);
            } else {
              const preset = CAMERA_PRESETS.all;
              clampAndApply(preset.zoom, (preset.panX / 100) * vpRect.width, (preset.panY / 100) * vpRect.height, true);
            }
            lastTouchEnd = 0;
          } else {
            lastTouchEnd = now;
            lastTapX = startX;
            lastTapY = startY;
          }
        }
        touchMode = 'none';
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
      const vpRect = el.getBoundingClientRect();
      const cx = vpRect.left + vpRect.width / 2;
      const cy = vpRect.top + vpRect.height / 2;
      const { zoom: z0, tx: tx0, ty: ty0 } = camRef.current;
      const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z0 * Math.exp(-e.deltaY * 0.002)));
      const ratio = z1 / z0;
      const mx = e.clientX - cx;
      const my = e.clientY - cy;
      const nextTx = mx - ratio * (mx - tx0);
      const nextTy = my - ratio * (my - ty0);
      markManualCamera();
      clampAndApply(z1, nextTx, nextTy, false);
    };

    const preventGesture = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };

    const onResize = () => {
      const { zoom, tx, ty } = camRef.current;
      clampAndApply(zoom, tx, ty, false);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd, { passive: false });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', preventGesture, { passive: false });
    el.addEventListener('gesturechange', preventGesture, { passive: false });
    el.addEventListener('gestureend', preventGesture, { passive: false });
    window.addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', preventGesture);
      el.removeEventListener('gesturechange', preventGesture);
      el.removeEventListener('gestureend', preventGesture);
      window.removeEventListener('resize', onResize);
    };
  }, [clampAndApply, tapAt]);

  // Desktop mouse drag & hover tooltip
  const mouseRef = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; lastX: number; lastY: number }>({
    active: false, moved: false, startX: 0, startY: 0, lastX: 0, lastY: 0,
  });

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || Date.now() - lastTouchTimeRef.current < 500) return;
    mouseRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
    };
    if (stageRef.current) stageRef.current.style.transition = 'none';
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastTouchTimeRef.current < 500) return;
    const m = mouseRef.current;
    if (m.active) {
      if (!m.moved) {
        if (Math.hypot(e.clientX - m.startX, e.clientY - m.startY) <= 4) return;
        m.moved = true;
        m.lastX = m.startX;
        m.lastY = m.startY;
      }
      const dx = e.clientX - m.lastX;
      const dy = e.clientY - m.lastY;
      m.lastX = e.clientX;
      m.lastY = e.clientY;
      const { zoom, tx, ty } = camRef.current;
      if (zoneRef.current !== 'all') {
        zoneRef.current = 'all';
        setZone('all');
      }
      clampAndApply(zoom, tx + dx, ty + dy, false);
      return;
    }

    const canvas = canvasRef.current;
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

  const onMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastTouchTimeRef.current < 500) return;
    const m = mouseRef.current;
    if (m.active && !m.moved) {
      tapAt(e.clientX, e.clientY);
    }
    m.active = false;
  };

  const applyZone = (z: CameraZone) => {
    const preset = CAMERA_PRESETS[z];
    const vp = viewportRef.current;
    const w = vp ? vp.clientWidth : 360;
    const h = vp ? vp.clientHeight : 240;
    zoneRef.current = z;
    setZone(z);
    clampAndApply(preset.zoom, (preset.panX / 100) * w, (preset.panY / 100) * h, true);
  };

  return (
    <div className="base-wrap">
      <div className="base-toolbar" role="toolbar" aria-label="基地视角切换">
        <div className="camera-pills">
          {(Object.keys(CAMERA_PRESETS) as CameraZone[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`cam-pill ${zone === k ? 'on' : ''}`}
              onClick={() => applyZone(k)}
            >
              {CAMERA_PRESETS[k].label}
            </button>
          ))}
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
        className="base-viewport"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { mouseRef.current.active = false; setHoverTip(null); }}
      >
        <div
          ref={stageRef}
          className="base-stage"
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

