// Balance checks of the shooter and card engines (P4, T42): the same kind of gates as G1-G9.
import { createRng } from '../../src/core/rng';
import { CARD_DECKS, cardConfig, runCardMatch, type CardDeck, type CardTeamInput } from '../../src/sim-card';
import { FPS_ROLES, FPS_TACTICS, fpsConfig, runFpsMatch, type FpsTactic, type FpsTeamInput } from '../../src/sim-fps';

export interface Check { id: string; what: string; result: string; standard: string; pass: boolean }
export interface BranchChecks { checks: Check[]; fpsTactics: string[][]; cardDecks: string[][] }

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function fpsTeam(id: string, level: number, tactic: FpsTactic, seed: number, offRole = false): FpsTeamInput {
  const r = createRng(seed);
  const v = () => level + r.int(-6, 6);
  return { id, name: id, tactic, players: FPS_ROLES.map((role, i) => ({ id: `${id}${i}`, name: `${id}${i}`, role: offRole ? FPS_ROLES[(i + 1) % 5]! : role, primaryRole: role, attrs: { aim: v(), reaction: v(), positioning: v(), teamwork: v(), mental: v() } })) };
}
function cardTeam(id: string, level: number, deck: CardDeck | 'MIX', seed: number, proficiency = 65): CardTeamInput {
  const r = createRng(seed);
  const v = () => level + r.int(-6, 6);
  return { id, name: id, players: [0, 1, 2].map((i) => { const d = deck === 'MIX' ? CARD_DECKS[(seed + i) % 4]! : deck; return { id: `${id}${i}`, name: `${id}${i}`, deck: d, decks: { [d]: proficiency }, attrs: { calc: v(), read: v(), macro: v(), mental: v() } }; }) };
}

export function runBranchChecks(n: number): BranchChecks {
  const fps = (make: (i: number) => [FpsTeamInput, FpsTeamInput]) => { let w = 0; for (let i = 0; i < n; i++) { const [a, b] = make(i); const swap = i % 2 === 1; if ((runFpsMatch({ seed: 7000 + i, blue: swap ? b : a, red: swap ? a : b }, fpsConfig).winner === 'BLUE') !== swap) w++; } return w / n; };
  const card = (make: (i: number) => [CardTeamInput, CardTeamInput]) => { let w = 0; for (let i = 0; i < n; i++) { const [a, b] = make(i); const swap = i % 2 === 1; if ((runCardMatch({ seed: 7000 + i, blue: swap ? b : a, red: swap ? a : b }, cardConfig).winner === 'BLUE') !== swap) w++; } return w / n; };
  const checks: Check[] = [];
  const add = (id: string, what: string, result: string, standard: string, pass: boolean) => checks.push({ id, what, result, standard, pass });

  // Shooter
  let same = 0, blue = 0, rounds = 0;
  for (let i = 0; i < n; i++) {
    const input = { seed: i, blue: fpsTeam('a', 60, 'DEFAULT', i), red: fpsTeam('b', 60, 'DEFAULT', i) };
    const r = runFpsMatch(input, fpsConfig);
    if (i < 50 && runFpsMatch(input, fpsConfig).checksum === r.checksum) same++;
    if (r.winner === 'BLUE') blue++;
    rounds += r.rounds.length;
  }
  add('F1', '射击：同种子重跑', `${same}/50 场完全一致`, '全部一致', same === 50);
  add('F2', '射击：两队完全一样，先攻方胜率', pct(blue / n), '45%–55%', blue / n >= 0.45 && blue / n <= 0.55);
  const f3 = fps((i) => [fpsTeam('a', 67, 'DEFAULT', i), fpsTeam('b', 52, 'DEFAULT', i + 9)]);
  add('F3', '射击：平均能力高 15 分', pct(f3), '65%–88%', f3 >= 0.65 && f3 <= 0.88);
  const f4 = fps((i) => [fpsTeam('a', 60, 'DEFAULT', i, true), fpsTeam('b', 60, 'DEFAULT', i + 9)]);
  add('F4', '射击：五人全打错位置', `${pct(f4)}，下降 ${((0.5 - f4) * 100).toFixed(1)} 个百分点`, '下降 ≥8 个百分点', 0.5 - f4 >= 0.08);
  const fm: Record<string, number> = {};
  for (const a of FPS_TACTICS) for (const b of FPS_TACTICS) if (a < b) { const r = fps((i) => [fpsTeam('a', 60, a, i), fpsTeam('b', 60, b, i + 9)]); fm[`${a}>${b}`] = r; fm[`${b}>${a}`] = 1 - r; }
  const fRows = FPS_TACTICS.map((a) => FPS_TACTICS.filter((b) => b !== a).map((b) => fm[`${a}>${b}`]!));
  const fBest = Math.max(...fRows.flat());
  add('F5', '射击：四种打法互相对阵', `没有万能打法；最强克制 ${pct(fBest)}`, '无打法对其余三种都 >55%；至少一组 ≥56%', fRows.every((row) => !row.every((x) => x > 0.55)) && fBest >= 0.56);
  add('F6', '射击：一场多少回合', `平均 ${(rounds / n).toFixed(1)}`, '8–12.5', rounds / n >= 8 && rounds / n <= 12.5);

  // Cards
  let cSame = 0, cBlue = 0, games = 0, turns = 0, first = 0;
  for (let i = 0; i < n; i++) {
    const d = CARD_DECKS[i % 4]!;
    const input = { seed: i, blue: cardTeam('a', 60, d, i), red: cardTeam('b', 60, d, i) };
    const r = runCardMatch(input, cardConfig);
    if (i < 50 && runCardMatch(input, cardConfig).checksum === r.checksum) cSame++;
    if (r.winner === 'BLUE') cBlue++;
    for (const s of r.series) for (const g of s.games) { games++; turns += Math.ceil(g.turns.length / 2); if (g.winner === g.first) first++; }
  }
  add('C1', '卡牌：同种子重跑', `${cSame}/50 场完全一致`, '全部一致', cSame === 50);
  add('C2', '卡牌：两队完全一样，蓝方胜率', pct(cBlue / n), '45%–55%', cBlue / n >= 0.45 && cBlue / n <= 0.55);
  add('C3', '卡牌：先手的人单局胜率', pct(first / games), '45%–55%', first / games >= 0.45 && first / games <= 0.55);
  const c4 = card((i) => [cardTeam('a', 67, 'MIX', i), cardTeam('b', 52, 'MIX', i)]);
  add('C4', '卡牌：平均能力高 15 分', pct(c4), '65%–88%', c4 >= 0.65 && c4 <= 0.88);
  const c5 = card((i) => [cardTeam('a', 60, 'MIX', i, 90), cardTeam('b', 60, 'MIX', i, 40)]);
  add('C5', '卡牌：卡组熟练度 90 对 40', pct(c5), '≥58%，<92%', c5 >= 0.58 && c5 < 0.92);
  // Deck match-ups at the level of one seat (one series), which is what a player chooses.
  const seat: Record<string, number> = {};
  for (const a of CARD_DECKS) for (const b of CARD_DECKS) if (a < b) {
    let w = 0, total = 0;
    for (let i = 0; i < n; i++) for (const s of runCardMatch({ seed: 8000 + i, blue: cardTeam('a', 60, a, i), red: cardTeam('b', 60, b, i + 9) }, cardConfig).series) { total++; if (s.winner === 'BLUE') w++; }
    seat[`${a}>${b}`] = w / total; seat[`${b}>${a}`] = 1 - w / total;
  }
  const cRows = CARD_DECKS.map((a) => CARD_DECKS.filter((b) => b !== a).map((b) => seat[`${a}>${b}`]!));
  const cBest = Math.max(...cRows.flat());
  const circle = seat['AGGRO>COMBO']! > 0.53 && seat['COMBO>CONTROL']! > 0.53 && seat['CONTROL>AGGRO']! > 0.53;
  add('C6', '卡牌：四种卡组一台对一台', `克制成圈；最强克制 ${pct(cBest)}`, '快攻›组合技›控制›快攻 都 >53%；没有卡组对其余三种都 >55%；最强克制 ≤75%', circle && cRows.every((row) => !row.every((x) => x > 0.55)) && cBest <= 0.75);
  add('C7', '卡牌：一局多少回合', `平均 ${(turns / games).toFixed(1)}`, '6–10', turns / games >= 6 && turns / games <= 10);

  const table = <T extends string>(names: readonly T[], label: (t: T) => string, m: Record<string, number>) => [['', ...names.map(label)], ...names.map((a) => [`**${label(a)}**`, ...names.map((b) => (a === b ? '—' : pct(m[`${a}>${b}`]!)))])];
  return { checks, fpsTactics: table(FPS_TACTICS, (t) => fpsConfig.tactics[t].name, fm), cardDecks: table(CARD_DECKS, (d) => cardConfig.decks[d].name, seat) };
}
