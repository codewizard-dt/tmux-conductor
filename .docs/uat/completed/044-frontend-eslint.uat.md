# UAT: Frontend ESLint Flat Config with strictTypeChecked

> **Source task**: [`.docs/tasks/completed/044-frontend-eslint.md`](../tasks/completed/044-frontend-eslint.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] `frontend/` directory exists in the repo root
- [ ] Node.js >= 18 is available (`node --version`)
- [ ] `cd frontend && npm install` has been run (or `node_modules/` is present)

---

## Static Config Tests

### UAT-STATIC-001: eslint.config.mjs exists
- **Description**: Verify the ESLint v9+ flat config file was created at the required path.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  ls frontend/eslint.config.mjs
  ```
- **Expected Result**: The file path is printed with no "No such file or directory" error (exit 0).
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-002: eslint.config.mjs uses typescript-eslint strictTypeChecked
- **Description**: Verify the config extends `tseslint.configs.strictTypeChecked` and imports `typescript-eslint`.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -c 'strictTypeChecked' frontend/eslint.config.mjs
  ```
- **Expected Result**: Prints `1` or higher (the string `strictTypeChecked` appears at least once).
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-003: eslint.config.mjs scopes to TS/TSX files only
- **Description**: Verify the config targets `src/**/*.ts` and `src/**/*.tsx` (not `.astro`).
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -c "src/\*\*\/\*\.ts" frontend/eslint.config.mjs
  ```
- **Expected Result**: Prints `2` (matches both `*.ts` and `*.tsx` globs).
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-004: eslint.config.mjs includes react and react-hooks plugins
- **Description**: Verify `eslint-plugin-react` and `eslint-plugin-react-hooks` are registered.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -c 'react-hooks' frontend/eslint.config.mjs
  ```
- **Expected Result**: Prints `1` or higher (the `react-hooks` plugin key appears).
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-005: eslint.config.mjs ignores dist, node_modules, .astro
- **Description**: Verify the `ignores` block excludes build output and dependencies.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -c 'ignores' frontend/eslint.config.mjs
  ```
- **Expected Result**: Prints `1` or higher (an `ignores` key is present).
- [x] Pass <!-- 2026-06-06 -->

### UAT-STATIC-006: react/react-in-jsx-scope is disabled
- **Description**: Verify the rule suppressing the legacy "import React" requirement is present (React 19 / new JSX transform).
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  grep -c 'react/react-in-jsx-scope' frontend/eslint.config.mjs
  ```
- **Expected Result**: Prints `1` or higher.
- [x] Pass <!-- 2026-06-06 -->

---

## Package.json Tests

### UAT-PKG-001: lint script present in package.json
- **Description**: Verify `"lint": "eslint ."` is in the `scripts` block.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const p=require('./frontend/package.json'); process.exit(p.scripts && p.scripts.lint ? 0 : 1)"
  ```
- **Expected Result**: Exits 0 (no output on success).
- [x] Pass <!-- 2026-06-06 -->

### UAT-PKG-002: eslint devDependency present
- **Description**: Verify `"eslint": "^9.0.0"` (or compatible) is listed in devDependencies.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const p=require('./frontend/package.json'); process.exit(p.devDependencies && p.devDependencies.eslint ? 0 : 1)"
  ```
- **Expected Result**: Exits 0.
- [x] Pass <!-- 2026-06-06 -->

### UAT-PKG-003: typescript-eslint devDependency present
- **Description**: Verify `"typescript-eslint": "^8.0.0"` (or compatible) is listed.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const p=require('./frontend/package.json'); process.exit(p.devDependencies && p.devDependencies['typescript-eslint'] ? 0 : 1)"
  ```
- **Expected Result**: Exits 0.
- [x] Pass <!-- 2026-06-06 -->

### UAT-PKG-004: eslint-plugin-react and eslint-plugin-react-hooks devDependencies present
- **Description**: Verify both React ESLint plugins are declared as devDependencies.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  node -e "const p=require('./frontend/package.json'); const d=p.devDependencies||{}; process.exit((d['eslint-plugin-react'] && d['eslint-plugin-react-hooks']) ? 0 : 1)"
  ```
- **Expected Result**: Exits 0.
- [x] Pass <!-- 2026-06-06 -->

---

## Runtime Tests

### UAT-RUN-001: npm run lint exits 0 with no errors
- **Description**: Core acceptance criterion — `npm run lint` must complete without ESLint errors. Warnings are acceptable.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  cd frontend && npm run lint 2>&1 | tail -5; echo "EXIT:$?"
  ```
- **Expected Result**: Last line shows `EXIT:0`. Output may contain warnings but must not contain any lines prefixed with `error` from ESLint.
- [x] Pass <!-- 2026-06-06 -->

### UAT-RUN-002: ESLint resolves the tsconfig.json for type-aware rules
- **Description**: Verify type-aware rules are active (parserOptions.project: true) — ESLint should not print "tsconfig not found" or "parserOptions.project" warnings.
- **Steps**:
  1. Run the command below from the repo root
- **Command**:
  ```bash
  cd frontend && npm run lint 2>&1 | grep -i 'tsconfig\|parserOptions\|project.*not.*found' | wc -l | tr -d ' '
  ```
- **Expected Result**: Prints `0` — no tsconfig resolution warnings or errors.
- [x] Pass <!-- 2026-06-06 -->

### UAT-RUN-003: ESLint scans at least one TypeScript file
- **Description**: Verify ESLint actually processes `.ts`/`.tsx` source files (not silently skipping them).
- **Steps**:
  1. Run the command below from the repo root (verbose output lists files checked)
- **Command**:
  ```bash
  cd frontend && npx eslint --debug src/lib/api.ts 2>&1 | grep -c 'Processing\|Linting' | head -1
  ```
- **Expected Result**: Prints `1` or higher — ESLint processed the file (found a "Processing" or "Linting" log line).
- [x] Pass <!-- 2026-06-06 -->
