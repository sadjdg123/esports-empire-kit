// Loads the TypeScript worker through tsx (worker threads do not inherit the loader).
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');
