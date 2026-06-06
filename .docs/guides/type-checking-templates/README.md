# Type-Checking & Linting Config Templates

Best-practice templates synthesized from analysis of all configs across ~/Repositories. Each template includes inline annotations explaining every non-obvious decision.

---

## Templates

| File | When to use |
|------|-------------|
| `tsconfig/tsconfig.node-esm.jsonc` | Node.js service, CLI, or MCP server using native ESM |
| `tsconfig/tsconfig.vite-root.json` | Vite project root (solution coordinator — no compilation) |
| `tsconfig/tsconfig.app.jsonc` | Vite + React app (browser code) |
| `tsconfig/tsconfig.node.jsonc` | Vite config file compilation (`vite.config.ts`) |
| `tsconfig/tsconfig.lib.jsonc` | React/TS library that emits `.d.ts` for npm |
| `python/pyproject.toml` | Python project: mypy + basedpyright + ruff + pytest + coverage |
| `python/mypy.ini` | Standalone mypy config (use when `pyproject.toml` is owned by another tool) |
| `python/pyrightconfig.json` | Pyright / basedpyright standalone config |
| `eslint/eslint.config.ts` | ESLint flat config for React + TypeScript |

---

## Key Best Practices by Config Type

### TypeScript (`tsconfig.json`)

**Module system — pick the right pair:**
| Project type | `module` | `moduleResolution` |
|---|---|---|
| Node.js native ESM | `NodeNext` | `NodeNext` |
| Vite / bundled app | `ESNext` | `bundler` |
| Next.js | `ESNext` | `bundler` |

Never mix `module: ESNext` with `moduleResolution: node` — they are semantically incompatible.

**Strictness — go beyond `strict: true`:**
```jsonc
"strict": true,                       // enables 8 base flags
"noUncheckedIndexedAccess": true,     // highest-value add-on; catches array/dict access bugs
"noImplicitReturns": true,
"noFallthroughCasesInSwitch": true,
"noImplicitOverride": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"verbatimModuleSyntax": true          // TS 5.0+; prevents silent import bugs
```

**Vite projects — always use the three-file split:**
- Root `tsconfig.json` — `"files": []` + `"references"` only (no compilation of its own)
- `tsconfig.app.json` — browser libs, `noEmit: true`, `moduleResolution: bundler`
- `tsconfig.node.json` — Node libs, `noEmit: true`, covers only `vite.config.ts`

**Anti-patterns observed in the wild:**
- `module: ESNext` + `moduleResolution: node` — broken module resolution
- `target: es5` in 2024+ projects — unnecessary transpilation overhead
- `jsx: "react"` in modern code — use `"react-jsx"` (React 17+ automatic transform)
- `allowJs: true` without `checkJs: true` — JS files silently bypass type checking
- Keeping the tsc-generated comment template — adds noise, hides real config

---

### Python type checking (`pyproject.toml` / `mypy.ini`)

**mypy:**
- Always use `strict = true` — never approximate it with manual flag enumeration
- Use `[[tool.mypy.overrides]]` per-module instead of global `ignore_missing_imports = true`
- Never use `ignore_errors = true` on a whole module — it silences real bugs; use `ignore_missing_imports = true` only
- Always set `files` or `exclude` to prevent crawling `.venv`, `dist`, etc.
- Enable `pydantic.mypy` plugin in any Pydantic project
- Enable `sqlalchemy.ext.mypy.plugin` if using SQLAlchemy ORM

**ruff (replaces flake8 / isort / black):**
Minimum rule set: `E, W, F, I, B, UP`  
Recommended rule set: `E, W, F, I, N, UP, B, C4, SIM, RUF`  
Add `C90` (mccabe) for complex control-flow codebases (agent loops, etc.)

**basedpyright companion pattern:**
Run basedpyright alongside mypy with `typeCheckingMode = "off"` — opt in only to rules mypy currently lacks (notably `reportTypedDictNotRequiredAccess` for mypy gap #9408). Prevents double-reporting.

**Anti-patterns observed in the wild:**
- `ignore_errors = true` on internal modules — silences real type errors, not just stub gaps
- `cryptwiz_py`: manually approximating strict mode without `strict = true`, leaving gaps
- Missing `[tool.ruff.lint.isort]` `known-first-party` — isort can't distinguish first-party vs third-party without it
- `sales-agent`: no pydantic.mypy plugin despite heavy Pydantic usage

---

### ESLint (flat config)

- Use `tseslint.configs.strictTypeChecked` + `parserOptions.projectService: true` for full type-aware linting
- Never downgrade errors to `"warn"` — either fix or disable with a comment
- Scope globals tightly: `globals.browser` only in browser files, `globals.node` only in Node/config files
- Use a separate config block for test files
- Eliminate `FlatCompat` — all major plugins now ship native flat config support
- Let the TypeScript parser handle `ecmaVersion`; do not hard-code it

**Anti-patterns observed in the wild:**
- `portfolio_v2`: missing `parserOptions.projectService` — all type-aware lint rules silently disabled
- `openemr`: `FlatCompat` bridge for jest — use `jest.configs['flat/recommended']` instead
- `openemr`: `no-undef`, `no-unused-vars`, `no-redeclare` set to `"warn"` — silent tech debt

---

### pyrightconfig.json

- Always set `typeCheckingMode` explicitly — the default is `"off"`, meaning no type checking
- `reportMissingImports` should always be `"error"`
- `"standard"` is a safe project-wide floor; use per-file suppressions for legacy code

**Anti-patterns observed in the wild:**
- Neither `openemr` nor `cryptwiz_py` set `typeCheckingMode` — Pyright defaulted to `"off"` and did nothing
- `reportMissingImports: "warning"` — broken imports should always be errors
