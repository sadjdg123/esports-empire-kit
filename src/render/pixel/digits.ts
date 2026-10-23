// A tiny pixel font for damage and heal numbers: 3x5 glyphs with a 1-pixel dark outline,
// all in one strip (used as a fixed-width bitmap font in the match view).

export const DIGIT_CHARS = '0123456789+-';
export const DIGIT_W = 5;
export const DIGIT_H = 7;

const GLYPHS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'],
};

/** The whole strip as rows: 'w' fill, 'o' outline, '.' clear. */
export function digitStrip(): string[] {
  const w = DIGIT_CHARS.length * DIGIT_W;
  const g = Array.from({ length: DIGIT_H }, () => Array.from({ length: w }, () => '.'));
  [...DIGIT_CHARS].forEach((ch, i) => {
    const glyph = GLYPHS[ch]!;
    glyph.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== '#') return;
      const gx = i * DIGIT_W + 1 + x;
      const gy = 1 + y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g[gy + dy]![gx + dx] === '.') g[gy + dy]![gx + dx] = 'o';
    }));
    glyph.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') g[1 + y]![i * DIGIT_W + 1 + x] = 'w'; }));
  });
  return g.map((r) => r.join(''));
}
