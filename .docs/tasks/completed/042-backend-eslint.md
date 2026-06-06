# 042 — Add ESLint flat config with `strictTypeChecked` to backend

> **Depends on**: [040-backend-convert-to-typescript](040-backend-convert-to-typescript.md), [041-backend-tsconfig](041-backend-tsconfig.md)
> **Blocks**: none
> **Parallel-safe with**: [044-frontend-eslint](044-frontend-eslint.md)

## Objective

Add `backend/eslint.config.mjs` using ESLint flat config format with `@typescript-eslint/eslint-plugin`'s `strictTypeChecked` preset, so `npm run lint` enforces strict type-aware linting.

## Approach

Use ESLint v9+ flat config. Install `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`. The `strictTypeChecked` config requires `parserOptions.project: true` (or a project path), which enables type-aware rules backed by `tsconfig.json`.

---

## Steps

### 1. Install ESLint dependencies  <!-- agent: general-purpose -->

File: `backend/package.json`

- [ ] Add to `"devDependencies"`:
  ```json
  "eslint": "^9.0.0",
  "@typescript-eslint/eslint-plugin": "^8.0.0",
  "@typescript-eslint/parser": "^8.0.0"
  ```
- [ ] Run `cd backend && npm install`

### 2. Create `backend/eslint.config.mjs`  <!-- agent: general-purpose -->

Create file `backend/eslint.config.mjs`:

```js
// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Ignore build output and deps
    ignores: ['dist/**', 'node_modules/**'],
  },
);
```

- [ ] Write `backend/eslint.config.mjs` with the content above
- [ ] Note: `typescript-eslint` v8+ exports a unified `tseslint` object. If the installed version uses the older split-package API (`@typescript-eslint/eslint-plugin` separately), adjust the import accordingly:
  ```js
  import eslint from '@eslint/js';
  import tseslint from 'typescript-eslint';
  export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    { languageOptions: { parserOptions: { project: true } } },
    { ignores: ['dist/**', 'node_modules/**'] },
  );
  ```

### 3. Add `lint` script to `backend/package.json`  <!-- agent: general-purpose -->

File: `backend/package.json`

- [ ] Add `"lint": "eslint ."` to the `"scripts"` object

### 4. Run lint and fix issues  <!-- agent: general-purpose -->

- [ ] Run `cd backend && npm run lint 2>&1 | head -50`
- [ ] Fix any `error`-level findings (warnings may be deferred)
  - Common `strictTypeChecked` errors to expect:
    - `@typescript-eslint/no-unsafe-assignment` — type `any` spreading; add explicit types
    - `@typescript-eslint/no-explicit-any` — replace with `unknown` where appropriate
    - `@typescript-eslint/restrict-template-expressions` — template literal with non-string; cast or use `.toString()`
  - Suppress only if genuinely unavoidable, using inline `// eslint-disable-next-line`

### 5. Verification  <!-- agent: general-purpose -->

- [ ] `cd backend && npm run lint` exits 0 with no errors (warnings are acceptable)
- [ ] `backend/eslint.config.mjs` exists

---
**UAT**: [`.docs/uat/completed/042-backend-eslint.uat.md`](../uat/completed/042-backend-eslint.uat.md)
