// Group divisions (P4, T35/T38): opening a shooter or card division and running it: players,
// contracts, lineup, training, a league against five AI teams, and money into the group's one
// purse. Each division draws from its own random streams (seed, season, division), so nothing
// here shifts the MOBA league's results.

import { createRng, hashString, type Rng } from '../core/rng';
import type { GameData } from '../core/types';
import { CARD_ATTRS, CARD_DECKS, type CardDeck, type CardPlayerInput, type CardTeamInput } from '../sim-card/types';
import { cardOverall, cardProficiency, cardStrength, runCardMatch } from '../sim-card/engine';
import { FPS_ATTRS, FPS_ROLES, FPS_TACTICS, type FpsPlayerInput, type FpsRole, type FpsTactic, type FpsTeamInput } from '../sim-fps/types';
import { fpsOverall, fpsRating, runFpsMatch } from '../sim-fps/engine';
import {
  BRANCH_KINDS, type BranchKind, type BranchKindConfig, type BranchLineup, type BranchPlayer, type BranchReplay, type BranchState, type BranchTeam,
} from './branch-types';
import { addLedger, buildSchedule, weekOfSeason, type Result } from './game';
import { postMessage } from './messages';
import { PLAYER_CLUB_ID, type GameState } from './state';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export const kindCfg = (data: GameData, kind: BranchKind): BranchKindConfig => data.branches.kinds[kind];
export const branchOf = (state: GameState, kind: BranchKind): BranchState | undefined => state.branches[kind];
/** Divisions that exist, in a fixed order. */
export const openBranches = (state: GameState): BranchState[] => BRANCH_KINDS.map((k) => state.branches[k]).filter((b): b is BranchState => !!b);
/** A division that takes part in this season's league. */
export const branchActive = (state: GameState, b: BranchState): boolean => b.startSeason <= state.calendar.season;

function stream(state: GameState, kind: BranchKind, label: string, season = state.calendar.season): Rng {
  return createRng(hashString(`branch:${kind}:${state.seed}:${season}:${label}`));
}

// ---------------------------------------------------------------------------
// Players

export function branchOverall(data: GameData, kind: BranchKind, p: BranchPlayer): number {
  return kind === 'FPS' ? fpsOverall(data.fps, p.attrs as FpsPlayerInput['attrs']) : cardOverall(data.card, p.attrs as CardPlayerInput['attrs']);
}

function salaryFor(cfg: BranchKindConfig, overall: number): number {
  return roundTo(cfg.salary.base + Math.max(0, overall - cfg.salary.from) * cfg.salary.perPoint, 50);
}

function makePlayer(data: GameData, kind: BranchKind, rng: Rng, id: string, name: string, level: number, role?: FpsRole): BranchPlayer {
  const cfg = kindCfg(data, kind);
  const attrNames: readonly string[] = kind === 'FPS' ? FPS_ATTRS : CARD_ATTRS;
  const attrs: Record<string, number> = {};
  for (const a of attrNames) attrs[a] = clamp(Math.round(level + rng.int(-8, 8)), 20, 95);
  const age = rng.int(cfg.age.min, cfg.age.max);
  const p: BranchPlayer = { id, name, age, attrs, potential: 0, salaryPerWeek: 0, signingFee: 0, teamId: null, form: 0, played: 0, wins: 0 };
  if (kind === 'FPS') {
    p.primaryRole = role ?? rng.pick(FPS_ROLES);
    if (rng.chance(0.5)) p.secondaryRole = rng.pick(FPS_ROLES.filter((r) => r !== p.primaryRole));
  } else {
    const order = [...CARD_DECKS].sort(() => rng.next() - 0.5);
    p.decks = { [order[0]!]: rng.int(60, 90), [order[1]!]: rng.int(45, 75), [order[2]!]: rng.int(25, 55), [order[3]!]: rng.int(20, 45) };
  }
  const ovr = branchOverall(data, kind, p);
  p.potential = clamp(Math.round(ovr + (age <= cfg.age.peak ? rng.int(2, 18) : rng.int(0, 4))), 0, 99);
  p.salaryPerWeek = salaryFor(cfg, ovr);
  p.signingFee = p.salaryPerWeek * cfg.signingFeeWeeks;
  return p;
}

function freshName(b: BranchState, cfg: BranchKindConfig, rng: Rng): string {
  const taken = new Set(Object.values(b.players).map((p) => p.name));
  const free = cfg.namePool.filter((n) => !taken.has(n));
  if (free.length > 0) return rng.pick(free);
  const base = rng.pick(cfg.namePool);
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function addPlayer(data: GameData, b: BranchState, rng: Rng, level: number, role?: FpsRole): BranchPlayer {
  const cfg = kindCfg(data, b.kind);
  const p = makePlayer(data, b.kind, rng, `${b.kind.toLowerCase()}_${b.nextId++}`, freshName(b, cfg, rng), level, role);
  b.players[p.id] = p;
  return p;
}

/** Fills an AI team with a fresh squad around its level. */
function staffTeam(data: GameData, b: BranchState, team: BranchTeam, rng: Rng): void {
  for (const id of team.roster) delete b.players[id];
  team.roster = [];
  const cfg = kindCfg(data, b.kind);
  for (let i = 0; i < cfg.squad; i++) {
    const p = addPlayer(data, b, rng, team.level + rng.int(-data.branches.aiLevel.spread, data.branches.aiLevel.spread), b.kind === 'FPS' ? FPS_ROLES[i] : undefined);
    p.teamId = team.id;
    team.roster.push(p.id);
  }
}

/** Replaces the free agents with a new batch (every role covered for the shooter). */
function refreshMarket(data: GameData, b: BranchState, rng: Rng): void {
  for (const id of b.market) delete b.players[id];
  b.market = [];
  const cfg = kindCfg(data, b.kind);
  const lv = data.branches.marketLevel;
  for (let i = 0; i < cfg.marketSize; i++) {
    const p = addPlayer(data, b, rng, rng.int(lv.min, lv.max), b.kind === 'FPS' ? FPS_ROLES[i % FPS_ROLES.length] : undefined);
    b.market.push(p.id);
  }
}

export const branchRoster = (b: BranchState): BranchPlayer[] => b.roster.map((id) => b.players[id]!).filter(Boolean);
export const branchMarket = (b: BranchState): BranchPlayer[] => b.market.map((id) => b.players[id]!).filter(Boolean);
export const branchSalaries = (b: BranchState): number => branchRoster(b).reduce((a, p) => a + p.salaryPerWeek, 0);

// ---------------------------------------------------------------------------
// Opening a division

export function canOpenBranch(state: GameState, data: GameData, kind: BranchKind): Result<undefined> {
  const cfg = kindCfg(data, kind);
  if (state.branches[kind]) return fail(`${cfg.name}已经开了`);
  if (state.club.reputation < cfg.open.reputation) return fail(`声望不够：需要 ${cfg.open.reputation}，现在 ${Math.round(state.club.reputation)}`);
  if (state.funds < cfg.open.cost) return fail(`资金不够：开办费 ${cfg.open.cost}，现在 ${Math.floor(state.funds)}`);
  return ok(undefined);
}

/** Opens a division. Opened in the pre-season it plays this season; later, from the next one. */
export function openBranch(state: GameState, data: GameData, kind: BranchKind): Result<BranchState> {
  const can = canOpenBranch(state, data, kind);
  if (!can.ok) return can;
  const cfg = kindCfg(data, kind);
  const season = state.calendar.season;
  const now = state.calendar.phase === 'PRESEASON';
  const b: BranchState = {
    kind, openedSeason: season, startSeason: now ? season : season + 1, players: {}, market: [], roster: [],
    teams: cfg.teams.map((t) => ({ ...t, roster: [] })), lineup: null, training: kind === 'FPS' ? 'aim' : 'calc',
    schedule: [], round: 0, results: [], finalDone: false, reports: [], replay: null, history: [], titles: 0,
    director: null, managed: false, candidates: [], log: [], nextId: 1,
  };
  const rng = stream(state, kind, 'open');
  for (const t of b.teams) staffTeam(data, b, t, rng);
  refreshMarket(data, b, rng);
  state.branches[kind] = b;
  refreshDirectorCandidates(state, data, b);
  if (now) startBranchSeason(state, data, b);
  addLedger(state, { week: weekOfSeason(state), kind: 'BRANCH', amount: -cfg.open.cost, note: `开办${cfg.name}`, branch: kind });
  postMessage(state, 'INFO', `${cfg.name}成立`, now ? `本赛季就参加「${cfg.game}」联赛。先去签 ${cfg.squad} 名选手、排好阵容。` : `下个赛季开始参加「${cfg.game}」联赛。现在可以先签人。`);
  return ok(b);
}

function startBranchSeason(state: GameState, _data: GameData, b: BranchState): void {
  const season = state.calendar.season;
  const ids = [PLAYER_CLUB_ID, ...b.teams.map((t) => t.id)];
  b.schedule = buildSchedule(ids, hashString(`branch:${b.kind}:${state.seed}`), stream(state, b.kind, 'schedule'), season + 1000);
  b.round = 0;
  b.results = [];
  b.finalDone = false;
}

// ---------------------------------------------------------------------------
// Contracts

export function signBranchPlayer(state: GameState, data: GameData, kind: BranchKind, playerId: string): Result<BranchPlayer> {
  const b = branchOf(state, kind);
  const p = b?.players[playerId];
  if (!b || !p || !b.market.includes(playerId)) return fail('这名选手不在自由市场');
  const cfg = kindCfg(data, kind);
  if (b.roster.length >= cfg.rosterMax) return fail(`队伍已满（最多 ${cfg.rosterMax} 人）`);
  // Short of a full squad the cheapest players can always be signed, so the division can play.
  const cheap = branchMarket(b).map((x) => x.salaryPerWeek).sort((x, y) => x - y)[Math.min(2, b.market.length - 1)] ?? 0;
  const emergency = b.roster.length < cfg.squad && p.salaryPerWeek <= cheap;
  if (!emergency && state.funds < p.signingFee) return fail(`资金不足：签约费 ${p.signingFee}，现在 ${Math.floor(state.funds)}`);
  b.market = b.market.filter((id) => id !== playerId);
  b.roster.push(playerId);
  p.teamId = PLAYER_CLUB_ID;
  p.contractUntil = Math.max(state.calendar.season, b.startSeason) + cfg.contractYears - 1;
  addLedger(state, { week: weekOfSeason(state), kind: 'SIGNING', amount: -p.signingFee, note: `${cfg.name}签下 ${p.name}`, branch: kind });
  return ok(p);
}

export function branchReleaseFee(p: BranchPlayer): number {
  return p.salaryPerWeek * 2;
}

/** Lets a player go for two weeks of salary; he returns to the free agents. */
export function releaseBranchPlayer(state: GameState, data: GameData, kind: BranchKind, playerId: string): Result<number> {
  const b = branchOf(state, kind);
  const p = b?.players[playerId];
  if (!b || !p || !b.roster.includes(playerId)) return fail('他不在队里');
  const fee = branchReleaseFee(p);
  if (state.funds < fee) return fail(`资金不足：解约金 ${fee}`);
  addLedger(state, { week: weekOfSeason(state), kind: 'RELEASE', amount: -fee, note: `${kindCfg(data, kind).name}与 ${p.name} 解约`, branch: kind });
  b.roster = b.roster.filter((id) => id !== playerId);
  b.market.push(playerId);
  p.teamId = null;
  delete p.contractUntil;
  if (b.lineup) b.lineup = null;
  return ok(fee);
}

/** What a player asks for to stay: the going rate for his ability now, never less than he earns. */
export function branchRenewalAsk(data: GameData, kind: BranchKind, p: BranchPlayer): number {
  return Math.max(p.salaryPerWeek, salaryFor(kindCfg(data, kind), branchOverall(data, kind, p)));
}

export function renewBranchPlayer(state: GameState, data: GameData, kind: BranchKind, playerId: string): Result<number> {
  const b = branchOf(state, kind);
  const p = b?.players[playerId];
  if (!b || !p || !b.roster.includes(playerId)) return fail('他不在队里');
  if ((p.contractUntil ?? 0) > state.calendar.season) return fail('合同最后一个赛季才能续约');
  const cfg = kindCfg(data, kind);
  p.salaryPerWeek = branchRenewalAsk(data, kind, p);
  p.signingFee = p.salaryPerWeek * cfg.signingFeeWeeks;
  p.contractUntil = state.calendar.season + cfg.contractYears;
  return ok(p.contractUntil);
}

export const branchExpiring = (state: GameState, b: BranchState): BranchPlayer[] => branchRoster(b).filter((p) => (p.contractUntil ?? 0) <= state.calendar.season);

// ---------------------------------------------------------------------------
// Lineup

function fpsInput(p: BranchPlayer, role: FpsRole): FpsPlayerInput {
  return { id: p.id, name: p.name, role, primaryRole: p.primaryRole ?? role, ...(p.secondaryRole ? { secondaryRole: p.secondaryRole } : {}), attrs: p.attrs as FpsPlayerInput['attrs'], form: p.form };
}
function cardInput(p: BranchPlayer, deck: CardDeck): CardPlayerInput {
  return { id: p.id, name: p.name, deck, decks: p.decks ?? {}, attrs: p.attrs as CardPlayerInput['attrs'], form: p.form };
}

/** The best deck of a card player: the one he is strongest with. */
export function bestDeck(_data: GameData, p: BranchPlayer): CardDeck {
  return [...CARD_DECKS].sort((a, b) => cardProficiency({ decks: p.decks ?? {} }, b) - cardProficiency({ decks: p.decks ?? {} }, a) || a.localeCompare(b))[0]!;
}

/** The strongest lineup from a squad: best role for each of five shooters, or the three best card players with their best decks. */
export function recommendBranchLineup(data: GameData, kind: BranchKind, squad: readonly BranchPlayer[], tactic: FpsTactic = 'DEFAULT'): BranchLineup | null {
  const cfg = kindCfg(data, kind);
  if (squad.length < cfg.squad) return null;
  if (kind === 'CARD') {
    const seats = squad.map((p) => ({ p, deck: bestDeck(data, p) })).map((x) => ({ ...x, s: cardStrength(data.card, cardInput(x.p, x.deck)) }))
      .sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id)).slice(0, cfg.squad);
    return { kind: 'CARD', seats: seats.map((x) => ({ playerId: x.p.id, deck: x.deck })) };
  }
  // Shooter: greedily give each role to whoever plays it best among those still free.
  const pool = [...squad].sort((a, b) => branchOverall(data, kind, b) - branchOverall(data, kind, a) || a.id.localeCompare(b.id)).slice(0, cfg.squad);
  let best: { slots: { playerId: string; role: FpsRole }[]; total: number } | null = null;
  const permute = (left: FpsRole[], used: BranchPlayer[], slots: { playerId: string; role: FpsRole }[], total: number) => {
    if (left.length === 0) { if (!best || total > best.total + 1e-9) best = { slots, total }; return; }
    const [role, ...rest] = left;
    for (const p of pool) if (!used.includes(p)) permute(rest, [...used, p], [...slots, { playerId: p.id, role: role! }], total + fpsRating(data.fps, fpsInput(p, role!)));
  };
  permute([...FPS_ROLES], [], [], 0);
  return { kind: 'FPS', tactic, slots: best!.slots };
}

export function validateBranchLineup(data: GameData, b: BranchState, lu: BranchLineup): string[] {
  const cfg = kindCfg(data, b.kind);
  const issues: string[] = [];
  if (lu.kind !== b.kind) return ['阵容类型不对'];
  const ids = lu.kind === 'FPS' ? lu.slots.map((s) => s.playerId) : lu.seats.map((s) => s.playerId);
  if (ids.length !== cfg.squad) issues.push(`需要 ${cfg.squad} 人`);
  if (new Set(ids).size !== ids.length) issues.push('同一个人不能上两次');
  for (const id of ids) if (!b.roster.includes(id)) issues.push('有人不在队里');
  if (lu.kind === 'FPS') {
    if (new Set(lu.slots.map((s) => s.role)).size !== FPS_ROLES.length) issues.push('五个位置每个要有一个人');
    if (!FPS_TACTICS.includes(lu.tactic)) issues.push('打法不对');
  } else if (lu.seats.some((s) => !CARD_DECKS.includes(s.deck))) issues.push('卡组不对');
  return issues;
}

export function setBranchLineup(state: GameState, data: GameData, kind: BranchKind, lu: BranchLineup): Result<undefined> {
  const b = branchOf(state, kind);
  if (!b) return fail('这个分部还没开');
  const issues = validateBranchLineup(data, b, lu);
  if (issues.length > 0) return fail(issues.join('；'));
  b.lineup = structuredClone(lu);
  return ok(undefined);
}

export function setBranchTraining(state: GameState, kind: BranchKind, plan: string): Result<undefined> {
  const b = branchOf(state, kind);
  if (!b) return fail('这个分部还没开');
  const allowed: string[] = kind === 'FPS' ? [...FPS_ATTRS, 'REST'] : [...CARD_ATTRS, 'REST', ...CARD_DECKS.map((d) => `DECK_${d}`)];
  if (!allowed.includes(plan)) return fail('训练内容不对');
  b.training = plan;
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Matches

function teamName(state: GameState, b: BranchState, id: string): { name: string; color: string } {
  if (id === PLAYER_CLUB_ID) return { name: state.club.name, color: state.club.color };
  const t = b.teams.find((x) => x.id === id)!;
  return { name: t.name, color: t.color };
}

function squadOf(b: BranchState, id: string): BranchPlayer[] {
  return id === PLAYER_CLUB_ID ? branchRoster(b) : b.teams.find((t) => t.id === id)!.roster.map((x) => b.players[x]!);
}

/** The lineup a team fields: the player's own (repaired if it is not valid any more), or the AI's best. */
function fieldLineup(_state: GameState, data: GameData, b: BranchState, id: string, seed: number): BranchLineup | null {
  if (id === PLAYER_CLUB_ID) {
    if (b.lineup && validateBranchLineup(data, b, b.lineup).length === 0) return b.lineup;
    const fixed = recommendBranchLineup(data, b.kind, branchRoster(b), b.lineup?.kind === 'FPS' ? b.lineup.tactic : 'DEFAULT');
    if (fixed) b.lineup = fixed;
    return fixed;
  }
  const t = b.teams.find((x) => x.id === id)!;
  const tactic = (FPS_TACTICS as readonly string[]).includes(t.tactic) ? (t.tactic as FpsTactic) : FPS_TACTICS[hashString(`${seed}:${id}`) % FPS_TACTICS.length]!;
  return recommendBranchLineup(data, b.kind, squadOf(b, id), tactic);
}

function fpsTeam(state: GameState, b: BranchState, id: string, lu: Extract<BranchLineup, { kind: 'FPS' }>): FpsTeamInput {
  return { id, name: teamName(state, b, id).name, tactic: lu.tactic, players: lu.slots.map((s) => fpsInput(b.players[s.playerId]!, s.role)) };
}
function cardTeam(state: GameState, b: BranchState, id: string, lu: Extract<BranchLineup, { kind: 'CARD' }>): CardTeamInput {
  return { id, name: teamName(state, b, id).name, players: lu.seats.map((s) => cardInput(b.players[s.playerId]!, s.deck)) };
}

interface Played { winner: string; score: [number, number]; forfeit: boolean }

/** Plays one fixture. A team that cannot field a lineup forfeits. */
function playFixture(state: GameState, data: GameData, b: BranchState, f: { blue: string; red: string; seed: number }, round: number, final: boolean): Played {
  const blue = fieldLineup(state, data, b, f.blue, f.seed);
  const red = fieldLineup(state, data, b, f.red, f.seed);
  const mine = f.blue === PLAYER_CLUB_ID ? 'BLUE' : f.red === PLAYER_CLUB_ID ? 'RED' : null;
  if (!blue || !red) {
    const winner = blue ? f.blue : f.red;
    if (mine) postMessage(state, 'MATCH', `${kindCfg(data, b.kind).name}人数不够，判负`, `凑不齐 ${kindCfg(data, b.kind).squad} 名选手，这一场直接判负。去分部窗口签人。`);
    return { winner, score: blue ? [1, 0] : [0, 1], forfeit: true };
  }
  const ids = [...(blue.kind === 'FPS' ? blue.slots : blue.seats), ...(red.kind === 'FPS' ? red.slots : red.seats)].map((s) => s.playerId);
  let winnerSide: 'BLUE' | 'RED';
  let score: [number, number];
  const replay: BranchReplay | null = mine ? {
    season: state.calendar.season, round, final, mySide: mine, names: Object.fromEntries(ids.map((id) => [id, b.players[id]!.name])),
    teams: { BLUE: teamName(state, b, f.blue), RED: teamName(state, b, f.red) },
  } : null;
  let report: { headline: string; keyReasons: string[]; mvp: string };
  if (blue.kind === 'FPS' && red.kind === 'FPS') {
    const r = runFpsMatch({ seed: f.seed, blue: fpsTeam(state, b, f.blue, blue), red: fpsTeam(state, b, f.red, red) }, data.fps);
    winnerSide = r.winner; score = [r.score.BLUE, r.score.RED];
    report = r.report;
    if (replay) replay.fps = r;
  } else if (blue.kind === 'CARD' && red.kind === 'CARD') {
    const r = runCardMatch({ seed: f.seed, blue: cardTeam(state, b, f.blue, blue), red: cardTeam(state, b, f.red, red) }, data.card);
    winnerSide = r.winner; score = [r.score.BLUE, r.score.RED];
    report = r.report;
    if (replay) replay.card = r;
  } else throw new Error('lineup kinds differ');
  const { headline, keyReasons, mvp } = report;
  const winner = winnerSide === 'BLUE' ? f.blue : f.red;
  for (const id of ids) { const p = b.players[id]!; p.played++; if (p.teamId === winner) p.wins++; }
  if (mine && replay) {
    b.replay = replay;
    const won = winner === PLAYER_CLUB_ID;
    const opponent = teamName(state, b, mine === 'BLUE' ? f.red : f.blue).name;
    b.reports.push({
      season: state.calendar.season, round, final, opponent, won, score: mine === 'BLUE' ? score : [score[1], score[0]], headline, keyReasons, mvp: b.players[mvp]?.name ?? '',
    });
    if (b.reports.length > data.branches.reportsKept) b.reports = b.reports.slice(-data.branches.reportsKept);
  }
  return { winner, score, forfeit: false };
}

export interface BranchStanding { teamId: string; name: string; played: number; wins: number; losses: number; diff: number }

export function branchStandings(state: GameState, b: BranchState): BranchStanding[] {
  const rows = new Map<string, BranchStanding>();
  for (const id of [PLAYER_CLUB_ID, ...b.teams.map((t) => t.id)]) rows.set(id, { teamId: id, name: teamName(state, b, id).name, played: 0, wins: 0, losses: 0, diff: 0 });
  for (const r of b.results.filter((x) => x.round < b.schedule.length)) {
    const blue = rows.get(r.blue)!, red = rows.get(r.red)!;
    blue.played++; red.played++;
    blue.diff += r.score[0] - r.score[1]; red.diff += r.score[1] - r.score[0];
    if (r.winner === r.blue) { blue.wins++; red.losses++; } else { red.wins++; blue.losses++; }
  }
  return [...rows.values()].sort((x, y) => y.wins - x.wins || y.diff - x.diff || x.teamId.localeCompare(y.teamId));
}

/** Days of this division's matches this season: one per league round, then the final. */
export function branchMatchDay(_state: GameState, data: GameData, b: BranchState, round: number): number {
  const week = data.season.daysPerWeek;
  return data.season.preseasonWeeks * week + round * week + kindCfg(data, b.kind).matchWeekday;
}

function money(state: GameState, kind: BranchKind, ledgerKind: 'PRIZE' | 'LEAGUE' | 'SALARY' | 'BRANCH' | 'STAFF', amount: number, note: string): void {
  if (amount !== 0) addLedger(state, { week: weekOfSeason(state), kind: ledgerKind, amount, note, branch: kind });
}

function addReputation(state: GameState, delta: number): void {
  state.club.reputation = Math.round(clamp(state.club.reputation + delta, 0, 100) * 10) / 10;
}

/** Plays whatever this division has on today's date: a league round or the final. */
function playToday(state: GameState, data: GameData, b: BranchState): void {
  const cfg = kindCfg(data, b.kind);
  const day = state.calendar.day;
  if (b.round < b.schedule.length && day === branchMatchDay(state, data, b, b.round)) {
    const round = b.round;
    for (const f of b.schedule[round]!) {
      const r = playFixture(state, data, b, f, round, false);
      b.results.push({ round, blue: f.blue, red: f.red, winner: r.winner, score: r.score });
      if (f.blue !== PLAYER_CLUB_ID && f.red !== PLAYER_CLUB_ID) continue;
      const won = r.winner === PLAYER_CLUB_ID;
      if (won) state.counters.wins++;
      const opp = teamName(state, b, f.blue === PLAYER_CLUB_ID ? f.red : f.blue).name;
      money(state, b.kind, 'PRIZE', won ? cfg.prizeWin : cfg.prizeLoss, `${cfg.name}第 ${round + 1} 轮${won ? '胜' : '负'}`);
      addReputation(state, won ? cfg.reputation.win : cfg.reputation.loss);
      const rep = b.reports.at(-1);
      if (!r.forfeit && rep) postMessage(state, 'MATCH', `${cfg.name}第 ${round + 1} 轮：${won ? '赢了' : '输给'}${opp} ${rep.score[0]}:${rep.score[1]}`, rep.keyReasons[0] ?? '', { branch: b.kind });
    }
    b.round++;
    return;
  }
  // The final: first against second, one week after the last round.
  if (!b.finalDone && b.round >= b.schedule.length && b.schedule.length > 0 && day >= branchMatchDay(state, data, b, b.schedule.length)) {
    const table = branchStandings(state, b);
    const [first, second] = [table[0]!, table[1]!];
    const seed = hashString(`branch:${b.kind}:${state.seed}:s${state.calendar.season}:final`);
    const r = playFixture(state, data, b, { blue: first.teamId, red: second.teamId, seed }, b.schedule.length, true);
    b.results.push({ round: b.schedule.length, blue: first.teamId, red: second.teamId, winner: r.winner, score: r.score });
    b.finalDone = true;
    const champion = teamName(state, b, r.winner).name;
    const rank = table.findIndex((x) => x.teamId === PLAYER_CLUB_ID) + 1;
    const mine = table[rank - 1]!;
    const inFinal = rank <= 2;
    const result = r.winner === PLAYER_CLUB_ID ? 'CHAMPION' : inFinal ? 'FINAL' : 'NONE';
    if (result === 'CHAMPION') { b.titles++; money(state, b.kind, 'PRIZE', cfg.finalPrize.champion, `${cfg.name}联赛冠军`); addReputation(state, cfg.reputation.champion); }
    else if (result === 'FINAL') { money(state, b.kind, 'PRIZE', cfg.finalPrize.runnerUp, `${cfg.name}联赛亚军`); addReputation(state, cfg.reputation.runnerUp); }
    b.history.push({ season: state.calendar.season, rank, wins: mine.wins, losses: mine.losses, champion, result });
    postMessage(state, 'SEASON', `${cfg.name}赛季结束：${result === 'CHAMPION' ? '夺冠！' : result === 'FINAL' ? '亚军' : `第 ${rank} 名`}`,
      `常规赛 ${mine.wins} 胜 ${mine.losses} 负，第 ${rank} 名。总决赛冠军：${champion}。`, { branch: b.kind });
  }
}

// ---------------------------------------------------------------------------
// The calendar: called by the season loop

/** Every day: play today's division matches. */
export function branchesDay(state: GameState, data: GameData): void {
  for (const b of openBranches(state)) if (branchActive(state, b)) { branchDirectorMatchDay(state, data, b); playToday(state, data, b); }
}

/** What the divisions add to the weekly sponsor money (as a share of it). */
export function branchSponsorBonus(state: GameState, data: GameData): number {
  return openBranches(state).filter((b) => branchActive(state, b)).reduce((a, b) => a + kindCfg(data, b.kind).sponsorBonus, 0);
}

export interface BranchWeekly { salaries: number; upkeep: number; league: number; director: number; net: number }

export function branchWeeklyMoney(state: GameState, data: GameData, b: BranchState): BranchWeekly {
  const cfg = kindCfg(data, b.kind);
  const active = branchActive(state, b);
  const inSeason = active && state.calendar.phase !== 'PRESEASON' && state.calendar.phase !== 'FINISHED' && !b.finalDone;
  const salaries = branchSalaries(b);
  const upkeep = active ? cfg.weeklyUpkeep : 0;
  const league = inSeason ? cfg.leagueShareWeekly : 0;
  const director = b.director ? b.director.salaryPerWeek : 0;
  return { salaries, upkeep, league, director, net: league - salaries - upkeep - director };
}

/** Pay day: wages, running costs and league money of every division, then a week of training. */
export function branchesPayDay(state: GameState, data: GameData): void {
  for (const b of openBranches(state)) {
    const cfg = kindCfg(data, b.kind);
    const m = branchWeeklyMoney(state, data, b);
    money(state, b.kind, 'SALARY', -m.salaries, `${cfg.name}周薪`);
    money(state, b.kind, 'BRANCH', -m.upkeep, `${cfg.name}运营费`);
    money(state, b.kind, 'LEAGUE', m.league, `${cfg.name}联赛分成`);
    money(state, b.kind, 'STAFF', -m.director, `${cfg.name}总监工资`);
    branchDirectorWeek(state, data, b);
    trainWeek(state, data, b);
  }
}

function trainWeek(state: GameState, data: GameData, b: BranchState): void {
  const cfg = kindCfg(data, b.kind);
  const rng = stream(state, b.kind, `train:${weekOfSeason(state)}`);
  const attrNames: readonly string[] = b.kind === 'FPS' ? FPS_ATTRS : CARD_ATTRS;
  for (const p of branchRoster(b)) {
    p.form = clamp(Math.round((p.form * 0.6 + rng.int(-data.branches.formSwing, data.branches.formSwing)) * 10) / 10, -10, 10);
    if (b.training === 'REST') { p.form = clamp(p.form + cfg.growth.restForm, -10, 10); continue; }
    const past = Math.max(0, p.age - cfg.age.peak);
    const room = branchOverall(data, b.kind, p) < p.potential ? 1 : 0.15;
    const gain = cfg.growth.perWeek * Math.max(0, 1 - past * 0.25) * room;
    if (b.training.startsWith('DECK_') && p.decks) {
      const d = b.training.slice(5) as CardDeck;
      p.decks[d] = clamp(Math.round((cardProficiency({ decks: p.decks }, d) + 1.2) * 10) / 10, 0, 100);
      continue;
    }
    for (const a of attrNames) {
      const step = a === b.training ? gain * (1 + cfg.growth.focusBonus) : gain * 0.25;
      p.attrs[a] = clamp(Math.round((p.attrs[a]! + step) * 100) / 100, 0, 99);
    }
  }
}

/** A new season for every division: contracts end, players age, the AI teams change, a new market and schedule. */
export function branchesNewSeason(state: GameState, data: GameData): void {
  const season = state.calendar.season; // already the new one
  for (const b of openBranches(state)) {
    const cfg = kindCfg(data, b.kind);
    const rng = stream(state, b.kind, 'newseason');
    if (b.startSeason < season) {
      // The player's team: expired contracts leave, everyone is a year older, veterans fade.
      const gone: string[] = [];
      for (const p of branchRoster(b)) {
        p.age++;
        if (p.age > cfg.age.peak + 2) for (const a of Object.keys(p.attrs)) p.attrs[a] = clamp(Math.round((p.attrs[a]! - cfg.growth.declinePerSeason * rng.next() * 2) * 100) / 100, 20, 99);
        const retire = p.age >= cfg.age.retire;
        if ((p.contractUntil ?? 0) < season || retire) { gone.push(retire ? `${p.name}（退役）` : p.name); b.roster = b.roster.filter((id) => id !== p.id); delete b.players[p.id]; }
      }
      if (gone.length > 0) { postMessage(state, 'CONTRACT', `${cfg.name}：${gone.length} 人离队`, `${gone.join('、')} 合同到期或退役，离开了队伍。`, { branch: b.kind }); b.lineup = null; }
      // AI teams: their level drifts a little, the squads are rebuilt around it.
      const lv = data.branches.aiLevel;
      for (const t of b.teams) {
        t.level = clamp(t.level + rng.int(-lv.driftPerSeason, lv.driftPerSeason), lv.min, lv.max);
        staffTeam(data, b, t, rng);
      }
      refreshMarket(data, b, rng);
      refreshDirectorCandidates(state, data, b);
    }
    if (branchActive(state, b)) startBranchSeason(state, data, b);
    branchDirectorWeek(state, data, b);
  }
}

// ---------------------------------------------------------------------------
// Division directors (T40): one person who runs the whole division when it is delegated

function refreshDirectorCandidates(state: GameState, data: GameData, b: BranchState): void {
  const d = data.branches.director;
  const rng = stream(state, b.kind, 'directors');
  const taken = new Set([b.director?.name]);
  b.candidates = [];
  for (let i = 0; i < d.candidates; i++) {
    const skill = rng.int(d.skillMin, d.skillMax);
    const name = rng.pick(d.namePool.filter((n) => !taken.has(n)));
    taken.add(name);
    const salary = roundTo(d.salaryBase + (skill - d.skillMin) * d.salaryPerSkill, 10);
    b.candidates.push({ id: `dir_${b.kind.toLowerCase()}_s${state.calendar.season}_${i}`, name, skill, salaryPerWeek: salary, signingFee: salary * d.signingFeeWeeks });
  }
}

export function hireDirector(state: GameState, data: GameData, kind: BranchKind, id: string): Result<undefined> {
  const b = branchOf(state, kind);
  const c = b?.candidates.find((x) => x.id === id);
  if (!b || !c) return fail('这个人不在候选名单里');
  if (b.director) return fail('已经有总监了，先解雇再雇新人');
  if (state.funds < c.signingFee) return fail(`资金不足：签约费 ${c.signingFee}`);
  money(state, kind, 'STAFF', -c.signingFee, `聘请${kindCfg(data, kind).name}总监 ${c.name}`);
  b.director = { ...c, hiredSeason: state.calendar.season };
  b.candidates = b.candidates.filter((x) => x.id !== id);
  b.managed = true;
  return ok(undefined);
}

export function fireDirector(state: GameState, data: GameData, kind: BranchKind): Result<number> {
  const b = branchOf(state, kind);
  if (!b?.director) return fail('这个分部没有总监');
  const fee = b.director.salaryPerWeek * 4;
  if (state.funds < fee) return fail(`资金不足：违约金 ${fee}`);
  money(state, kind, 'STAFF', -fee, `与${kindCfg(data, kind).name}总监 ${b.director.name} 解约`);
  b.director = null;
  b.managed = false;
  return ok(fee);
}

export function setBranchManaged(state: GameState, kind: BranchKind, managed: boolean): Result<undefined> {
  const b = branchOf(state, kind);
  if (!b) return fail('这个分部还没开');
  if (managed && !b.director) return fail('先雇一个总监');
  b.managed = managed;
  return ok(undefined);
}

function log(state: GameState, data: GameData, b: BranchState, text: string, reason: string, cost = 0): void {
  b.log.push({ season: state.calendar.season, day: state.calendar.day, text, reason, cost });
  if (b.log.length > data.branches.logKept) b.log = b.log.slice(-data.branches.logKept);
}

/** How good a player looks to this director: the truth plus his own fixed misjudgement. */
function seen(data: GameData, b: BranchState, p: BranchPlayer): number {
  const d = data.branches.director;
  const view = (hashString(`${b.director!.id}:${p.id}`) % 2001) / 1000 - 1;
  return branchOverall(data, b.kind, p) + view * d.perceptionNoise * (1 - b.director!.skill / 100);
}

/** The director's week: fill the squad, renew who is worth it, pick the training. */
function branchDirectorWeek(state: GameState, data: GameData, b: BranchState): void {
  if (!b.managed || !b.director) return;
  const cfg = kindCfg(data, b.kind);
  // Fill the squad (every role for the shooter), best-looking player the purse allows.
  for (let guard = 0; guard < cfg.squad && b.roster.length < cfg.squad; guard++) {
    const have = new Set(branchRoster(b).map((p) => p.primaryRole));
    const need = b.kind === 'FPS' ? FPS_ROLES.find((r) => !have.has(r)) : undefined;
    const cheap = branchMarket(b).map((x) => x.salaryPerWeek).sort((x, y) => x - y)[Math.min(2, b.market.length - 1)] ?? 0;
    const pool = branchMarket(b).filter((p) => (!need || p.primaryRole === need) && (p.signingFee <= state.funds * 0.25 || p.salaryPerWeek <= cheap));
    const pick = [...pool].sort((x, y) => seen(data, b, y) - seen(data, b, x) || x.id.localeCompare(y.id))[0] ?? branchMarket(b).filter((p) => p.salaryPerWeek <= cheap)[0];
    if (!pick) break;
    const r = signBranchPlayer(state, data, b.kind, pick.id);
    if (!r.ok) break;
    log(state, data, b, `签下 ${pick.name}（能力 ${Math.round(branchOverall(data, b.kind, pick))}，周薪 ${pick.salaryPerWeek}）`, need ? `队里缺${data.fps.roles[need].name}；他看这个人能力约 ${Math.round(seen(data, b, pick))}` : `队里人不够；他看这个人能力约 ${Math.round(seen(data, b, pick))}`, -pick.signingFee);
  }
  // Renew in the last season of a contract, once the league is under way.
  if (state.calendar.phase === 'REGULAR' || state.calendar.phase === 'PLAYOFFS') {
    for (const p of branchExpiring(state, b)) {
      if (p.age + 1 >= cfg.age.retire) continue;
      const ask = branchRenewalAsk(data, b.kind, p);
      if (renewBranchPlayer(state, data, b.kind, p.id).ok) log(state, data, b, `和 ${p.name} 续约，周薪 ${ask}`, '合同最后一个赛季，留住首发');
    }
  }
  // Training: rest a squad out of form, otherwise the weakest attribute.
  const squad = branchRoster(b);
  if (squad.length > 0) {
    const form = squad.reduce((a, p) => a + p.form, 0) / squad.length;
    const names: readonly string[] = b.kind === 'FPS' ? FPS_ATTRS : CARD_ATTRS;
    const avg = (k: string) => squad.reduce((a, p) => a + (p.attrs[k] ?? 0), 0) / squad.length;
    const weakest = [...names].sort((x, y) => avg(x) - avg(y))[0]!;
    // Keep the current focus until another attribute has clearly fallen behind it.
    const keep = names.includes(b.training) && avg(b.training) - avg(weakest) < data.branches.director.trainSwitchGap;
    const plan = form < -3 ? 'REST' : keep ? b.training : weakest;
    if (plan !== b.training) { b.training = plan; log(state, data, b, `训练改成：${plan === 'REST' ? '休息' : branchAttrName(data, b.kind, plan)}`, plan === 'REST' ? '全队状态差' : '全队这一项最弱'); }
  }
}

export function branchAttrName(data: GameData, kind: BranchKind, attr: string): string {
  return ((kind === 'FPS' ? data.fps.attrs : data.card.attrs) as Record<string, string>)[attr] ?? attr;
}

/** Match day: the director sets the lineup, and for the shooter a tactic against the opponent's usual one. */
function branchDirectorMatchDay(state: GameState, data: GameData, b: BranchState): void {
  if (!b.managed || !b.director) return;
  const day = state.calendar.day;
  const league = b.round < b.schedule.length && day === branchMatchDay(state, data, b, b.round);
  const final = !b.finalDone && b.round >= b.schedule.length && b.schedule.length > 0 && day >= branchMatchDay(state, data, b, b.schedule.length);
  if (!league && !final) return;
  let tactic: FpsTactic = 'DEFAULT';
  let reason = '按能力排最强阵容';
  if (b.kind === 'FPS' && league) {
    const f = b.schedule[b.round]!.find((x) => x.blue === PLAYER_CLUB_ID || x.red === PLAYER_CLUB_ID);
    const opp = b.teams.find((t) => t.id === (f?.blue === PLAYER_CLUB_ID ? f.red : f?.blue));
    const slip = (hashString(`${b.director.id}:${state.calendar.season}:${b.round}`) % 1000) / 1000 < data.branches.director.mistakeAtZero * (1 - b.director.skill / 100);
    const counter = opp && (FPS_TACTICS as readonly string[]).includes(opp.tactic) ? FPS_TACTICS.find((t) => (data.fps.tacticEdge[t]?.[opp.tactic as FpsTactic] ?? 0) > 0) : undefined;
    if (counter && !slip) { tactic = counter; reason = `${opp!.name}惯用「${data.fps.tactics[opp!.tactic as FpsTactic].name}」，用「${data.fps.tactics[counter].name}」克制`; }
    else if (counter && slip) { tactic = FPS_TACTICS[hashString(`${b.director.id}:${b.round}`) % FPS_TACTICS.length]!; reason = `没看准${opp!.name}的打法，选了「${data.fps.tactics[tactic].name}」`; }
  }
  const lu = recommendBranchLineup(data, b.kind, branchRoster(b), tactic);
  if (!lu) return;
  if (JSON.stringify(lu) !== JSON.stringify(b.lineup)) { b.lineup = lu; log(state, data, b, b.kind === 'FPS' ? `排阵，打法「${data.fps.tactics[tactic].name}」` : '排出场顺序和卡组', reason); }
}
