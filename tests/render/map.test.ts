import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { DECOR_COLORS, MAP_PX, MAP_SPRITES, gx, groundPixels, mapPalette } from '../../src/render/pixel/mapArt';

const data = loadGameData();
const map = data.match.map;
const ground = groundPixels(map);
const at = (x: number, y: number) => {
  const k = (Math.floor(gx(y)) * MAP_PX + Math.floor(gx(x))) * 4;
  return `#${[ground[k]!, ground[k + 1]!, ground[k + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
const decor = new Set(Object.values(DECOR_COLORS));

describe('map ground', () => {
  it('is a complete opaque picture, the same every time', () => {
    expect(ground).toHaveLength(MAP_PX * MAP_PX * 4);
    for (let i = 3; i < ground.length; i += 4) if (ground[i] !== 255) throw new Error(`transparent pixel ${i}`);
    expect(groundPixels({ ...map })).toEqual(ground); // painted afresh for a new map object
  });

  it('keeps every lane, jungle trail, camp, tower and base clear of trees and rocks', () => {
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const pairs = [...map.edges, ...Object.values(map.lanes).flatMap((ids) => ids.slice(1).map((id, i) => [ids[i]!, id] as [string, string]))];
    for (const [a, b] of pairs) {
      const na = byId.get(a)!;
      const nb = byId.get(b)!;
      for (let t = 0; t <= 1; t += 0.05) {
        const x = na.x + (nb.x - na.x) * t;
        const y = na.y + (nb.y - na.y) * t;
        expect(decor.has(at(x, y)), `${a}-${b} at ${t.toFixed(2)}`).toBe(false);
      }
    }
  });

  it('has the river, a bridge where the middle lane crosses it, and platforms for the objectives', () => {
    const water = at(200, 200);
    expect(at(800, 800)).toBe(water);
    expect(['#b07a44', '#a06c3a', '#6b4424']).toContain(at(500, 500)); // planks
    for (const o of data.match.objectives) {
      const n = map.nodes.find((m) => m.id === o.nodeId)!;
      expect(at(n.x, n.y)).not.toBe(water);
    }
    // A lane is stone, not grass.
    expect(['#cdbf98', '#c4b58c', '#d6c9a4', '#a39470']).toContain(at(90, 500));
  });
});

describe('map sprites', () => {
  it('every sprite is a clean rectangle that only uses known colours', () => {
    const team = mapPalette('#3a7bd5');
    const neutral = mapPalette(null, '#7fd3ff');
    for (const [name, rows] of Object.entries(MAP_SPRITES)) {
      for (const r of rows) {
        expect(r.length, name).toBe(rows[0]!.length);
        for (const ch of r) if (ch !== '.') { expect(team[ch], `${name} '${ch}'`).toBeDefined(); expect(neutral[ch], `${name} '${ch}'`).toBeDefined(); }
      }
      expect(rows[rows.length - 1], `${name} stands on its bottom row`).toMatch(/[^.]/);
    }
  });

  it('towers, bases and creeps take the team colour; neutral sprites use the glow colour', () => {
    expect(mapPalette('#e84a4a').c).toBe('#e84a4a');
    expect(mapPalette(null, '#c99bff').x).toBe('#c99bff');
    expect(MAP_SPRITES.tower.join('')).toContain('c');
    expect(MAP_SPRITES.creepA.join('')).toContain('c');
  });
});
