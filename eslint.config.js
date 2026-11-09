import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Pure-logic layers must stay runnable in Node: no UI libs, no browser globals.
const PURE_LOGIC_DIRS = ['src/core/**', 'src/sim/**', 'src/sim-fps/**', 'src/sim-card/**', 'src/game/**', 'src/save/**'];

const BANNED_BROWSER_GLOBALS = [
  'window', 'document', 'localStorage', 'sessionStorage', 'navigator',
  'location', 'requestAnimationFrame', 'performance',
].map((name) => ({ name, message: 'Pure-logic modules must not touch browser globals.' }));

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: PURE_LOGIC_DIRS,
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'Pure-logic modules must not import React.' },
          { name: 'react-dom', message: 'Pure-logic modules must not import React.' },
          { name: 'phaser', message: 'Pure-logic modules must not import Phaser.' },
        ],
        patterns: [
          { group: ['react/*', 'react-dom/*', 'phaser/*'], message: 'Pure-logic modules must not import UI libraries.' },
          { group: ['**/ui', '**/ui/*', '**/render', '**/render/*'], message: 'Pure-logic modules must not depend on ui/render.' },
        ],
      }],
      'no-restricted-globals': ['error', ...BANNED_BROWSER_GLOBALS],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG from src/core/rng.ts.' },
        { object: 'Date', property: 'now', message: 'Simulation must be deterministic; no clock reads.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date']", message: 'Simulation must be deterministic; no clock reads.' },
      ],
    },
  },
  {
    // Browser check scripts run by Node with Playwright (CommonJS).
    files: ['tools/e2e/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
