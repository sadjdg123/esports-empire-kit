// Node graph map: all-pairs shortest paths and movement along edges.
// Positions are { from, to, progress } with node indices; progress is 0..1
// along the edge from -> to. A unit standing on a node has from === to.

import type { Lane, MapConfig, MapNode, Side } from '../core/types';

export interface Loc {
  from: number;
  to: number;
  progress: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface GameMap {
  nodes: MapNode[];
  n: number;
  index: Map<string, number>;
  xs: Float64Array;
  ys: Float64Array;
  adjacency: number[][];
  /** dist[a * n + b] = shortest graph distance. */
  dist: Float64Array;
  /** next[a * n + b] = first node after a on the shortest path to b (a itself when a === b). */
  next: Int32Array;
  lanes: Record<Lane, number[]>; // node indices from BLUE base to RED base
  bases: Record<Side, number>;
}

export function buildMap(cfg: MapConfig): GameMap {
  const n = cfg.nodes.length;
  const index = new Map<string, number>();
  cfg.nodes.forEach((node, i) => index.set(node.id, i));
  const idx = (id: string): number => {
    const i = index.get(id);
    if (i === undefined) throw new Error(`map: unknown node ${id}`);
    return i;
  };
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  cfg.nodes.forEach((node, i) => { xs[i] = node.x; ys[i] = node.y; });

  const adjacency: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of cfg.edges) {
    const ia = idx(a);
    const ib = idx(b);
    if (!adjacency[ia]!.includes(ib)) adjacency[ia]!.push(ib);
    if (!adjacency[ib]!.includes(ia)) adjacency[ib]!.push(ia);
  }
  for (const list of adjacency) list.sort((p, q) => p - q); // stable iteration order

  // Floyd-Warshall; the map is tiny (~25 nodes).
  const dist = new Float64Array(n * n).fill(Infinity);
  const next = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < n; i++) {
    dist[i * n + i] = 0;
    next[i * n + i] = i;
    for (const j of adjacency[i]!) {
      dist[i * n + j] = Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!);
      next[i * n + j] = j;
    }
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const dik = dist[i * n + k]!;
      if (dik === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const alt = dik + dist[k * n + j]!;
        if (alt < dist[i * n + j]! - 1e-9) {
          dist[i * n + j] = alt;
          next[i * n + j] = next[i * n + k]!;
        }
      }
    }
  }

  const lanes = {
    TOP: cfg.lanes.TOP.map(idx),
    MID: cfg.lanes.MID.map(idx),
    BOT: cfg.lanes.BOT.map(idx),
  };
  const baseOf = (side: Side): number => {
    const node = cfg.nodes.find((nd) => nd.type === 'BASE' && nd.side === side);
    if (!node) throw new Error(`map: missing ${side} base`);
    return idx(node.id);
  };
  return { nodes: cfg.nodes, n, index, xs, ys, adjacency, dist, next, lanes, bases: { BLUE: baseOf('BLUE'), RED: baseOf('RED') } };
}

export function nodeIndex(map: GameMap, id: string): number {
  const i = map.index.get(id);
  if (i === undefined) throw new Error(`map: unknown node ${id}`);
  return i;
}

export function edgeLength(map: GameMap, a: number, b: number): number {
  return Math.hypot(map.xs[a]! - map.xs[b]!, map.ys[a]! - map.ys[b]!);
}

export function nodeDistance(map: GameMap, a: number, b: number): number {
  return map.dist[a * map.n + b]!;
}

/** Node sequence of the shortest path from a to b, both ends included. */
export function shortestPath(map: GameMap, a: number, b: number): number[] {
  if (map.next[a * map.n + b] === -1) return [];
  const path = [a];
  let cur = a;
  while (cur !== b) {
    cur = map.next[cur * map.n + b]!;
    path.push(cur);
  }
  return path;
}

export function atNode(node: number): Loc {
  return { from: node, to: node, progress: 0 };
}

export function isAtNode(loc: Loc): boolean {
  return loc.from === loc.to;
}

export function coordOf(map: GameMap, loc: Loc): Point {
  const x0 = map.xs[loc.from]!;
  const y0 = map.ys[loc.from]!;
  if (loc.from === loc.to) return { x: x0, y: y0 };
  return { x: x0 + (map.xs[loc.to]! - x0) * loc.progress, y: y0 + (map.ys[loc.to]! - y0) * loc.progress };
}

export function euclid(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Euclidean distance between two units' interpolated positions. */
export function unitDistance(map: GameMap, a: Loc, b: Loc): number {
  return euclid(coordOf(map, a), coordOf(map, b));
}

interface Route {
  /** -1 when the target lies on the current edge and we can walk straight. */
  exit: number;
  entry: number;
  cost: number;
}

/** Ends of a location with the cost to reach each from that location. */
function ends(map: GameMap, loc: Loc): [number, number][] {
  if (loc.from === loc.to) return [[loc.from, 0]];
  const len = edgeLength(map, loc.from, loc.to);
  return [[loc.from, loc.progress * len], [loc.to, (1 - loc.progress) * len]];
}

function sameEdge(a: Loc, b: Loc): boolean {
  if (a.from === a.to || b.from === b.to) return false;
  return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
}

/** Parameter of b expressed along a's edge direction (a.from -> a.to). */
function paramOnEdgeOf(a: Loc, b: Loc): number {
  return b.from === a.from ? b.progress : 1 - b.progress;
}

function planRoute(map: GameMap, loc: Loc, target: Loc): Route {
  if (sameEdge(loc, target)) {
    const len = edgeLength(map, loc.from, loc.to);
    return { exit: -1, entry: -1, cost: Math.abs(paramOnEdgeOf(loc, target) - loc.progress) * len };
  }
  // A unit on a node that is an endpoint of the target edge walks straight in.
  let best: Route = { exit: -1, entry: -1, cost: Infinity };
  for (const [exit, exitCost] of ends(map, loc)) {
    for (const [entry, entryCost] of ends(map, target)) {
      const cost = exitCost + map.dist[exit * map.n + entry]! + entryCost;
      if (cost < best.cost - 1e-9) best = { exit, entry, cost };
    }
  }
  return best;
}

/** Shortest graph distance between two locations. */
export function graphDistance(map: GameMap, a: Loc, b: Loc): number {
  return planRoute(map, a, b).cost;
}

function normalise(loc: Loc): Loc {
  if (loc.from !== loc.to) {
    if (loc.progress >= 1 - 1e-9) return atNode(loc.to);
    if (loc.progress <= 1e-9) return atNode(loc.from);
  }
  return loc;
}

/**
 * Moves from `loc` toward `target` along the shortest route by at most `maxDist` units.
 * Returns the new location (inputs are not mutated).
 */
export function moveToward(map: GameMap, loc: Loc, target: Loc, maxDist: number): Loc {
  let cur = normalise(loc);
  let remaining = maxDist;
  const goal = normalise(target);
  for (let guard = 0; guard < 64 && remaining > 1e-9; guard++) {
    if (cur.from === goal.from && cur.to === goal.to && Math.abs(cur.progress - goal.progress) < 1e-9) return cur;
    if (isAtNode(goal) && isAtNode(cur) && cur.from === goal.from) return cur;
    const route = planRoute(map, cur, goal);
    if (route.cost === Infinity) return cur;
    if (route.exit === -1) {
      // Straight along the shared edge.
      const len = edgeLength(map, cur.from, cur.to);
      const want = paramOnEdgeOf(cur, goal);
      const delta = want - cur.progress;
      const step = Math.min(Math.abs(delta), remaining / len);
      return normalise({ from: cur.from, to: cur.to, progress: cur.progress + Math.sign(delta) * step });
    }
    if (!isAtNode(cur)) {
      // Walk to the chosen exit node of the current edge first.
      const len = edgeLength(map, cur.from, cur.to);
      const towardTo = route.exit === cur.to;
      const left = (towardTo ? 1 - cur.progress : cur.progress) * len;
      if (remaining < left) {
        const p = cur.progress + (towardTo ? 1 : -1) * (remaining / len);
        return { from: cur.from, to: cur.to, progress: p };
      }
      remaining -= left;
      cur = atNode(route.exit);
      continue;
    }
    // At a node: step onto the next edge toward the entry node, or into the target edge.
    const here = cur.from;
    const nextNode = here === route.entry
      ? (isAtNode(goal) ? here : (goal.from === here ? goal.to : goal.from))
      : map.next[here * map.n + route.entry]!;
    if (nextNode === here) return cur;
    const len = edgeLength(map, here, nextNode);
    let stopAt = 1;
    if (here === route.entry && !isAtNode(goal)) {
      stopAt = goal.from === here ? goal.progress : 1 - goal.progress;
    }
    const need = stopAt * len;
    if (remaining < need) return { from: here, to: nextNode, progress: remaining / len };
    remaining -= need;
    cur = normalise({ from: here, to: nextNode, progress: stopAt });
  }
  return cur;
}

/**
 * Moves along a fixed node path (e.g. a lane). `nextIdx` is the index in `path`
 * of the node the unit is heading to. Returns the new location and next index.
 */
export function moveAlongPath(map: GameMap, loc: Loc, path: readonly number[], nextIdx: number, maxDist: number): { loc: Loc; nextIdx: number } {
  let cur = normalise(loc);
  let idx = nextIdx;
  let remaining = maxDist;
  while (remaining > 1e-9 && idx < path.length) {
    const goal = path[idx]!;
    if (isAtNode(cur) && cur.from === goal) {
      idx++;
      continue;
    }
    const before = cur;
    cur = moveToward(map, cur, atNode(goal), remaining);
    const moved = graphDistance(map, before, cur);
    remaining -= moved;
    if (moved < 1e-9) break;
  }
  if (isAtNode(cur) && idx < path.length && cur.from === path[idx]) idx++;
  return { loc: cur, nextIdx: idx };
}
