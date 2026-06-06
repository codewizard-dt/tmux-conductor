# 043 — Update `frontend/tsconfig.json` with full strict flags

> **Depends on**: [036-move-ui-to-frontend](036-move-ui-to-frontend.md)
> **Blocks**: none
> **Parallel-safe with**: [040-backend-convert-to-typescript](040-backend-convert-to-typescript.md), [041-backend-tsconfig](041-backend-tsconfig.md)

## Objective

Update `frontend/tsconfig.json` (which already extends `astro/tsconfigs/strict`) to layer additional strict TypeScript flags on top of the Astro base config.

## Approach

The current `frontend/tsconfig.json` is minimal — it only extends `astro/tsconfigs/strict`. We need to add a `compilerOptions` block with extra strict flags that the Astro base doesn't include: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `noPropertyAccessFromIndexSignature`.

---

## Steps

### 1. Update `frontend/tsconfig.json`  <!-- agent: general-purpose -->

File: `frontend/tsconfig.json`

Current content:
```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

Replace with:
```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true
  },
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] Update `frontend/tsconfig.json` with the new `compilerOptions` block

### 2. Fix any type errors introduced by stricter flags  <!-- agent: general-purpose -->

- [ ] Run `cd frontend && npx tsc --noEmit 2>&1 | head -50` to surface type errors
- [ ] For `noUncheckedIndexedAccess` violations: add `?? defaultValue` or null checks where array/object access is assumed non-null
- [ ] For `exactOptionalPropertyTypes` violations: use `undefined` explicitly instead of omitting optional properties in object spreads
- [ ] Fix all type errors — stricter flags should produce zero errors

### 3. Verification  <!-- agent: general-purpose -->

- [ ] `frontend/tsconfig.json` contains the four new `compilerOptions` flags
- [ ] `cd frontend && npx tsc --noEmit` exits 0

---
**UAT**: [`.docs/uat/043-frontend-tsconfig-strict.uat.md`](../uat/043-frontend-tsconfig-strict.uat.md)
