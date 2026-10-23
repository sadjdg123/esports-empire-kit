// Playback controller: drives createMatch/step at a chosen speed and keeps the
// last two snapshots for interpolation. No Phaser or DOM here, so watching,
// skipping and runMatch can be compared in tests.

import type { GameData, MatchInput, MatchResult, RenderSnapshot } from '../core/types';
import { createMatch, finalize, getSnapshot, isOver, step, type MatchState } from '../sim';

export type Speed = 1 | 2 | 4;

export class MatchPlayer {
  readonly state: MatchState;
  readonly secPerTick: number; // real seconds per tick at 1x
  prev: RenderSnapshot;
  cur: RenderSnapshot;
  speed: Speed = 1;
  paused = false;
  private acc = 0;
  private result: MatchResult | null = null;

  constructor(input: MatchInput, data: GameData) {
    this.state = createMatch(input, data);
    this.secPerTick = data.match.time.realSecPerTickAt1x;
    this.cur = getSnapshot(this.state);
    this.prev = this.cur;
  }

  get over(): boolean {
    return isOver(this.state);
  }

  /** 0..1 progress between prev and cur, for smooth movement. */
  get alpha(): number {
    return this.over ? 1 : Math.min(1, this.acc / this.secPerTick);
  }

  /** Advances by real elapsed seconds. Returns the snapshots produced (oldest first). */
  advance(realSec: number): RenderSnapshot[] {
    if (this.paused || this.over) return [];
    this.acc += realSec * this.speed;
    const produced: RenderSnapshot[] = [];
    // Cap work per frame so a background tab does not freeze when it comes back.
    let guard = 64;
    while (this.acc >= this.secPerTick && !this.over && guard-- > 0) {
      this.acc -= this.secPerTick;
      produced.push(this.tick());
    }
    if (guard <= 0) this.acc = 0;
    return produced;
  }

  /** One simulation tick. */
  tick(): RenderSnapshot {
    step(this.state);
    this.prev = this.cur;
    this.cur = getSnapshot(this.state);
    return this.cur;
  }

  /** Skip = keep stepping without rendering. Same step() as watching, so the result is identical. */
  skip(): MatchResult {
    while (!this.over) step(this.state);
    this.prev = this.cur = getSnapshot(this.state);
    return this.finish();
  }

  finish(): MatchResult {
    if (!this.over) throw new Error('match still running');
    this.result ??= finalize(this.state);
    return this.result;
  }
}

/** Interpolated position of a unit between two snapshots. */
export function lerpUnit(prev: RenderSnapshot, cur: RenderSnapshot, id: string, alpha: number): { x: number; y: number } | null {
  const b = cur.units.find((u) => u.id === id);
  if (!b) return null;
  const a = prev.units.find((u) => u.id === id);
  if (!a || !a.alive || !b.alive) return { x: b.x, y: b.y };
  // A respawn or a dash jumps; do not slide across the map.
  if (Math.hypot(a.x - b.x, a.y - b.y) > 120) return { x: b.x, y: b.y };
  return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha };
}
