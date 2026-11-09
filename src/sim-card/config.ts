// Loads card.json with a simple check: every number finite, every deck complete.
import raw from '../data/card.json';
import { CARD_ATTRS, CARD_DECKS, type CardConfig } from './types';

export function checkCardConfig(c: CardConfig): string[] {
  const issues: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) issues.push(`${path}: not a number`); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(c, 'card.json');
  for (const d of CARD_DECKS) {
    const deck = c.decks?.[d];
    if (!deck) { issues.push(`card.json: deck ${d} missing`); continue; }
    for (const k of ['pressure', 'guard', 'heal'] as const) if (!Array.isArray(deck[k]) || deck[k].length < c.maxTurns) issues.push(`card.json.decks.${d}.${k}: needs ${c.maxTurns} turns`);
    if (!c.edge?.[d]) issues.push(`card.json.edge.${d}: missing`);
    if (typeof c.combo?.disrupt?.[d] !== 'number') issues.push(`card.json.combo.disrupt.${d}: missing`);
  }
  for (const a of CARD_ATTRS) if (typeof c.skill?.weights?.[a] !== 'number' || !c.attrs?.[a]) issues.push(`card.json: attribute ${a} missing`);
  if (!(c.teamSize >= c.seriesToWin * 2 - 1)) issues.push('card.json: teamSize too small for seriesToWin');
  return issues;
}

export const cardConfig = raw as unknown as CardConfig;
const problems = checkCardConfig(cardConfig);
if (problems.length > 0) throw new Error(`card.json:\n  - ${problems.join('\n  - ')}`);
