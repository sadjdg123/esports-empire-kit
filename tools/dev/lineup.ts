import { loadGameData } from '../../src/core/config';
import { clubTeam } from '../../src/sim/scenario';
const data = loadGameData();
for (const id of process.argv.slice(2)) {
  const t = clubTeam(data, id, 'STEADY_MACRO');
  console.log(id);
  for (const pk of t.lineup.picks) {
    const p = t.players.find((x) => x.id === pk.playerId)!;
    const a = p.attrs;
    console.log(`  ${pk.role.padEnd(7)} ${p.name.padEnd(10)} prim=${p.primaryRole} ovr=${((a.mechanics + a.awareness + a.teamwork + a.mental) / 4).toFixed(0)} hero=${pk.heroId} mastery=${p.heroMastery[pk.heroId] ?? 20}`);
  }
}
