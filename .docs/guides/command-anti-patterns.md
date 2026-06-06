# command-anti-patterns.md

**Purpose**: Shell-command and file-operation hygiene rules for AI agents running verification, setup, and one-off tasks.

---

## TOP RULE — One command, one job

Every shell invocation should do exactly one thing.

Do NOT chain `A && B && C && D` just because all must succeed — run them as separate invocations so (a) each is independently re-runnable, (b) approval prompts aren't ganged, (c) failures pinpoint the offending step.

**Bad** (real incident that triggered this guide):
```bash
SCRATCH=$(mktemp -d) && echo "SCRATCH=$SCRATCH" && mkdir -p "$SCRATCH" && /path/sync-docs-scaffold.sh "$SCRATCH" && echo "---SCRATCH_PATH---" && echo "$SCRATCH" > /tmp/scratch_path.txt && cat /tmp/scratch_path.txt
```

**Good**: one `mkdir -p ./tmp/scratch`, then one `./sync-docs-scaffold.sh ./tmp/scratch`, then one `mcp__serena__list_dir relative_path="tmp/scratch/.docs" recursive=true`

---

## Prefer project-local scratch (`./tmp/`) over `/tmp/` or `$(mktemp -d)`

Rule: when a script needs a scratch directory, create `./tmp/<purpose>/` inside the project root and add `tmp/` to `.gitignore` if not already present.

Why: project-local paths are (a) visible to MCP Serena (which is project-scoped), (b) inspectable without leaving the project tree, (c) deleted by a single `rm -rf ./tmp/<purpose>` that is obviously safe.

`/tmp/` and `mktemp -d` paths live outside Serena's project scope, force shell-based inspection, and accumulate if not cleaned.

```bash
mkdir -p ./tmp/scratch
./sync-docs-scaffold.sh ./tmp/scratch
```
(two invocations, both single-purpose)

---

## No intermediate `echo` progress banners

Banners like `echo "---SCRATCH_PATH---"` or `echo "===== API-2 DONE ====="` add no information the tool result doesn't already convey and clutter the transcript.

Read the command's actual output; do not wrap it in decorative banners.

---

## No temp-file round-trips

Anti-pattern: `echo "$X" > /tmp/foo && cat /tmp/foo` just to surface a value.

Rule: if you need the value, print it directly (`echo "$X"`); if it's already known to the agent, don't surface it at all.

---

## Classic shell footguns

- `cat file | grep pattern` — use `grep pattern file` (or the `Grep` tool, or `mcp__serena__search_for_pattern`)
- `ls | grep foo` — parse-ls is broken on filenames with spaces/newlines; use a glob or `mcp__serena__find_file`
- `rm -rf $var` — always quote: `rm -rf "$var"`, and guard against empty: `[ -n "$var" ] && rm -rf "$var"`
- Unquoted `$var` in paths/arguments — always double-quote unless you specifically want word-splitting
- Missing `set -euo pipefail` at the top of any `bash` script — every new helper script must include it (`sync-docs-scaffold.sh`, `bootstrap-serena.sh` are precedent)

---

## Verification belongs to the right phase

`/tackle` verification = **static gates only**: `bash -n <script>`, `pnpm typecheck`, `mypy`, lint, unit tests. Any command that produces deterministic pass/fail text without executing runtime behavior or touching the live filesystem beyond reading it.

**NOT** allowed in `/tackle` verification: running the script against a scratch dir, creating temp dirs, rsync dry-runs, curl calls, spawning servers, seeding fixtures, asserting on output contents.

Everything above belongs in **UAT** (`/uat-generate` → `/uat-walk` / `/uat-auto`). UAT is the phase designed for end-to-end runtime verification.

Rule of thumb: if the verification step needs more than one command, or creates any file, or reads any file's contents — move it to UAT.

---

## See also

- [`mcp-tools.md`](./mcp-tools.md) — Common anti-patterns: the MCP-tool side (no `sed`/`cat`/`ls`/`grep` on files)
- [`task-lifecycle.md`](./task-lifecycle.md) — The `/tackle` vs UAT flow
