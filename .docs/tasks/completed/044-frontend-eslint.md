# 044 — Add ESLint flat config with `strictTypeChecked` + React plugin to frontend

> **Depends on**: [043-frontend-tsconfig-strict](completed/043-frontend-tsconfig-strict.md)
> **Blocks**: none
> **Parallel-safe with**: [042-backend-eslint](042-backend-eslint.md)

## Objective

Add `frontend/eslint.config.mjs` using ESLint v9+ flat config format with `typescript-eslint`'s `strictTypeChecked` preset and `eslint-plugin-react` (plus `eslint-plugin-react-hooks`), so `npm run lint` enforces strict type-aware linting across all Astro, TypeScript, and React source files.

## Approach

Use ESLint v9+ flat config. Install `typescript-eslint`, `eslint-plugin-react`, and `eslint-plugin-react-hooks`. The `strictTypeChecked` config requires `parserOptions.project: true`, which enables type-aware rules backed by `tsconfig.json`. Astro files are handled by `@astrojs/eslint-plugin` (or excluded) — scope linting to `.ts` and `.tsx` files only to avoid needing the Astro ESLint parser as a separate dependency.

---

## Steps

### 1. Install ESLint dependencies  <!-- agent: general-purpose -->

File: `frontend/package.json`

- [ ] Add to `"devDependencies"`:
  ```json
  "eslint": "^9.0.0",
  "typescript-eslint": "^8.0.0",
  "eslint-plugin-react": "^7.37.0",
  "eslint-plugin-react-hooks": "^5.0.0"
  ```
  - `typescript-eslint` v8+ is the unified package (replaces the old split `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser`)
  - `eslint-plugin-react-hooks` v5+ supports ESLint v9 flat config natively
- [ ] Run `cd frontend && npm install`

### 2. Create `frontend/eslint.config.mjs`  <!-- agent: general-purpose -->

Create file `frontend/eslint.config.mjs`:

```js
// @ts-check
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Apply strictTypeChecked to TS/TSX files only (skip .astro — no Astro parser installed)
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [...tseslint.configs.strictTypeChecked],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // React 19 / new JSX transform — no need to import React in scope
      'react/react-in-jsx-scope': 'off',
    },
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // Ignore build output, generated files, and deps
    ignores: ['dist/**', 'node_modules/**', '.astro/**'],
  },
);
```

- [ ] Write `frontend/eslint.config.mjs` with the content above
- [ ] Note: if `eslint-plugin-react-hooks` v5 doesn't export a flat `configs.recommended`, use the v4 rules spread directly:
  ```js
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  }
  ```

### 3. Add `lint` script to `frontend/package.json`  <!-- agent: general-purpose -->

File: `frontend/package.json`

- [ ] Add `"lint": "eslint ."` to the `"scripts"` object
  - Final scripts block should include: `"dev"`, `"build"`, `"preview"`, `"astro"`, `"lint"`

### 4. Run lint and fix issues  <!-- agent: general-purpose -->

- [ ] Run `cd frontend && npm run lint 2>&1 | head -80`
- [ ] Fix any `error`-level findings (warnings may be deferred)
  - Common `strictTypeChecked` errors to expect:
    - `@typescript-eslint/no-unsafe-assignment` — type `any` spreading; add explicit types
    - `@typescript-eslint/no-explicit-any` — replace with `unknown` where appropriate
    - `@typescript-eslint/restrict-template-expressions` — template literal with non-string; cast or use `.toString()`
    - `react-hooks/exhaustive-deps` — missing dependency in `useEffect`/`useCallback`; add the missing dep
    - `react/prop-types` — disable this rule (TypeScript handles prop types):
      Add `'react/prop-types': 'off'` to the rules block in `eslint.config.mjs`
  - Suppress only if genuinely unavoidable, using inline `// eslint-disable-next-line`

### 5. Verification  <!-- agent: general-purpose -->

- [ ] `cd frontend && npm run lint` exits 0 with no errors (warnings are acceptable)
- [ ] `frontend/eslint.config.mjs` exists
- [ ] `frontend/package.json` contains a `"lint"` script

---
**UAT**: [`.docs/uat/completed/044-frontend-eslint.uat.md`](../uat/completed/044-frontend-eslint.uat.md)
