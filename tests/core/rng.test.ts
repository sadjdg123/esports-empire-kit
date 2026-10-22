import { describe, expect, it } from 'vitest';
import { createRng, rngFromState } from '../../src/core/rng';

function draw(seed: number, n: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
}

describe('rng', () => {
  it('produces the same 10,000 numbers for the same seed', () => {
    expect(draw(42, 10_000)).toEqual(draw(42, 10_000));
  });

  it('produces different sequences for different seeds', () => {
    expect(draw(1, 100)).not.toEqual(draw(2, 100));
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const xs = draw(7, 20_000);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });

  it('int() covers both ends inclusively', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => rng.int(5, 1)).toThrow();
  });

  it('pick() and chance() are deterministic', () => {
    const a = createRng(9);
    const b = createRng(9);
    const items = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 100; i++) {
      expect(a.pick(items)).toBe(b.pick(items));
      expect(a.chance(0.3)).toBe(b.chance(0.3));
    }
    expect(() => a.pick([])).toThrow();
  });

  it('fork() does not advance the parent and is independent of draws on siblings', () => {
    const parent = createRng(11);
    const before = parent.state();
    const childA = parent.fork('a');
    expect(parent.state()).toEqual(before);

    const parent2 = createRng(11);
    const childA2 = parent2.fork('a');
    const childB2 = parent2.fork('b');
    for (let i = 0; i < 50; i++) childB2.next(); // extra draws on a sibling stream
    expect(Array.from({ length: 20 }, () => childA.next())).toEqual(Array.from({ length: 20 }, () => childA2.next()));
    expect(parent.next()).toBe(parent2.next());
  });

  it('forks with different labels differ', () => {
    const rng = createRng(5);
    expect(rng.fork('x').next()).not.toBe(rng.fork('y').next());
  });

  it('state() round-trips through rngFromState', () => {
    const rng = createRng(123);
    for (let i = 0; i < 17; i++) rng.next();
    const restored = rngFromState(rng.state());
    for (let i = 0; i < 100; i++) expect(restored.next()).toBe(rng.next());
    expect(() => rngFromState([1, 2, 3])).toThrow();
  });
});
