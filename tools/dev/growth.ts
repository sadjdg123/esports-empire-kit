// Dev: growth and fatigue numbers over one season.
import { loadGameData } from '../../src/core/config';
import type { TrainingFocus } from '../../src/core/types';
import { advanceDay, commitMatchDay, newGame, playerOverall, signValueSquad, type GameState } from '../../src/game';
import { runMatch } from '../../src/sim';
import { clubTeam, cloneTeam } from '../../src/sim/scenario';

const data = loadGameData();
function season(focusFor: (week: number) => TrainingFocus, seed: number) {
  const s: GameState = newGame('t', '#fff', seed, data);
  signValueSquad(s, data);
  const before = Object.fromEntries(Object.values(s.players).map((p) => [p.id, { ovr: playerOverall(p), age: p.age, pot: p.potential! }]));
  const fat: number[] = [];
  for (let g = 0; g < 500 && s.calendar.phase !== 'FINISHED'; g++) {
    s.training = focusFor(Math.floor(s.calendar.day / 7));
    const r = advanceDay(s, data);
    if (r.pause === 'MATCH_DAY') {
      fat.push(Math.round(s.club.roster.reduce((a, id) => a + s.players[id]!.fatigue!, 0) / s.club.roster.length));
      commitMatchDay(s, data);
    }
  }
  const rostered = new Set([s.club, ...s.aiClubs].flatMap((c) => c.roster));
  const delta = Object.values(s.players).filter((p) => rostered.has(p.id)).map((p) => ({ age: before[p.id]!.age, pot: before[p.id]!.pot, ovr: before[p.id]!.ovr, d: playerOverall(p) - before[p.id]!.ovr }));
  return { fat, delta, wins: s.history[0] };
}
const a = season(() => 'MECHANICS', 3);
console.log('never rest fatigue at match days', a.fat.join(' '));
const b = season((w) => (w % 3 === 2 ? 'REST' : 'MECHANICS'), 3);
console.log('rest every 3rd week', b.fat.join(' '));
const groups: Record<string, number[]> = {};
for (const x of a.delta) { const k = x.age <= 20 ? '<=20' : x.age <= 24 ? '21-24' : x.age <= 27 ? '25-27' : '28+'; (groups[k] ??= []).push(x.d); }
for (const [k, v] of Object.entries(groups)) console.log(k, v.length, (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), Math.min(...v).toFixed(1), Math.max(...v).toFixed(1));
for (const f of [0, 60, 70, 80, 90, 100]) {
  let w = 0; const N = 400;
  for (let i = 0; i < N; i++) {
    const t = clubTeam(data, data.clubs[2]!.id, 'STEADY_MACRO');
    const tired = cloneTeam(t, "t"); for (const p of tired.players) p.fatigue = f;
    const side = i % 2 === 0;
    const r = runMatch({ seed: 1000 + i, blue: side ? tired : t, red: side ? t : tired }, data);
    if ((r.winner === 'BLUE') === side) w++;
  }
  console.log('fatigue', f, 'win rate vs fresh', (w / N * 100).toFixed(1));
}
