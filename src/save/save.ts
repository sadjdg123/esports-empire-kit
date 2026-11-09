// Versioned save files. Pure logic: storage is injected through StorageAdapter,
// and the timestamp comes from the caller (logic layers never read the clock).

import { loadGameData } from '../core/config';
import { personalityFor } from '../core/personality';
import { AUTHORITIES, FACILITY_IDS, STAFF_ROLES } from '../core/types';

export const SAVE_VERSION = 5;

/**
 * What the save layer needs to know about the game state. The full type lives
 * in src/game (save may only depend on core), so callers pass their own type.
 */
export interface SavableGame {
  week: number;
  rngState: number[];
  club: { name: string };
}

export interface SaveFile<G extends SavableGame = SavableGame> {
  version: number; // starts at 1
  createdAt: string; // supplied by the UI layer
  game: G;
  rngState: number[];
}

export interface StorageAdapter {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export type LoadResult = { ok: true; save: SaveFile } | { ok: false; error: string };

export interface SaveMeta {
  createdAt: string;
}

export function serialize<G extends SavableGame>(state: G, meta: SaveMeta): string {
  const file: SaveFile<G> = { version: SAVE_VERSION, createdAt: meta.createdAt, game: state, rngState: [...state.rngState] };
  return JSON.stringify(file);
}

/** A migration upgrades a save object from `from` to `from + 1`. */
export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

type Obj = Record<string, unknown>;

/** P0 (v1) -> P1 (v2): calendar, inbox, history, reputation, AI club money, player condition and contracts. */
function migrateV1toV2(save: Obj): Obj {
  const g = save.game as Obj;
  const week = typeof g.week === 'number' ? g.week : 0;
  const total = typeof g.totalRounds === 'number' ? g.totalRounds : 10;
  g.calendar = { season: 1, phase: week >= total ? 'FINISHED' : week === 0 ? 'PRESEASON' : 'REGULAR', day: 14 + week * 7 };
  g.training ??= 'AUTO';
  g.inbox ??= [];
  g.nextMessageId ??= 1;
  g.history ??= [];
  g.playoffs ??= [];
  g.offers ??= [];
  g.negotiations ??= [];
  g.sponsor ??= null;
  const club = g.club as Obj;
  club.reputation ??= 15;
  club.management ??= 'PLAYER';
  club.funds ??= 0;
  // AI club budgets were not tracked in P0: give every club the same mid-sized purse.
  for (const c of (g.aiClubs as Obj[] | undefined) ?? []) {
    c.reputation ??= 40;
    c.management ??= 'STEADY';
    c.funds ??= 250000;
  }
  const players = (g.players as Record<string, Obj> | undefined) ?? {};
  for (const id of Object.keys(players).sort()) {
    const p = players[id]!;
    const a = p.attrs as Record<string, number> | undefined;
    const ovr = a ? (a.mechanics! + a.awareness! + a.teamwork! + a.mental!) / 4 : 50;
    const age = typeof p.age === 'number' ? p.age : 22;
    p.potential ??= Math.min(100, Math.round(ovr + Math.max(0, 24 - age) * 1.5));
    p.fatigue ??= 0;
    p.morale ??= 70;
    p.stats ??= { played: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
    if (p.clubId !== null && p.clubId !== undefined) p.contractUntil ??= 2;
  }
  return save;
}

/**
 * P1 (v2) -> P2 (v3): personality and growth type for every player (the same as a new game
 * would give them), empty careers, every room at level 1, no chemistry yet, empty hall of fame.
 */
function migrateV2toV3(save: Obj): Obj {
  const g = save.game as Obj;
  const data = loadGameData();
  const players = (g.players as Record<string, Obj> | undefined) ?? {};
  for (const id of Object.keys(players).sort()) {
    const p = players[id]!;
    const pers = personalityFor(id, data.traits, data.growth);
    p.traits ??= pers.traits;
    p.growthType ??= pers.growthType;
    p.career ??= [];
  }
  const rooms = () => Object.fromEntries(FACILITY_IDS.map((r) => [r, 1]));
  for (const c of [g.club as Obj | undefined, ...((g.aiClubs as Obj[] | undefined) ?? [])]) if (c) c.facilities ??= rooms();
  g.chemistry ??= {};
  g.hallOfFame ??= [];
  g.awards ??= [];
  return save;
}

/** P2 (v3) -> P3 (v4): nobody hired, every role run by the player, empty queue and log. Plays exactly as before. */
function migrateV3toV4(save: Obj): Obj {
  const g = save.game as Obj;
  const d = loadGameData().staff.delegation;
  g.staff ??= {};
  g.staffMarket ??= [];
  g.delegation ??= {
    roles: Object.fromEntries(STAFF_ROLES.map((r) => [r, { staffId: null, authority: 'SELF' }])),
    limit: d.defaultLimit,
    protectTop: d.protectTop,
  };
  g.pending ??= [];
  g.decisionLog ??= [];
  g.nextDecisionId ??= 1;
  return save;
}

/** Registered upgrades, keyed by the version they upgrade from. */
/** P3 (v4) -> P4 (v5): no other divisions yet, no milestones reached; the game plays as before. */
function migrateV4toV5(save: Obj): Obj {
  const g = save.game as Obj;
  g.branches ??= {};
  g.goals ??= {};
  g.counters ??= { wins: 0, profitSeasons: 0, triples: 0 };
  return save;
}

export const MIGRATIONS: Record<number, Migration> = { 1: migrateV1toV2, 2: migrateV2toV3, 3: migrateV3toV4, 4: migrateV4toV5 };

export class SaveError extends Error {}

/** Upgrades an older save object to the current version. Throws SaveError when impossible. */
export function migrate(save: unknown, migrations: Record<number, Migration> = MIGRATIONS, target = SAVE_VERSION): SaveFile {
  if (typeof save !== 'object' || save === null || Array.isArray(save)) throw new SaveError('存档内容不是有效的对象');
  let cur = save as Record<string, unknown>;
  let version = typeof cur.version === 'number' ? cur.version : 0;
  if (!Number.isInteger(version) || version < 0) throw new SaveError('存档版本号无效');
  if (version > target) throw new SaveError(`存档版本过新（存档 v${version}，游戏只支持到 v${target}），请更新游戏后再读取`);
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new SaveError(`无法把 v${version} 的存档升级到 v${version + 1}`);
    cur = step(structuredClone(cur));
    version++;
    cur.version = version;
  }
  return cur as unknown as SaveFile;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Structural check of a current-version save; returns the first problem found. */
export function checkSave(save: SaveFile): string | null {
  if (save.version !== SAVE_VERSION) return `版本号应为 ${SAVE_VERSION}`;
  if (typeof save.createdAt !== 'string') return '缺少存档时间';
  const g = save.game as unknown as Record<string, unknown> | null;
  if (typeof g !== 'object' || g === null) return '缺少游戏数据';
  for (const k of ['seed', 'week', 'totalRounds', 'startingFunds', 'funds']) if (!isNum(g[k])) return `游戏数据缺少 ${k}`;
  for (const k of ['market', 'schedule', 'results', 'ledger', 'reports', 'aiClubs', 'rngState']) if (!Array.isArray(g[k])) return `游戏数据缺少 ${k}`;
  if (typeof g.players !== 'object' || g.players === null) return '游戏数据缺少 players';
  const club = g.club as Record<string, unknown> | undefined;
  if (!club || typeof club.name !== 'string' || !Array.isArray(club.roster)) return '游戏数据缺少俱乐部信息';
  const players = g.players as Record<string, unknown>;
  for (const id of [...(club.roster as unknown[]), ...(g.market as unknown[])]) {
    if (typeof id !== 'string' || !players[id]) return `找不到选手 ${String(id)}`;
  }
  const rng = g.rngState as unknown[];
  if (rng.length !== 4 || !rng.every((w) => Number.isInteger(w))) return '随机数状态损坏';
  if (!Array.isArray(save.rngState) || save.rngState.length !== 4) return '随机数状态损坏';
  if ((g.week as number) < 0 || (g.week as number) > (g.totalRounds as number)) return '赛程进度超出范围';
  const cal = g.calendar as Record<string, unknown> | undefined;
  if (!cal || !isNum(cal.season) || !isNum(cal.day) || typeof cal.phase !== 'string') return '缺少日历信息';
  // Fields added during P1 development, after v2 was defined.
  g.offers ??= [];
  g.negotiations ??= [];
  g.sponsor ??= null;
  for (const k of ['inbox', 'history', 'playoffs', 'offers', 'negotiations']) if (!Array.isArray(g[k])) return `游戏数据缺少 ${k}`;
  // P2 (v3)
  for (const c of [club, ...(g.aiClubs as Record<string, unknown>[])]) {
    const f = c.facilities as Record<string, unknown> | undefined;
    if (!f || FACILITY_IDS.some((r) => !isNum(f[r]) || (f[r] as number) < 1 || (f[r] as number) > 3)) return `俱乐部 ${String(c.name)} 的设施数据损坏`;
  }
  if (typeof g.chemistry !== 'object' || g.chemistry === null || Array.isArray(g.chemistry)) return '游戏数据缺少 chemistry';
  for (const k of ['hallOfFame', 'awards']) if (!Array.isArray(g[k])) return `游戏数据缺少 ${k}`;
  // P4 (v5)
  for (const k of ['branches', 'goals', 'counters']) if (typeof g[k] !== 'object' || g[k] === null || Array.isArray(g[k])) return `游戏数据缺少 ${k}`;
  // P3 (v4)
  if (typeof g.staff !== 'object' || g.staff === null || Array.isArray(g.staff)) return '游戏数据缺少 staff';
  for (const k of ['staffMarket', 'pending', 'decisionLog']) if (!Array.isArray(g[k])) return `游戏数据缺少 ${k}`;
  if (!isNum(g.nextDecisionId)) return '游戏数据缺少 nextDecisionId';
  const del = g.delegation as Record<string, unknown> | undefined;
  const roles = del?.roles as Record<string, Record<string, unknown>> | undefined;
  if (!del || !roles || !isNum(del.limit) || !isNum(del.protectTop)) return '委任设置损坏';
  const staff = g.staff as Record<string, unknown>;
  for (const r of STAFF_ROLES) {
    const slot = roles[r];
    if (!slot || !AUTHORITIES.includes(slot.authority as never)) return `委任设置损坏（${r}）`;
    if (slot.staffId !== null && (typeof slot.staffId !== 'string' || !staff[slot.staffId])) return `找不到负责人 ${String(slot.staffId)}`;
  }
  for (const id of g.staffMarket as unknown[]) if (typeof id !== 'string' || !staff[id]) return `找不到负责人候选 ${String(id)}`;
  return null;
}

export function deserialize(text: string, migrations: Record<number, Migration> = MIGRATIONS): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '存档文件已损坏（不是有效的 JSON）' };
  }
  let save: SaveFile;
  try {
    save = migrate(raw, migrations);
  } catch (e) {
    return { ok: false, error: e instanceof SaveError ? e.message : `读取存档失败：${String(e)}` };
  }
  const problem = checkSave(save);
  if (problem) return { ok: false, error: `存档内容不完整：${problem}` };
  // The game state carries the authoritative rng state.
  save.rngState = [...save.game.rngState];
  return { ok: true, save };
}

export const tmpKey = (key: string) => `${key}.tmp`;
export const backupKey = (key: string) => `${key}.bak`;

/**
 * Safe write: write to a temporary key, read it back and validate, then keep
 * the previous save as a backup and replace the main key. If anything throws,
 * the main save is left untouched.
 */
export function safeWrite(storage: StorageAdapter, key: string, text: string): LoadResult {
  storage.write(tmpKey(key), text);
  const check = deserialize(storage.read(tmpKey(key)) ?? '');
  if (!check.ok) return check;
  const previous = storage.read(key);
  if (previous !== null && deserialize(previous).ok) storage.write(backupKey(key), previous);
  storage.write(key, text);
  storage.write(tmpKey(key), '');
  return check;
}

export function saveGame<G extends SavableGame>(storage: StorageAdapter, key: string, state: G, meta: SaveMeta): LoadResult {
  return safeWrite(storage, key, serialize(state, meta));
}

export interface LoadOutcome {
  status: 'empty' | 'loaded' | 'loaded-backup' | 'failed';
  save?: SaveFile;
  error?: string; // why the main save could not be used
}

/** Reads the main save, falling back to the backup. Never deletes or overwrites anything. */
export function loadGame(storage: StorageAdapter, key: string): LoadOutcome {
  const main = storage.read(key);
  if (main === null || main === '') {
    const bak = storage.read(backupKey(key));
    if (bak) {
      const b = deserialize(bak);
      if (b.ok) return { status: 'loaded-backup', save: b.save, error: '没有找到主存档' };
    }
    return { status: 'empty' };
  }
  const m = deserialize(main);
  if (m.ok) return { status: 'loaded', save: m.save };
  const bak = storage.read(backupKey(key));
  if (bak) {
    const b = deserialize(bak);
    if (b.ok) return { status: 'loaded-backup', save: b.save, error: m.error };
  }
  return { status: 'failed', error: m.error };
}

/**
 * File name for exporting a save. `date` is supplied by the UI (YYYYMMDD).
 * ASCII only: some browsers drop non-ASCII download names.
 */
export function exportFileName(state: SavableGame, date: string): string {
  return `esports-empire_round${state.week}_${date}.json`;
}

/** Validates an imported file before it may replace the current game. */
export function importSave(text: string): LoadResult {
  return deserialize(text);
}

export class MemoryStorage implements StorageAdapter {
  readonly data = new Map<string, string>();
  read(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  write(key: string, value: string): void {
    this.data.set(key, value);
  }
}
