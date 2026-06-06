// eslint.config.ts
// Use for: React + TypeScript projects using ESLint flat config (v9+)
// Key: uses `strictTypeChecked` + `parserOptions.projectService` for full type-aware linting.
// Replace plugin imports to match your actual installed packages.

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
// If using vitest (native flat config, no FlatCompat needed):
// import vitest from 'eslint-plugin-vitest'
// If using jest (v29+ ships native flat config, no FlatCompat needed):
// import jest from 'eslint-plugin-jest'

export default defineConfig([
  // --- Global ignores (replaces .eslintignore) ---
  globalIgnores([
    'dist',
    'build',
    'coverage',
    '.vite',
    '**/*.gen.ts',     // generated files
    '**/*.d.ts',       // declaration files
  ]),

  // --- Source files: TypeScript + React ---
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      // strictTypeChecked = recommended + strict + ALL type-aware lint rules.
      // Requires parserOptions.projectService below — without it, type-aware
      // rules are silently disabled. This was the primary gap in portfolio_v2.
      tseslint.configs.strictTypeChecked,
      // stylisticTypeChecked adds formatting-adjacent TS rules (optional)
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        // projectService: true → auto-discovers tsconfig.json per file.
        // More efficient than `project: ['./tsconfig.app.json']`.
        // CRITICAL: without this, all type-aware rules are disabled.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // RULE: Never downgrade to "warn" — fix or disable with a comment.
      // Warnings are silent tech debt that accumulate and never get fixed.

      // Prefer type imports for better tree-shaking / circular dep safety
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // void-returning arrow callbacks are fine in event handlers
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // Allow `_` prefix to suppress unused variable lint
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // --- Test files (relaxed rules) ---
  {
    files: ['**/*.{spec,test}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    // Uncomment whichever test framework you use:
    // extends: [vitest.configs.recommended],
    // extends: [jest.configs['flat/recommended']],  // no FlatCompat needed in jest v29+
    languageOptions: {
      globals: {
        ...globals.node,                             // process, __dirname, etc.
      },
    },
    rules: {
      // Test files legitimately use `any` for mocks and non-null assertions
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // --- Node / config scripts ---
  {
    files: ['*.config.{js,ts,mjs,mts}', 'scripts/**/*.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Config files often use require() or dynamic imports
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
])
