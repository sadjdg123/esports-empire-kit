// Minimal PNG writer (RGBA, no filtering) for the art preview tools.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

export function writePng(path: string, w: number, h: number, rgba: Uint8Array | Uint8ClampedArray): void {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** Copies a sprite (rows of palette letters) into an RGBA buffer at (x, y), `scale` pixels per sprite pixel. */
export function blit(buf: Uint8Array | Uint8ClampedArray, w: number, rows: readonly string[], pal: Readonly<Record<string, string>>, x: number, y: number, scale = 1): void {
  const h = buf.length / 4 / w;
  rows.forEach((line, dy) => [...line].forEach((ch, dx) => {
    const col = pal[ch];
    if (!col) return;
    const n = Number.parseInt(col.slice(1), 16);
    for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
      const px = (x + dx) * scale + b;
      const py = (y + dy) * scale + a;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const k = (py * w + px) * 4;
      buf[k] = n >> 16; buf[k + 1] = (n >> 8) & 255; buf[k + 2] = n & 255; buf[k + 3] = 255;
    }
  }));
}
