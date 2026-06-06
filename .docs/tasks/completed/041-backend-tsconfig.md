# 041 — Add `backend/tsconfig.json` with strict NodeNext config

> **Depends on**: [035-move-server-to-backend](035-move-server-to-backend.md)
> **Blocks**: none
> **Parallel-safe with**: [040-backend-convert-to-typescript](040-backend-convert-to-typescript.md), [043-frontend-tsconfig-strict](043-frontend-tsconfig-strict.md)

## Objective

Create `backend/tsconfig.json` with `NodeNext`/`NodeNext` module resolution and full strict flags, matching the roadmap requirement for a proper TypeScript backend.

## Approach

The backend is pure ESM (`"type": "module"` in `package.json`), so the correct tsconfig uses `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`. This also requires all import paths to end in `.js` (the compiled extension), which NodeNext enforces at the type-checking layer. Full strict mode includes `strict: true` plus additional `noUnchecked*` flags.

---

## Steps

### 1. Create `backend/tsconfig.json`  <!-- agent: general-purpose -->

Create file `backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "esModuleInterop": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [x] Write `backend/tsconfig.json` with the content above

### 2. Verify `tsconfig.json` is valid  <!-- agent: general-purpose -->

- [x] Run `cd backend && npx tsc --noEmit 2>&1 | head -20` to check for parse errors in the config
  - Config parse errors appear as `error TS5023` or `error TS6046` — fix any flagged options
  - Type errors in source files are expected at this stage if task 040 is not yet complete; only config errors are a blocker here

### 3. Add `.gitignore` entry for `dist/`  <!-- agent: general-purpose -->

File: `backend/.gitignore` (create if it does not exist)

- [x] Ensure `dist/` is listed in `backend/.gitignore`
- [x] Ensure `node_modules/` is listed

---
**UAT**: [`.docs/uat/041-backend-tsconfig.uat.md`](../uat/041-backend-tsconfig.uat.md)
