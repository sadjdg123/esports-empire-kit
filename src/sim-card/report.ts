// Card division: the after-match report, counted from the games.

import { cardProficiency } from './engine';
import type { CardConfig, CardMatchInput, CardMatchResult, CardReport, CardSide } from './types';

type Core = Pick<CardMatchResult, 'winner' | 'score' | 'series' | 'stats'>;

export function buildCardReport(cfg: CardConfig, input: CardMatchInput, r: Core): CardReport {
  const w = r.winner;
  const l: CardSide = w === 'BLUE' ? 'RED' : 'BLUE';
  const team = (s: CardSide) => (s === 'BLUE' ? input.blue : input.red);
  const name = (id: string) => r.stats.find((p) => p.id === id)?.name ?? id;
  const who = (s: CardSide, x: Core['series'][number]) => (s === 'BLUE' ? x.blue : x.red);
  const reasons: { weight: number; text: string }[] = [];
  const mine = r.stats.filter((p) => p.side === w && p.played);
  const theirs = r.stats.filter((p) => p.side === l && p.played);

  // Deck match-ups that went the winner's way.
  for (const x of r.series.filter((s) => s.winner === w)) {
    const edge = cfg.edge[x.decks[w]][x.decks[l]] ?? 1;
    const back = cfg.edge[x.decks[l]][x.decks[w]] ?? 1;
    if (edge > back || (x.decks[w] === 'CONTROL' && x.decks[l] === 'AGGRO') || (x.decks[w] === 'COMBO' && x.decks[l] === 'CONTROL') || (x.decks[w] === 'AGGRO' && x.decks[l] === 'COMBO')) {
      reasons.push({ weight: 3, text: `第 ${x.seat + 1} 台卡组克制：${name(who(w, x))} 的「${cfg.decks[x.decks[w]].name}」打对面的「${cfg.decks[x.decks[l]].name}」` });
    }
  }
  // Knowing the deck.
  for (const x of r.series.filter((s) => s.winner === w)) {
    const a = team(w).players.find((p) => p.id === who(w, x))!, b = team(l).players.find((p) => p.id === who(l, x))!;
    const gap = cardProficiency(a, a.deck) - cardProficiency(b, b.deck);
    if (gap >= 15) reasons.push({ weight: gap / 8, text: `${a.name} 的「${cfg.decks[a.deck].name}」熟练度 ${Math.round(cardProficiency(a, a.deck))}，对面只有 ${Math.round(cardProficiency(b, b.deck))}` });
  }
  const sum = (list: typeof mine, f: (p: (typeof mine)[number]) => number) => list.reduce((a, p) => a + f(p), 0);
  const reads = sum(mine, (p) => p.reads) - sum(theirs, (p) => p.reads);
  if (reads >= 2) reasons.push({ weight: reads, text: `读牌 ${sum(mine, (p) => p.reads)} 次比 ${sum(theirs, (p) => p.reads)} 次：关键回合猜中了对面的牌` });
  const slips = sum(theirs, (p) => p.misplays) - sum(mine, (p) => p.misplays);
  if (slips >= 2) reasons.push({ weight: slips, text: `对面失误 ${sum(theirs, (p) => p.misplays)} 次，我方只有 ${sum(mine, (p) => p.misplays)} 次` });
  const combos = sum(mine, (p) => p.combos);
  if (combos > 0) reasons.push({ weight: combos * 1.5, text: `组合技打成 ${combos} 次，一套带走` });
  // A comeback in a series.
  for (const x of r.series.filter((s) => s.winner === w)) {
    if (x.games.length === 3 && x.games[0]!.winner === l) reasons.push({ weight: 2, text: `${name(who(w, x))} 先丢一局后连扳两局` });
  }
  const top = [...mine].sort((a, b) => b.rating - a.rating)[0]!;
  reasons.push({ weight: 0.5, text: `${top.name} ${top.gamesWon} 胜 ${top.gamesLost} 负，全场最佳` });
  const mvp = [...r.stats].filter((p) => p.played).sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))[0]!;
  return {
    headline: `${team(w).name} ${r.score[w]}:${r.score[l]} ${r.score[l] > 0 ? '险胜' : '击败'}${team(l).name}`,
    keyReasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 3).map((x) => x.text),
    mvp: mvp.id,
  };
}
