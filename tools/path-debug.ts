// Prints the route and travel time from one node to another.
// Usage: npx tsx tools/path-debug.ts [FROM] [TO] [speed]
import { loadGameData } from '../src/core/config';
import { buildMap, edgeLength, nodeIndex, shortestPath } from '../src/sim/map';

const [fromId = 'B_BASE', toId = 'R_BASE', speedArg = '40'] = process.argv.slice(2);
const map = buildMap(loadGameData().match.map);
const speed = Number(speedArg);
const path = shortestPath(map, nodeIndex(map, fromId), nodeIndex(map, toId));
let total = 0;
console.log(`Route ${fromId} -> ${toId} at speed ${speed}/s`);
path.forEach((node, i) => {
  if (i > 0) total += edgeLength(map, path[i - 1]!, node);
  const n = map.nodes[node]!;
  console.log(`  ${String(i).padStart(2)}  ${n.id.padEnd(10)} (${n.x}, ${n.y})  dist ${total.toFixed(0).padStart(5)}  t=${(total / speed).toFixed(1)}s`);
});
console.log(`Total ${total.toFixed(0)} units, ${(total / speed).toFixed(1)} s`);
