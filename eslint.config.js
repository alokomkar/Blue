import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig([
  tseslint.configs.recommended,
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/server/**/*.{ts,tsx,mjs,cjs,js}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: {
        project: ['./tools/tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/shared/**/*.{ts,tsx,mjs,cjs,js}'],
    ignores: ['src/shared/**/*.test.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        project: ['./tools/tsconfig.shared.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/client/**/*.{ts,tsx}'],
    ignores: ['src/server/**/*.{ts,tsx}', 'src/client/**/*.test.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        project: ['./tools/tsconfig.client.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Vercel functions (Node, Web-standard Request/Response). Tests are type-checked too: tools/tsconfig.api.json
    // includes them and has Node types.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['api/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: {
        project: ['./tools/tsconfig.api.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // *.test.ts runs directly under Node (node:test, via `npm run
    // test:unit`'s --experimental-strip-types), not through Vite/tsc, and
    // is deliberately excluded from tools/tsconfig.client.json and
    // tsconfig.shared.json (neither has Node types, correctly, for code
    // that ships to the browser) — so it gets
    // plain, non-type-aware linting here instead.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/client/**/*.test.ts', 'src/shared/**/*.test.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['off'],
      'no-unused-vars': ['off'],
    },
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'eslint.config.js',
      '**/vite.config.ts',
      'devvit.config.ts',
      'src/client/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'api/**/*.test.ts',
    ],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { js },
    extends: ['js/recommended'],
  },
]);
