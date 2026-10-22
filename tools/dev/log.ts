// Dev helper: readable event log of a club match. Usage: npx tsx tools/dev/log.ts blueClub redClub [seed] [limit]
import { loadGameData } from '../../src/core/config';
import type { Tactic } from '../../src/core/types';
import { runMatch } from '../../src/sim';
import { describeEvent, nameBook } from '../../src/sim/events';
import { clubTeam } from '../../src/sim/scenario';

const [blueId = 'jinyu', redId = 'huiyan', seedArg = '42', limitArg = '50'] = process.argv.slice(2);
const data = loadGameData();
const style = (id: string): Tactic => {
  const s = data.clubs.find((c) => c.id === id)!.style;
  return s === 'RANDOM' ? 'STEADY_MACRO' : s;
};
const input = { seed: Number(seedArg), blue: clubTeam(data, blueId, style(blueId)), red: clubTeam(data, redId, style(redId)) };
const r = runMatch(input, data);
const book = nameBook(input, data.heroes);
r.events.slice(0, Number(limitArg)).forEach((e) => console.log(describeEvent(e, book)));
console.log(`... 共 ${r.events.length} 条事件，${r.winner} 获胜，${(r.durationSec / 60).toFixed(1)} 分钟`);
