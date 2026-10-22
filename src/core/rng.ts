// The only source of randomness for simulation code.
// sfc32 generator seeded through splitmix32; state is four uint32 words.

export interface Rng {
  next(): number; // [0, 1)
  int(min: number, max: number): number; // inclusive on both ends
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  fork(label: string): Rng; // derive an independent stream without advancing this one
  state(): number[]; // for saving; restore with rngFromState
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

class Sfc32 implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(words: readonly number[]) {
    this.a = (words[0] ?? 0) >>> 0;
    this.b = (words[1] ?? 0) >>> 0;
    this.c = (words[2] ?? 0) >>> 0;
    this.d = (words[3] ?? 0) >>> 0;
  }

  private nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  next(): number {
    return this.nextUint32() / 4294967296;
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`rng.int: invalid range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError('rng.pick: empty array');
    return arr[Math.floor(this.next() * arr.length)] as T;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  fork(label: string): Rng {
    let h = hashString(label);
    h = hashString(`${this.a},${this.b},${this.c},${this.d}`, h);
    return createRng(h);
  }

  state(): number[] {
    return [this.a, this.b, this.c, this.d];
  }
}

export function createRng(seed: number): Rng {
  const sm = splitmix32(seed);
  const rng = new Sfc32([sm(), sm(), sm(), sm()]);
  // Discard the first outputs so nearby seeds diverge quickly.
  for (let i = 0; i < 12; i++) rng.next();
  return rng;
}

export function rngFromState(state: readonly number[]): Rng {
  if (state.length !== 4 || state.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffffffff)) {
    throw new RangeError('rngFromState: expected four uint32 words');
  }
  return new Sfc32(state);
}
