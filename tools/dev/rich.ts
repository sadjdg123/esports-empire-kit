import { loadGameData } from '../../src/core/config';
import { ROLES } from '../../src/core/types';
import { PLAYER_CLUB_ID, advanceWeek, marketPlayers, newGame, playerOverall, recommendLineup, setLineup, signPlayer, standings } from '../../src/game';
const data = loadGameData();
let sumRatio = 0, sumWins = 0, sumRank = 0; const n = 10;
for (let seed = 0; seed < n; seed++) {
  const s = newGame('x', '#000000', 500 + seed, data);
  for (const role of ROLES) {
    const best = marketPlayers(s).filter((p) => p.primaryRole === role).sort((a, b) => playerOverall(b) - playerOverall(a))[0]!;
    signPlayer(s, data, best.id);
  }
  const l = recommendLineup(s, data); if (l.ok) setLineup(s, data, l.value);
  let wins = 0;
  for (let w = 0; w < 10; w++) { const r = advanceWeek(s, data); if (r.ok && r.value.playerResult?.winner === PLAYER_CLUB_ID) wins++; }
  sumRatio += s.funds / s.startingFunds; sumWins += wins; sumRank += standings(s).findIndex((x) => x.clubId === PLAYER_CLUB_ID) + 1;
}
console.log(`best-per-role squad: funds ratio ${(sumRatio / n).toFixed(2)}, wins ${(sumWins / n).toFixed(1)}, rank ${(sumRank / n).toFixed(1)}`);
