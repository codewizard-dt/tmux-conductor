---
description: Interactively configure Serena language servers
argument-hint: (no arguments)
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**

# /serena-config — Configure Serena language servers

Edit `.serena/project.yml` to configure which language servers Serena loads. Gather context (read current config + auto-detect) **before** prompting.

**CRITICAL ORDERING RULE**: Steps A and B (read + detect) MUST run before any `AskUserQuestion` call. Do not prompt until the summary has been printed.

---

## Step A — Read current `.serena/project.yml`

1. `Read` `.serena/project.yml` at the repo root.
2. If the file does not exist, abort with this exact message and stop:
   > Run the Serena MCP at least once to generate `.serena/project.yml`, then re-run `/serena-config`.
3. Parse the languages field. Accept either form:
   - Singular `language: <value>` — treat as a one-item list.
   - `languages:` YAML list — parse all entries.
   Record the parsed set as `CURRENT_LANGUAGES`. The write step will normalize to the `languages:` list form regardless of which form the file currently uses.

## Step B — Auto-detect candidate languages

Use `Glob` (or `mcp__serena__find_file`) to detect languages present in the repo. Map common file signals to Serena language identifiers (e.g. `*.py`/`pyproject.toml` → `python`, `*.ts`/`*.tsx`/`*.js`/`package.json` → `typescript`, `*.go`/`go.mod` → `go`, `*.rs`/`Cargo.toml` → `rust`, `*.sh`/`*.bash` → `bash`, `*.md` → `markdown`, `*.yml`/`*.yaml` → `yaml`, `*.toml` → `toml`, `*.tf` → `terraform`, etc.). Use judgment — the goal is a useful suggestion, not exhaustive matching.

Collect matches into `DETECTED_LANGUAGES`. Compute `SUGGESTED = DETECTED_LANGUAGES − CURRENT_LANGUAGES`.

For the full list of valid Serena language identifiers (to avoid writing an unsupported value), see https://oraios.github.io/serena/01-about/020_programming-languages.html or the `Language` enum in https://github.com/oraios/serena/blob/main/src/solidlsp/ls_config.py.

Print a plain-text summary to the user, e.g.:

```
Currently configured: bash
Detected in repo but not configured: typescript, markdown, yaml
```

If `SUGGESTED` is empty, just print the first line.

## Step C — Ask the user what to change

Issue **one** `AskUserQuestion` (single-select, `multiSelect: false`):

> Do you want to add or remove any languages?

Offer at least these options:
- `Add suggested` — only shown when `SUGGESTED` is non-empty; label it with the suggested languages, e.g. "Add typescript, markdown, yaml".
- `Add / remove custom` — user will supply a free-text list in the next prompt.
- `No changes` — abort without writing.

If the user picks `Add suggested`, set `FINAL = CURRENT_LANGUAGES ∪ SUGGESTED`.

If the user picks `Add / remove custom`, ask ONE follow-up `AskUserQuestion` with `multiSelect: false` and an `Other` free-text affordance, phrased:
> List languages to add and/or remove. Prefix removals with `-` (e.g. `python, markdown, -bash`).

Parse the reply: tokens without `-` are additions, tokens with `-` are removals. Compute `FINAL = (CURRENT_LANGUAGES ∪ ADDITIONS) − REMOVALS`.

If the user picks `No changes`, stop without writing.

If `FINAL` is empty, abort with:
> Refusing to write an empty language list. Re-run and keep at least one language.

If any token in `FINAL` is not a valid Serena identifier (per the linked reference), warn the user and abort rather than writing an unsupported value.

## Step D — Confirm and write

1. Show the proposed `FINAL` list (sorted alphabetically) and confirm via one final `AskUserQuestion` (`Yes, write the file` / `No, abort without writing`).
2. If confirmed, `Edit` `.serena/project.yml`:
   - If the file has a singular `language: <value>` line, replace it with a `languages:` block containing `FINAL` sorted alphabetically, one entry per line, indented `  - <lang>`.
   - If the file has an existing `languages:` block, replace the entire block (key + all list items) with the new sorted list. Preserve everything else in the file byte-for-byte.
3. Print:
   ```
   Updated .serena/project.yml — languages: [a, b, c]
   ```
4. Remind the user to restart the Serena MCP:
   ```
   Run `claude mcp restart serena` (or the equivalent for your Claude Code version) to pick up the new language list.
   ```
