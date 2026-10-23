// Which sprite frame each hero shows, from the snapshots the match view receives.
// Pure (no Phaser or DOM) and only reads snapshots, so it can never change a result.
// Times are real milliseconds of the view, not match time.

import type { RenderSnapshot } from '../core/types';
import type { HeroFrame } from './pixel/heroArt';

export const SWING_MS = 140; // half of one weapon swing while fighting
export const COMBAT_MS = 320; // keep swinging this long after the last hit
export const CAST_MS = 480;
export const STEP_MS = 130; // one walking step
export const DOWN_MS = 1800; // lie on the ground this long, then vanish until the respawn
const FADE_MS = 500;
const JUMP = 120; // a move longer than this is a respawn or a dash, not walking

export interface HeroAnim {
  facing: 1 | -1;
  moving: boolean;
  combatUntil: number;
  castUntil: number;
  downSince: number | null;
  phase: number; // per-hero offset so a team does not step and swing in unison
}

export interface HeroPose {
  frame: HeroFrame;
  flip: boolean; // true = facing left
  alpha: number; // 0 = not drawn
  bob: number; // pixels to lift the sprite (walking)
}

function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return h * 7;
}

/** Updates every hero's animation state from one new snapshot. */
export function updateHeroAnims(anims: Map<string, HeroAnim>, prev: RenderSnapshot, cur: RenderSnapshot, now: number): void {
  const before = new Map(prev.units.map((u) => [u.id, u]));
  const byId = new Map(cur.units.map((u) => [u.id, u]));
  for (const u of cur.units) {
    if (u.kind !== 'HERO') continue;
    let a = anims.get(u.id);
    if (!a) {
      a = { facing: u.side === 'RED' ? -1 : 1, moving: false, combatUntil: 0, castUntil: 0, downSince: null, phase: phaseOf(u.id) };
      anims.set(u.id, a);
    }
    if (!u.alive) {
      a.downSince ??= now;
      a.moving = false;
      continue;
    }
    if (a.downSince !== null) { a.downSince = null; a.combatUntil = 0; a.castUntil = 0; }
    const p = before.get(u.id);
    const dx = p ? u.x - p.x : 0;
    const d = p ? Math.hypot(dx, u.y - p.y) : 0;
    a.moving = d > 0.5 && d < JUMP;
    if (a.moving && Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
  }
  for (const atk of cur.attacks) {
    const a = anims.get(atk.from);
    if (!a || a.downSince !== null) continue;
    if (atk.kind === 'SKILL') a.castUntil = now + CAST_MS;
    else a.combatUntil = now + COMBAT_MS;
    const from = byId.get(atk.from);
    const to = byId.get(atk.to);
    if (from && to && atk.from !== atk.to && Math.abs(to.x - from.x) > 0.5) a.facing = to.x > from.x ? 1 : -1;
  }
}

/** The frame to draw now. */
export function heroPose(a: HeroAnim, now: number): HeroPose {
  const flip = a.facing < 0;
  if (a.downSince !== null) {
    const t = now - a.downSince;
    const alpha = t >= DOWN_MS ? 0 : t > DOWN_MS - FADE_MS ? (DOWN_MS - t) / FADE_MS : 1;
    return { frame: 'down', flip, alpha, bob: 0 };
  }
  const tick = (ms: number) => Math.floor((now + a.phase) / ms) % 2 === 0;
  if (now < a.castUntil) return { frame: 'cast', flip, alpha: 1, bob: 0 };
  if (now < a.combatUntil) return { frame: tick(SWING_MS) ? 'attack' : 'stand', flip, alpha: 1, bob: 0 };
  if (a.moving) {
    const left = tick(STEP_MS);
    return { frame: left ? 'walkA' : 'walkB', flip, alpha: 1, bob: left ? 1 : 0 };
  }
  return { frame: 'stand', flip, alpha: 1, bob: 0 };
}
