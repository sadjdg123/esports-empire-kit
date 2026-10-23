import { describe, expect, it } from 'vitest';
import { DataValidationError, defaultRawData, loadGameData } from '../../src/core/config';
import { personalityFor } from '../../src/core/personality';
import { createRng } from '../../src/core/rng';
import { PLAYER_CLUB_ID, buildSchedule, newGame } from '../../src/game';

const data = loadGameData();

describe('personality (T21)', () => {
  it('is the same for the same player every time, and every player has one', () => {
    const a = newGame('一', '#123456', 1, data);
    const b = newGame('二', '#654321', 99, data);
    for (const id of Object.keys(a.players)) {
      expect(a.players[id]!.traits).toEqual(b.players[id]!.traits);
      expect(a.players[id]!.growthType).toBe(b.players[id]!.growthType);
      expect(a.players[id]!.career).toEqual([]);
    }
  });

  it('never combines traits that exclude each other, and follows the configured shares roughly', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `test_${i}`);
    const counts = [0, 0, 0];
    const growth = { EARLY: 0, NORMAL: 0, LATE: 0 };
    const known = new Map(data.traits.traits.map((t) => [t.id, t]));
    for (const id of ids) {
      const p = personalityFor(id, data.traits, data.growth);
      counts[p.traits.length]!++;
      growth[p.growthType]++;
      expect(new Set(p.traits).size).toBe(p.traits.length);
      for (const t of p.traits) {
        expect(known.has(t)).toBe(true);
        for (const x of known.get(t)!.excludes ?? []) expect(p.traits).not.toContain(x);
      }
    }
    const total = data.traits.countWeights.reduce((a, b) => a + b, 0);
    data.traits.countWeights.forEach((w, n) => expect(counts[n]! / ids.length).toBeCloseTo(w / total, 1));
    expect(growth.NORMAL / ids.length).toBeCloseTo(0.5, 1);
  });

  it('does not use the game random numbers: a new game draws exactly what building the schedule draws', () => {
    const s = newGame('三', '#123456', 5, data);
    const rng = createRng(5);
    buildSchedule([PLAYER_CLUB_ID, ...data.clubs.map((c) => c.id)], 5, rng);
    expect(s.rngState).toEqual(rng.state());
  });
});

describe('P2 data files (T21)', () => {
  it('rejects a trait whose match effect is larger than ±5% (D50)', () => {
    const raw = defaultRawData();
    (raw.traits as { traits: { effects: Record<string, number> }[] }).traits[0]!.effects.behindPerformance = 0.08;
    expect(() => loadGameData(raw)).toThrow(DataValidationError);
  });

  it('rejects a room whose first level is not free, or a missing room', () => {
    const raw = defaultRawData();
    (raw.facilities as { rooms: { levels: { cost: number }[] }[] }).rooms[0]!.levels[0]!.cost = 100;
    expect(() => loadGameData(raw)).toThrow(/level 1 must be free/);
    const raw2 = defaultRawData();
    (raw2.facilities as { rooms: unknown[] }).rooms.pop();
    expect(() => loadGameData(raw2)).toThrow(DataValidationError);
  });
});
