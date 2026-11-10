import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { runMatch } from '../../src/sim';
import { clubTeam } from '../../src/sim/scenario';
import { MatchPlayer, lerpUnit, unitById } from '../../src/render/player';

const data = loadGameData();
const input = (seed: number) => ({ seed, blue: clubTeam(data, 'chaosheng', 'EARLY_AGGRO'), red: clubTeam(data, 'tianshu', 'TEAMFIGHT_PUSH') });

describe('MatchPlayer (watch vs skip vs runMatch)', () => {
  it('watching frame by frame with speed changes and pauses gives the same result as runMatch', () => {
    const direct = runMatch(input(3), data);
    const p = new MatchPlayer(input(3), data);
    let frame = 0;
    while (!p.over) {
      frame++;
      if (frame % 500 === 0) p.speed = p.speed === 1 ? 4 : p.speed === 4 ? 2 : 1;
      p.paused = frame % 97 < 3; // pause now and then
      p.advance(1 / 60);
      if (frame > 2_000_000) throw new Error('runaway');
    }
    const watched = p.finish();
    expect(watched.checksum).toBe(direct.checksum);
    expect(watched.winner).toBe(direct.winner);
    expect(watched.durationSec).toBe(direct.durationSec);
  }, 60_000);

  it('skipping halfway gives the same result as watching to the end', () => {
    const direct = runMatch(input(8), data);
    const p = new MatchPlayer(input(8), data);
    p.speed = 4;
    for (let i = 0; i < 300; i++) p.advance(1 / 30); // ~350 ticks: well before the end
    expect(p.over).toBe(false);
    expect(p.skip().checksum).toBe(direct.checksum);
  });

  it('1x playback of a whole match takes about 2-3 minutes of real time', () => {
    const r = runMatch(input(5), data);
    const realSec = r.durationSec * data.match.time.realSecPerTickAt1x;
    expect(realSec).toBeGreaterThan(90);
    expect(realSec).toBeLessThan(240);
  });

  it('paused playback does not advance; interpolation stays between snapshots', () => {
    const p = new MatchPlayer(input(4), data);
    p.paused = true;
    expect(p.advance(10)).toHaveLength(0);
    p.paused = false;
    p.advance(data.match.time.realSecPerTickAt1x * 40.5);
    const hero = p.cur.units.find((u) => u.kind === 'HERO')!;
    const mid = lerpUnit(p.prev, p.cur, hero.id, 0.5)!;
    const a = p.prev.units.find((u) => u.id === hero.id)!;
    expect(mid.x).toBeGreaterThanOrEqual(Math.min(a.x, hero.x) - 1e-9);
    expect(mid.x).toBeLessThanOrEqual(Math.max(a.x, hero.x) + 1e-9);
    expect(p.alpha).toBeGreaterThanOrEqual(0);
    expect(p.alpha).toBeLessThanOrEqual(1);
  });

  it('unitById caches O(1) snapshot lookups accurately across ticks', () => {
    const p = new MatchPlayer(input(6), data);
    for (let i = 0; i < 15; i++) {
      const snap = p.tick();
      for (const u of snap.units) {
        expect(unitById(snap, u.id)).toBe(u);
      }
      expect(unitById(snap, '__non_existent_unit__')).toBeUndefined();
    }
  });
});
