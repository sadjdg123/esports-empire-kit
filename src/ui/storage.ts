// Browser storage for saves. Every access is guarded: private windows or
// blocked storage must not crash the game.
import type { StorageAdapter } from '../save';

export const SAVE_KEY = 'esports-empire/p0/save';

export const browserStorage: StorageAdapter = {
  read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value) {
    window.localStorage.setItem(key, value); // errors propagate so saveGame can report them
  },
};

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
