# UAT: Add `backend/tsconfig.json` with strict NodeNext config

> **Source task**: [`.docs/tasks/041-backend-tsconfig.md`](../tasks/041-backend-tsconfig.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Repository cloned and working directory is the repo root
- [ ] Node.js >= 18 installed (`node --version`)
- [ ] `backend/` directory exists (task 035 completed)
- [ ] `backend/node_modules/` populated — run `cd backend && npm install` if not present

---

## Config File Tests

### UAT-CFG-001: `backend/tsconfig.json` exists
- **Description**: Verify the tsconfig file was created at the correct path
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  test -f backend/tsconfig.json && echo "EXISTS" || echo "MISSING"
  ```
- **Expected Result**: Output is `EXISTS`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-002: `compilerOptions.module` is `NodeNext`
- **Description**: Verify the `module` compiler option is set to `NodeNext` (required for ESM + Node)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node -e "const c=JSON.parse(require('fs').readFileSync('backend/tsconfig.json','utf8')); console.log(c.compilerOptions.module)"
  ```
- **Expected Result**: Output is `NodeNext`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-003: `compilerOptions.moduleResolution` is `NodeNext`
- **Description**: Verify module resolution is also `NodeNext` (must match `module`)
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node -e "const c=JSON.parse(require('fs').readFileSync('backend/tsconfig.json','utf8')); console.log(c.compilerOptions.moduleResolution)"
  ```
- **Expected Result**: Output is `NodeNext`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-004: `compilerOptions.target` is `ES2022`
- **Description**: Verify the compilation target is `ES2022`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node -e "const c=JSON.parse(require('fs').readFileSync('backend/tsconfig.json','utf8')); console.log(c.compilerOptions.target)"
  ```
- **Expected Result**: Output is `ES2022`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-005: `compilerOptions.strict` is `true`
- **Description**: Verify full strict mode is enabled
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node -e "const c=JSON.parse(require('fs').readFileSync('backend/tsconfig.json','utf8')); console.log(c.compilerOptions.strict)"
  ```
- **Expected Result**: Output is `true`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-006: Additional strict flags are all `true`
- **Description**: Verify `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `noPropertyAccessFromIndexSignature` are all enabled
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node -e "const o=JSON.parse(require('fs').readFileSync('backend/tsconfig.json','utf8')).compilerOptions; console.log(JSON.stringify({noUncheckedIndexedAccess:o.noUncheckedIndexedAccess,exactOptionalPropertyTypes:o.exactOptionalPropertyTypes,noImplicitOverride:o.noImplicitOverride,noPropertyAccessFromIndexSignature:o.noPropertyAccessFromIndexSignature}))"
  ```
- **Expected Result**: `{"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true,"noImplicitOverride":true,"noPropertyAccessFromIndexSignature":true}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-007: Output and source map flags are set correctly
- **Description**: Verify `outDir`, `rootDir`, `declaration`, `declarationMap`, `sourceMap`, `forceConsistentCasingInFileNames`, `skipLibCheck`, and `esModuleInterop` are configured per spec
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node -e "const o=JSON.parse(require('fs').readFileSync('backend/tsconfig.json','utf8')).compilerOptions; console.log(JSON.stringify({outDir:o.outDir,rootDir:o.rootDir,declaration:o.declaration,declarationMap:o.declarationMap,sourceMap:o.sourceMap,forceConsistentCasingInFileNames:o.forceConsistentCasingInFileNames,skipLibCheck:o.skipLibCheck,esModuleInterop:o.esModuleInterop}))"
  ```
- **Expected Result**: `{"outDir":"dist","rootDir":".","declaration":true,"declarationMap":true,"sourceMap":true,"forceConsistentCasingInFileNames":true,"skipLibCheck":true,"esModuleInterop":false}`
- [x] Pass <!-- 2026-06-06 -->

### UAT-CFG-008: `include` targets only TypeScript files; `exclude` omits `node_modules` and `dist`
- **Description**: Verify `include` is `["*.ts"]` and `exclude` contains `node_modules` and `dist`
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  node -e "const c=JSON.parse(require('fs').readFileSync('backend/tsconfig.json','utf8')); console.log(JSON.stringify({include:c.include,exclude:c.exclude}))"
  ```
- **Expected Result**: `{"include":["*.ts"],"exclude":["node_modules","dist"]}`
- [x] Pass <!-- 2026-06-06 -->

---

## TypeScript Config Parse Tests

### UAT-TSC-001: `tsc --noEmit` produces no config parse errors
- **Description**: Verify `tsc` can parse `backend/tsconfig.json` without `TS5023` (unknown option) or `TS6046` (invalid value) errors. Type errors in `.js` source files are expected if task 040 is not yet complete and do not count as failures here.
- **Steps**:
  1. Run the command below from the repo root
  2. Review the output: any line containing `error TS5023` or `error TS6046` is a config parse error and a failure
- **Command**:
  ```bash
  cd backend && npx tsc --noEmit 2>&1 | grep -E 'error TS(5023|6046)' || echo "No config parse errors"
  ```
- **Expected Result**: Output is `No config parse errors` (the grep finds nothing and the fallback prints the success message)
- [x] Pass <!-- 2026-06-06 -->

---

## `.gitignore` Tests

### UAT-GIT-001: `backend/.gitignore` exists and contains `dist/`
- **Description**: Verify the backend gitignore was created and excludes the compiled output directory
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -q '^dist/' backend/.gitignore && echo "FOUND" || echo "MISSING"
  ```
- **Expected Result**: Output is `FOUND`
- [x] Pass <!-- 2026-06-06 -->

### UAT-GIT-002: `backend/.gitignore` contains `node_modules/`
- **Description**: Verify `node_modules/` is excluded in the backend gitignore
- **Steps**:
  1. Run the command below
- **Command**:
  ```bash
  grep -q '^node_modules/' backend/.gitignore && echo "FOUND" || echo "MISSING"
  ```
- **Expected Result**: Output is `FOUND`
- [x] Pass <!-- 2026-06-06 -->
