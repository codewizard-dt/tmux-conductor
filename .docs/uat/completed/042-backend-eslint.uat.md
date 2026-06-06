# UAT: Add ESLint flat config with `strictTypeChecked` to backend

> **Source task**: [`.docs/tasks/completed/042-backend-eslint.md`](../tasks/completed/042-backend-eslint.md)
> **Generated**: 2026-06-06

---

## Prerequisites

- [ ] Node.js >= 18 installed
- [ ] Working directory is the repo root (`tmux-conductor/`)
- [ ] `backend/node_modules` is populated — run `cd backend && npm install` if not

---

## Script / Config Tests

### UAT-SCRIPT-001: ESLint config file exists with flat config format

- **File**: `backend/eslint.config.mjs`
- **Description**: Verify the ESLint flat config file exists and is wired to the `typescript-eslint` `strictTypeChecked` preset
- **Steps**:
  1. Run the command below — it should print the file contents
- **Command**:
  ```bash
  node -e "import('./backend/eslint.config.mjs').then(m => { const cfg = JSON.stringify(m.default); if (!cfg) throw new Error('empty'); console.log('OK: config exported'); }).catch(e => { console.error('FAIL:', e.message); process.exit(1); })"
  ```
- **Expected Result**: Exits 0 and prints `OK: config exported` with no errors
- [x] Pass <!-- 2026-06-06 -->

### UAT-SCRIPT-002: ESLint config uses `strictTypeChecked` and `parserOptions.project`

- **File**: `backend/eslint.config.mjs`
- **Description**: Verify the config spreads `tseslint.configs.strictTypeChecked` and sets `parserOptions.project: true`
- **Steps**:
  1. Open `backend/eslint.config.mjs` and confirm:
     - `typescript-eslint` (or `tseslint`) is imported
     - `tseslint.configs.strictTypeChecked` is spread into the config array
     - `parserOptions: { project: true }` or `parserOptions: { project: true, tsconfigRootDir: import.meta.dirname }` is present
     - `ignores` includes `dist/**` and `node_modules/**`
  2. Run the command below to confirm key strings are present
- **Command**:
  ```bash
  node -e "const fs = await import('fs'); const src = fs.readFileSync('./backend/eslint.config.mjs', 'utf8'); const checks = ['strictTypeChecked', 'project: true', 'ignores']; const missing = checks.filter(c => !src.includes(c)); if (missing.length) { console.error('FAIL: missing', missing); process.exit(1); } console.log('OK: all required config strings present');" --input-type=module
  ```
- **Expected Result**: Exits 0 and prints `OK: all required config strings present`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SCRIPT-003: `backend/package.json` has lint script and ESLint dev dependencies

- **File**: `backend/package.json`
- **Description**: Verify the `lint` script and all three ESLint dev dependencies are declared
- **Steps**:
  1. Run the command below to parse `package.json` and assert required fields
- **Command**:
  ```bash
  node -e "const pkg = JSON.parse(require('fs').readFileSync('./backend/package.json','utf8')); const ok = [pkg.scripts?.lint === 'eslint .', 'eslint' in (pkg.devDependencies||{}), '@typescript-eslint/eslint-plugin' in (pkg.devDependencies||{}), '@typescript-eslint/parser' in (pkg.devDependencies||{})]; const labels=['scripts.lint=eslint .','eslint dep','@typescript-eslint/eslint-plugin dep','@typescript-eslint/parser dep']; const missing=labels.filter((_,i)=>!ok[i]); if(missing.length){console.error('FAIL: missing',missing);process.exit(1);}console.log('OK: package.json is correct');"
  ```
- **Expected Result**: Exits 0 and prints `OK: package.json is correct`
- [x] Pass <!-- 2026-06-06 -->

### UAT-SCRIPT-004: `npm run lint` exits 0 with no errors

- **Description**: The primary acceptance criterion — `eslint .` must complete with exit code 0 and produce no `error`-level findings against the backend TypeScript sources
- **Steps**:
  1. Run the command below from the repo root — it changes into the `backend/` directory and runs lint
- **Command**:
  ```bash
  cd backend && npm run lint
  ```
- **Expected Result**: Command exits 0. Output may include ESLint warnings but must contain zero lines with `error` severity. If any errors are reported, the task is not complete.
- [x] Pass <!-- 2026-06-06 -->

---

## Edge Case Tests

### UAT-EDGE-001: Lint ignores `dist/` and `node_modules/`

- **Scenario**: Build output and installed packages must not be linted (they would produce false positives or errors from third-party code)
- **Steps**:
  1. Confirm `dist/` and `node_modules/**` appear in the `ignores` array of `backend/eslint.config.mjs` (already checked in UAT-SCRIPT-002)
  2. Run lint and verify ESLint does not process `node_modules` files
- **Command**:
  ```bash
  cd backend && npm run lint -- --debug 2>&1 | grep -c 'node_modules' || true
  ```
- **Expected Result**: The `npm run lint` (UAT-SCRIPT-004) exits 0, confirming `node_modules` files do not cause lint errors. The debug grep count is informational only — what matters is exit 0 from lint itself.
- [x] Pass <!-- 2026-06-06 -->

### UAT-EDGE-002: Type-aware rules are active (parserOptions.project is honoured)

- **Scenario**: `strictTypeChecked` rules like `@typescript-eslint/no-unsafe-assignment` only fire when the TypeScript language service is connected via `parserOptions.project`. Verify they are active by checking that the rule is present in the resolved config.
- **Steps**:
  1. Run the command below to print active rule names and confirm at least one type-aware rule is listed
- **Command**:
  ```bash
  cd backend && npx eslint --print-config index.ts | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const rules=Object.keys(d.rules||{}); const typeAware=['@typescript-eslint/no-unsafe-assignment','@typescript-eslint/no-unsafe-call','@typescript-eslint/no-floating-promises']; const found=typeAware.filter(r=>rules.includes(r)); if(!found.length){console.error('FAIL: no type-aware rules found in resolved config');process.exit(1);}console.log('OK: type-aware rules active:', found.join(', '));"
  ```
- **Expected Result**: Exits 0 and prints `OK: type-aware rules active:` followed by one or more rule names such as `@typescript-eslint/no-unsafe-assignment`
- [x] Pass <!-- 2026-06-06 -->
