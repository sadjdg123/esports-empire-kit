// Versioned save files. Pure logic: storage is injected through StorageAdapter,
// and the timestamp comes from the caller (logic layers never read the clock).

export const SAVE_VERSION = 1;

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

/** Registered upgrades, keyed by the version they upgrade from. v1 is the first real format. */
export const MIGRATIONS: Record<number, Migration> = {};

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
