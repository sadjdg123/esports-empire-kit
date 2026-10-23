// The match camera: the whole map normally; closer in on a teamfight when set to follow.
// Pure, in screen pixels of the match view (0..view).

export interface Cam { zoom: number; x: number; y: number } // x, y: the point in the middle of the view

export const FIGHT_ZOOM = 1.6;

/** Where the camera wants to be: on the fight if there is one and following is on, else the whole map. */
export function cameraTarget(view: number, fight: { x: number; y: number } | null, follow: boolean): Cam {
  if (!fight || !follow) return { zoom: 1, x: view / 2, y: view / 2 };
  return clampCam({ zoom: FIGHT_ZOOM, x: fight.x, y: fight.y }, view);
}

/** Keeps the view inside the map. */
export function clampCam(c: Cam, view: number): Cam {
  const half = view / (2 * c.zoom);
  const clamp = (v: number) => Math.min(view - half, Math.max(half, v));
  return { zoom: c.zoom, x: clamp(c.x), y: clamp(c.y) };
}

/** Moves the camera smoothly towards a target; `dt` in seconds. */
export function approachCam(cur: Cam, target: Cam, dt: number, view: number): Cam {
  const k = 1 - Math.exp(-3 * dt);
  const zoom = cur.zoom + (target.zoom - cur.zoom) * k;
  const settle = (a: number, b: number) => (Math.abs(b - a) < 0.05 ? b : a + (b - a) * k);
  return clampCam({ zoom: Math.abs(target.zoom - zoom) < 0.002 ? target.zoom : zoom, x: settle(cur.x, target.x), y: settle(cur.y, target.y) }, view);
}

/**
 * The CSS background (the painted ground) that matches the camera, for a view shown
 * `shownPx` pixels wide: its size and its top-left corner, in CSS pixels.
 */
export function groundBox(c: Cam, view: number, shownPx: number): { size: number; x: number; y: number } {
  const k = shownPx / view;
  const left = c.x - view / (2 * c.zoom);
  const top = c.y - view / (2 * c.zoom);
  return { size: view * c.zoom * k, x: -left * c.zoom * k + 0, y: -top * c.zoom * k + 0 }; // + 0 turns -0 into 0
}
