import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { advanceWeek, newGame, signValueSquad, type GameState } from '../../src/game';
import {
  MemoryStorage, SAVE_VERSION, backupKey, deserialize, exportFileName, importSave, loadGame, migrate, saveGame, serialize,
  type Migration, type SaveFile,
} from '../../src/save';

const data = loadGameData();
const KEY = 'esports-empire/save';
const meta = { createdAt: '2026-10-22T12:00:00Z' };

function game(seed = 11): GameState {
  const s = newGame('存档测试', '#123456', seed, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  return s;
}

describe('serialize / deserialize', () => {
  it('round-trips the game state exactly', () => {
    const s = game();
    advanceWeek(s, data);
    const r = deserialize(serialize(s, meta));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.version).toBe(SAVE_VERSION);
    expect(r.save.createdAt).toBe(meta.createdAt);
    expect(r.save.game).toEqual(s);
  });

  it('save -> load -> play 3 weeks equals playing 3 weeks without saving', () => {
    const a = game(21);
    advanceWeek(a, data);
    const loaded = deserialize(serialize(a, meta));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const b = loaded.save.game as GameState;
    for (let i = 0; i < 3; i++) {
      advanceWeek(a, data);
      advanceWeek(b, data);
    }
    expect(b).toEqual(a);
  }, 60_000);

  it('returns a clear error for broken JSON instead of crashing', () => {
    const r = deserialize('{"version": 1, "game": ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('损坏');
  });

  it('returns a clear error for incomplete saves', () => {
    const s = JSON.parse(serialize(game(), meta)) as SaveFile;
    delete (s.game as unknown as Record<string, unknown>).players;
    const r = deserialize(JSON.stringify(s));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('players');
  });

  it('refuses saves from a newer version with a "version too new" message', () => {
    const s = JSON.parse(serialize(game(), meta)) as SaveFile;
    s.version = SAVE_VERSION + 1;
    const r = deserialize(JSON.stringify(s));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('版本过新');
  });
});

describe('migrations', () => {
  it('upgrades an old v0 save through a registered migration', () => {
    // Pretend v0 stored the club name at the top level and had no version field.
    const v1 = JSON.parse(serialize(game(), meta)) as Record<string, unknown>;
    const v0: Record<string, unknown> = { ...v1, clubName: (v1.game as GameState).club.name };
    delete v0.version;
    (v0.game as GameState).club.name = '';
    const fakeMigrations: Record<number, Migration> = {
      0: (old) => {
        (old.game as GameState).club.name = old.clubName as string;
        delete old.clubName;
        return old;
      },
    };
    const upgraded = migrate(v0, fakeMigrations);
    expect(upgraded.version).toBe(1);
    expect(upgraded.game.club.name).toBe('存档测试');
    expect(deserialize(JSON.stringify(v0), fakeMigrations).ok).toBe(true);
  });

  it('reports a missing migration', () => {
    const r = deserialize(JSON.stringify({ version: 0, game: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('无法把 v0');
  });
});

describe('safe storage', () => {
  it('keeps the previous save as a backup', () => {
    const st = new MemoryStorage();
    const s = game();
    expect(saveGame(st, KEY, s, meta).ok).toBe(true);
    advanceWeek(s, data);
    expect(saveGame(st, KEY, s, meta).ok).toBe(true);
    const bak = deserialize(st.read(backupKey(KEY))!);
    expect(bak.ok && (bak.save.game as GameState).week).toBe(0);
    const main = loadGame(st, KEY);
    expect(main.status).toBe('loaded');
    expect((main.save!.game as GameState).week).toBe(1);
  });

  it('an error in the middle of writing leaves the existing save intact', () => {
    const st = new MemoryStorage();
    const s = game();
    saveGame(st, KEY, s, meta);
    const before = st.read(KEY);
    advanceWeek(s, data);
    const failing = {
      read: (k: string) => st.read(k),
      write: (k: string, v: string) => {
        if (k === KEY) throw new Error('disk full');
        st.write(k, v);
      },
    };
    expect(() => saveGame(failing, KEY, s, meta)).toThrow('disk full');
    expect(st.read(KEY)).toBe(before);
    expect(loadGame(st, KEY).status).toBe('loaded');
  });

  it('a corrupt main save falls back to the backup and is never overwritten by loading', () => {
    const st = new MemoryStorage();
    const s = game();
    saveGame(st, KEY, s, meta);
    advanceWeek(s, data);
    saveGame(st, KEY, s, meta);
    st.write(KEY, '{broken');
    const r = loadGame(st, KEY);
    expect(r.status).toBe('loaded-backup');
    expect(r.error).toContain('损坏');
    expect(st.read(KEY)).toBe('{broken');
  });

  it('reports an empty slot and total failure separately', () => {
    const st = new MemoryStorage();
    expect(loadGame(st, KEY).status).toBe('empty');
    st.write(KEY, 'nope');
    expect(loadGame(st, KEY).status).toBe('failed');
  });
});

describe('import / export', () => {
  it('builds a readable file name and validates imports', () => {
    const s = game();
    expect(exportFileName(s, '20261022')).toBe('电竞帝国_存档测试_第0轮_20261022.json');
    expect(importSave(serialize(s, meta)).ok).toBe(true);
    expect(importSave('hello').ok).toBe(false);
  });
});
