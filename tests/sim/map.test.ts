import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { LANES } from '../../src/core/types';
import {
  atNode, buildMap, coordOf, edgeLength, graphDistance, moveToward, nodeIndex, shortestPath, unitDistance, type Loc,
} from '../../src/sim/map';
import { lanePathFor, moveWave, spawnWave } from '../../src/sim/units';

const data = loadGameData();
const map = buildMap(data.match.map);

describe('map graph', () => {
  it('is connected: every pair of nodes has a path', () => {
    for (let a = 0; a < map.n; a++) {
      for (let b = 0; b < map.n; b++) {
        expect(Number.isFinite(map.dist[a * map.n + b]!)).toBe(true);
        const path = shortestPath(map, a, b);
        expect(path[0]).toBe(a);
        expect(path[path.length - 1]).toBe(b);
      }
    }
  });

  it('shortest path lengths match the distance table', () => {
    const a = map.bases.BLUE;
    const b = map.bases.RED;
    const path = shortestPath(map, a, b);
    let len = 0;
    for (let i = 1; i < path.length; i++) len += edgeLength(map, path[i - 1]!, path[i]!);
    expect(len).toBeCloseTo(map.dist[a * map.n + b]!, 6);
  });

  it('is mirror-symmetric across the river line y = x', () => {
    for (const node of map.nodes) {
      const twin = map.nodes.find((o) => o.x === node.y && o.y === node.x);
      expect(twin, `mirror of ${node.id}`).toBeDefined();
    }
    const bb = map.bases.BLUE;
    const rb = map.bases.RED;
    for (const lane of LANES) {
      const t1b = nodeIndex(map, `B_${lane}_T1`);
      const t1r = nodeIndex(map, `R_${lane}_T1`);
      expect(map.dist[bb * map.n + t1b]).toBeCloseTo(map.dist[rb * map.n + t1r]!, 6);
    }
  });

  it('lanes run from blue base to red base through two towers per side', () => {
    for (const lane of LANES) {
      const ids = map.lanes[lane].map((i) => map.nodes[i]!.id);
      expect(ids[0]).toBe('B_BASE');
      expect(ids[ids.length - 1]).toBe('R_BASE');
      expect(ids.filter((id) => map.nodes[map.index.get(id)!]!.type === 'TOWER')).toHaveLength(4);
    }
  });
});

describe('movement', () => {
  it('moves along the shortest path at the given speed and arrives exactly', () => {
    const from = map.bases.BLUE;
    const to = map.bases.RED;
    const total = map.dist[from * map.n + to]!;
    let loc: Loc = atNode(from);
    let secs = 0;
    while (!(loc.from === to && loc.to === to) && secs < 1000) {
      loc = moveToward(map, loc, atNode(to), 40);
      secs++;
    }
    expect(secs).toBe(Math.ceil(total / 40));
    expect(coordOf(map, loc)).toEqual({ x: map.xs[to], y: map.ys[to] });
  });

  it('each step covers the requested distance (until arrival)', () => {
    let loc: Loc = atNode(map.bases.BLUE);
    const target = atNode(nodeIndex(map, 'R_JG_BOT'));
    for (let i = 0; i < 10; i++) {
      const before = graphDistance(map, loc, target);
      loc = moveToward(map, loc, target, 25);
      expect(before - graphDistance(map, loc, target)).toBeCloseTo(Math.min(25, before), 6);
    }
  });

  it('can chase a target that sits in the middle of an edge', () => {
    const a = nodeIndex(map, 'B_MID_T1');
    const b = nodeIndex(map, 'MID_MID');
    const target: Loc = { from: a, to: b, progress: 0.5 };
    let loc: Loc = atNode(map.bases.RED);
    for (let i = 0; i < 200; i++) loc = moveToward(map, loc, target, 30);
    expect(unitDistance(map, loc, target)).toBeLessThan(1e-6);
    // and walk back and forth on the same edge
    const back: Loc = { from: b, to: a, progress: 0.9 };
    loc = moveToward(map, loc, back, 1000);
    expect(unitDistance(map, loc, back)).toBeLessThan(1e-6);
  });

  it('is deterministic for the same input', () => {
    const run = () => {
      let loc: Loc = atNode(map.bases.BLUE);
      const out: string[] = [];
      for (let i = 0; i < 60; i++) {
        loc = moveToward(map, loc, atNode(nodeIndex(map, 'RIV_TOP')), 17.3);
        out.push(`${loc.from}-${loc.to}-${loc.progress.toFixed(9)}`);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('creep waves', () => {
  const cfg = data.match.creeps;
  const stats = { hp: cfg.hp, attack: cfg.attack, structureAttack: cfg.structureAttack };

  for (const lane of LANES) {
    it(`${lane} wave passes the lane midpoint on schedule (both sides)`, () => {
      for (const side of ['BLUE', 'RED'] as const) {
        const path = lanePathFor(map, lane, side);
        const midIdx = 3;
        let expected = 0;
        for (let i = 1; i <= midIdx; i++) expected += edgeLength(map, path[i - 1]!, path[i]!);
        const wave = spawnWave(map, 'w', side, lane, stats);
        let secs = 0;
        while (wave.nextIdx <= midIdx && secs < 500) {
          moveWave(map, wave, cfg.moveSpeed);
          secs++;
        }
        expect(secs).toBe(Math.ceil(expected / cfg.moveSpeed - 1e-9));
      }
    });
  }

  it('follows its lane, never cutting through the jungle', () => {
    const wave = spawnWave(map, 'w', 'BLUE', 'TOP', stats);
    const allowed = new Set(map.lanes.TOP);
    for (let i = 0; i < 200; i++) {
      moveWave(map, wave, cfg.moveSpeed);
      expect(allowed.has(wave.loc.from) && allowed.has(wave.loc.to)).toBe(true);
    }
    expect(wave.loc.from).toBe(map.bases.RED);
  });
});
