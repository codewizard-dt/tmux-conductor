# 038 — Update backend to load `.env` from repo root

> **Depends on**: [035-move-server-to-backend](035-move-server-to-backend.md), [037-create-root-env](037-create-root-env.md)
> **Blocks**: none
> **Parallel-safe with**: [039-frontend-root-env](039-frontend-root-env.md)

## Objective

Fix `backend/index.js` to load dotenv from the repo root (two levels up from the backend package), add `dotenv` to `backend/package.json` dependencies (it is currently imported but missing from deps), and run `npm install` to update `package-lock.json`.

## Approach

The current `index.js` loads `.env` from `path.join(__dirname, '.env')` which is broken in ESM (`__dirname` is undefined). The correct ESM pattern uses `fileURLToPath(import.meta.url)` to resolve paths. After the move to `backend/`, the repo root is one level up (`../`), so `dotenv.config({ path: new URL('../.env', import.meta.url) })` resolves correctly.

---

## Steps

### 1. Add `dotenv` to `backend/package.json`  <!-- agent: general-purpose -->

File: `backend/package.json`

- [ ] Add `"dotenv": "^16.0.0"` (or latest stable) to the `"dependencies"` object
- [ ] Run `cd backend && npm install` to update `package-lock.json`

### 2. Fix dotenv loading in `backend/index.js`  <!-- agent: general-purpose -->

File: `backend/index.js`

Current code (lines ~12–16):
```js
const envPath = path.join(__dirname, '.env');
const envPathMeta = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
console.log('envPath', envPath);
console.log('envPathMeta', envPathMeta);
dotenv.config({ path: envPath });
```

- [ ] Replace the four lines above with a single call loading from the repo root:
  ```js
  dotenv.config({ path: new URL('../.env', import.meta.url) });
  ```
- [ ] Remove the now-unused `import path from 'path'` if `path` is no longer referenced elsewhere in the file
  - Verify: search `index.js` for other uses of `path.` before removing the import
- [ ] Remove the debug `console.log` lines for `envPath` and `envPathMeta`

### 3. Verification  <!-- agent: general-purpose -->

- [ ] `backend/package.json` lists `dotenv` under `dependencies`
- [ ] `backend/index.js` calls `dotenv.config({ path: new URL('../.env', import.meta.url) })`
- [ ] No `__dirname` references remain in `backend/index.js`
- [ ] `cd backend && node --check index.js` exits 0 (syntax check passes)

---
**UAT**: pending
