// Pixel-exact drawing for the low-resolution scenes: no anti-aliasing, so the
// image stays crisp when scaled up. Shapes are filled row by row.

export type Pt = [number, number];

/** Fills a convex polygon one pixel row at a time (pixel centres inside the shape). */
export function fillPoly(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, inset = 0): void {
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const [, y] of pts) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  ctx.fillStyle = color;
  for (let y = Math.ceil(ymin - 0.5) + inset; y <= Math.floor(ymax - 0.5) - inset; y++) {
    const cy = y + 0.5;
    let xl = Infinity;
    let xr = -Infinity;
    for (let k = 0; k < pts.length; k++) {
      const [x1, y1] = pts[k]!;
      const [x2, y2] = pts[(k + 1) % pts.length]!;
      if ((cy < y1 && cy < y2) || (cy > y1 && cy > y2) || y1 === y2) continue;
      const x = x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1);
      xl = Math.min(xl, x);
      xr = Math.max(xr, x);
    }
    if (xl > xr) continue;
    const a = Math.round(xl) + inset;
    const b = Math.round(xr) - inset;
    if (b > a) ctx.fillRect(a, y, b - a, 1);
  }
}

/** Polygon with a 1-pixel outline. */
export function outlinedPoly(ctx: CanvasRenderingContext2D, pts: Pt[], fill: string, outline: string): void {
  fillPoly(ctx, pts, outline);
  fillPoly(ctx, pts, fill, 1);
}

export function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Mixes two colours (t = 0 gives a, 1 gives b). */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => Number.parseInt(h.slice(1, 7), 16);
  const x = p(a);
  const y = p(b);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** A sprite drawn from rows of palette letters ('.' = transparent). */
export function makeSprite(rows: readonly string[], palette: Readonly<Record<string, string>>): HTMLCanvasElement {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = palette[row[x]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

/** Mirrors a sprite left-right. */
export function flipped(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}
