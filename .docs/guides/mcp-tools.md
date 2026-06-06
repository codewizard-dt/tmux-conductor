# MCP Tools Guide

**Purpose**: Mandatory MCP tool usage rules for AI agents

---

## ⚠️ TOP RULE — READ FIRST

**NEVER use `sed`, `awk`, `perl -i`, `echo >>`, or any other shell command to edit a file.** This applies to **every** file type — code, markdown, JSON, YAML, `.env`, anything. The fact that markdown is allowed to use standard tools means use the **`Edit`** and **`Write`** tools, **NOT** `sed`.

If you find yourself reaching for `sed -i` to flip task checkboxes, update a status line, replace a string in a config file, or do "just a quick fix" to a doc — **stop**. Use the `Edit` tool. If you have many similar replacements in one file, use `Edit` with `replace_all: true` or call `Edit` multiple times. The `Edit` tool is always the right answer.

The shell is for running programs (`pnpm test`, `git mv`, `curl`), not for inspecting or modifying files.

---

## MANDATORY: MCP Tool Requirements

These MCP servers are **REQUIRED** for all applicable operations. Using standard tools when an MCP tool exists is a violation of project rules.

| MCP Server | Mandatory For | Replaces |
|------------|--------------|----------|
| **Serena** | All **code** exploration and editing; **all** file/directory exploration and search (code, markdown, config, anything) | `Read`, `Edit`, `Write`, `Grep`, `Glob` (for code files); `bash` exploration commands (`ls`, `cat`, `find`, `grep`, `sed`, `awk`, `head`, `tail`, `tree`) for **any** file type |
| **Context7** | All library/framework documentation lookups | WebSearch, WebFetch (for library docs) |
| **Brave Search** | All general web research | WebSearch (for non-library topics) |
| **Playwright** | Browser automation, screenshots, UI interaction | WebFetch (for rendered pages) |

### Standard tools (`Read`, `Edit`, `Write`) are permitted for:

- **Markdown files** (`.md`) — content edits use standard tools (Serena's symbolic editor doesn't apply to prose)
- **Config files** — JSON, YAML, TOML, `.env`, `.gitignore`, `package.json`, etc.
- **Creating brand-new files** of any type
- **Binary files and images** (read only)

### Standard tools are NEVER permitted for:

- **Code files** — TypeScript, JavaScript, Python, Go, Rust, etc. Always use Serena's symbolic or file/line tools.
- **File or directory exploration of any kind**, regardless of file type. This includes:
  - Listing directories → use `mcp__serena__list_dir`, **never** `ls` / `tree` / `find -type d`
  - Finding files by name → use `mcp__serena__find_file`, **never** `find -name` / `ls | grep`
  - Searching file contents → use `mcp__serena__search_for_pattern` or the `Grep` tool, **never** `grep` / `rg` / `ag` invoked through `bash`
  - Reading file contents for inspection → use `mcp__serena__get_symbols_overview` (code) or `Read` (markdown/config), **never** `cat` / `head` / `tail`
  - Editing via shell → **never** `sed` / `awk` / `echo >>`

The rule of thumb: **the shell is for running programs, not for inspecting or modifying files.** Even on a markdown file, do not `cat README.md` — use `Read`. Do not `grep -r foo .docs/` — use `mcp__serena__search_for_pattern` or the `Grep` tool.

### Common anti-patterns and their fixes

These are real mistakes AI agents make on this codebase. Do not repeat them.

#### ❌ Anti-pattern: `sed` to flip task-file checkboxes

```bash
# WRONG — never do this
sed -i '' 's/- \[ \] Launch Puppeteer/- [x] Launch Puppeteer/; s/- \[ \] Navigate and screenshot/- [x] Navigate and screenshot/' .docs/tasks/051-ux-conversion-audit.md
```

This pattern shows up most often when marking multiple steps complete in a task file. It triggers an approval prompt every time, is fragile against whitespace or escaping, and silently corrupts files when a regex backfires.

✅ **Correct**: call the `Edit` tool once per checkbox (or use `replace_all: true` if every `- [ ]` in the file should become `- [x]`):

```
Edit(file_path=".docs/tasks/051-ux-conversion-audit.md",
     old_string="- [ ] Launch Puppeteer",
     new_string="- [x] Launch Puppeteer")
Edit(file_path=".docs/tasks/051-ux-conversion-audit.md",
     old_string="- [ ] Navigate and screenshot each marketing",
     new_string="- [x] Navigate and screenshot each marketing")
# ...one Edit call per checkbox
```

Yes, even if there are ten checkboxes. Ten `Edit` calls is correct. One `sed` is wrong.

#### ❌ Anti-pattern: `cat` to check what's in a file before editing

```bash
# WRONG
cat .docs/tasks/051-ux-conversion-audit.md
```

✅ **Correct**: `Read` tool. Always.

#### ❌ Anti-pattern: `ls` to see what's in a directory

```bash
# WRONG
ls .docs/uat/screenshots/
```

✅ **Correct**: `mcp__serena__list_dir(relative_path=".docs/uat/screenshots/")`

#### ❌ Anti-pattern: `grep -r` to find a string across files

```bash
# WRONG
grep -r "pending-uat" .
```

✅ **Correct**: the `Grep` tool, or `mcp__serena__search_for_pattern`.

#### ❌ Anti-pattern: `echo "new content" >> file.md` to append to a file

```bash
# WRONG
echo "## New Section" >> README.md
```

✅ **Correct**: `Read` the file first to see the current end, then `Edit` to append (or `Write` if creating fresh).

**See also**: [`command-anti-patterns.md`](./command-anti-patterns.md) — shell hygiene, scratch-dir rules, and the /tackle-vs-UAT verification split.

---

## Serena (Code Exploration & Editing)

Serena provides two editing approaches:
1. **Symbolic** — LSP-powered, refactoring-safe (entire functions/classes)
2. **File/line-based** — Precise line-range and regex edits (within functions)

### Tools

**Exploration:**

| Tool | Purpose | Key Params |
|------|---------|------------|
| `get_symbols_overview` | File structure overview | `relative_path`, `depth` (0=top-level) |
| `find_symbol` | Find symbols by name | `name_path_pattern`, `include_body`, `depth`, `substring_matching` |
| `find_referencing_symbols` | Find all callers/references | `name_path`, `relative_path` (file, not dir) |
| `search_for_pattern` | Regex search across files | `substring_pattern`, `relative_path`, `paths_include_glob` |
| `list_dir` | List directory contents | `relative_path`, `recursive` |
| `find_file` | Find files by name/mask | `file_mask`, `relative_path` |

**Symbolic editing** (use when replacing entire symbols):

| Tool | Purpose | Key Params |
|------|---------|------------|
| `replace_symbol_body` | Replace function/class body | `name_path`, `relative_path`, `body` (includes signature, NOT docstring) |
| `insert_after_symbol` | Add code after a symbol | `name_path`, `relative_path`, `body` |
| `insert_before_symbol` | Add code before a symbol | `name_path`, `relative_path`, `body` |
| `rename_symbol` | Rename across codebase | `name_path`, `relative_path`, `new_name` |

**File/line editing** (use for precise edits within symbols):

| Tool | Purpose | Key Params |
|------|---------|------------|
| `replace_content` | Literal or regex replacement | `relative_path`, `mode` (literal/regex), `needle`, `repl` |
| `replace_lines` | Replace line range | `relative_path`, `start_line`, `end_line`, `content` (0-based) |
| `delete_lines` | Delete line range | `relative_path`, `start_line`, `end_line` (0-based) |
| `insert_at_line` | Insert at line number | `relative_path`, `line`, `content` (0-based) |

### Name Path Patterns

- `"method"` — matches any symbol named "method"
- `"MyClass/method"` — matches method in MyClass (relative)
- `"/MyClass/method"` — exact match (absolute)
- `"MyClass/method[0]"` — specific overload

### Workflow

```
1. get_symbols_overview → 2. find_symbol → 3. Edit → 4. find_referencing_symbols
```

### Choosing Edit Mode

| Scenario | Use |
|----------|-----|
| Replace entire function/method/class | Symbolic: `replace_symbol_body` |
| Add new method to class | Symbolic: `insert_after_symbol` |
| Rename across codebase | Symbolic: `rename_symbol` |
| Edit few lines within large function | File/line: `replace_content` or `replace_lines` |
| Regex-based replacement | File/line: `replace_content` with `mode="regex"` |
| Edit doesn't align with symbol boundaries | File/line: `replace_lines` |

---

## Context7 (Library Documentation)

Two-step workflow — resolve the library ID, then query docs.

### Step 1: Resolve Library ID

```python
mcp__context7__resolve-library-id(libraryName="sqlalchemy")
# Returns: "/sqlalchemy/sqlalchemy"
```

Skip only if user provides an explicit `/org/project` ID.

### Step 2: Query Documentation

```python
mcp__context7__query-docs(
    libraryId="/sqlalchemy/sqlalchemy",
    query="async session management"
)
```

If results are insufficient, refine the query with more specific terms.

---

## Brave Search (Web Research)

### Rate Limit: 1 request per second

- Searches MUST be sequential, never parallel
- Wait 1 second between consecutive searches
- On 429 errors, wait 1 second and retry (max 3 times)

### Usage

```python
mcp__brave-search__brave_web_search(
    query="FastAPI dependency injection best practices 2025",
    count=10
)
```

Use for general research, best practices, troubleshooting, news. Do NOT use for library documentation (use Context7).

---

## Playwright (Browser Automation)

### Tools

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Navigate to a URL |
| `browser_take_screenshot` | Screenshot current page |
| `browser_snapshot` | Get accessibility tree (use to get element `ref` IDs before clicking/typing) |
| `browser_click` | Click element by `ref` ID from snapshot |
| `browser_type` | Type into an input field by `ref` ID |
| `browser_evaluate` | Execute JavaScript in browser |
| `browser_select_option` | Select dropdown option by `ref` ID |
| `browser_hover` | Hover over element by `ref` ID |
| `browser_close` | Close the browser |

### Workflow

1. **No explicit launch step** — the browser starts automatically on the first tool call.
2. **Accessibility-tree first** — always call `browser_snapshot` to get the current page structure and element `ref` IDs before interacting. Pass the `ref` to `browser_click`, `browser_type`, etc.
3. Use `browser_take_screenshot` for visual verification after navigation or interaction.

Use for visual verification, form interaction, and browser-rendered content. Do NOT use for static content fetching or library docs.

---

## Onboarding & Memory

Always run onboarding check when starting work:

```python
mcp__serena__check_onboarding_performed()
# If not performed:
mcp__serena__onboarding()
```

### Memory Tools

| Tool | Purpose | Key Params |
|------|---------|------------|
| `list_memories` | List available memories | `topic` (optional filter, e.g. `"auth"`) |
| `read_memory` | Read a memory's contents | `memory_name` |
| `write_memory` | Create a new memory (markdown) | `memory_name`, `content`, `max_chars` (optional) |
| `edit_memory` | Update existing memory in-place | `memory_name`, `needle`, `repl`, `mode` (`literal` or `regex`), `allow_multiple_occurrences` |
| `rename_memory` | Rename or move a memory | `old_name`, `new_name` |
| `delete_memory` | Delete a memory (user permission required) | `memory_name` |

### Memory Naming & Organization

Use `/` separators to create topic hierarchies:

```
modules/frontend          → .serena/memories/modules/frontend.md
auth/login/logic          → .serena/memories/auth/login/logic.md
global/java/style_guide   → shared across all projects
```

- **Project memories**: Stored in `.serena/memories/` within the project
- **Global memories**: Use `global/` prefix — shared across all projects (only when explicitly instructed)
- **Topic filtering**: `list_memories(topic="auth")` returns only memories under that topic

### When to Write Memories

Write memories to persist **non-obvious project knowledge** useful for future tasks:

- Architecture decisions and their rationale
- Integration patterns between modules
- Naming conventions and project-specific terminology
- Known gotchas, workarounds, and edge cases
- Configuration requirements that aren't self-documenting

**Do NOT write memories for**:
- Information already in code comments or docs
- Temporary task state or debugging notes
- Easily re-derivable facts (file paths, import lists)

### Memory Workflow

```
1. list_memories          → discover what exists (filter by topic if needed)
2. read_memory            → check if relevant memory already covers this
3. write_memory           → create new, OR edit_memory → update existing
4. After implementation   → update memories that reference changed code
```

### Best Practices

- **Check before writing**: Always `list_memories` then `read_memory` to avoid duplicates
- **Edit over rewrite**: Use `edit_memory` (literal or regex mode) for targeted updates instead of rewriting entire memories
- **Keep memories focused**: One topic per memory — split broad memories into topic-specific ones
- **Update after changes**: When code changes affect documented patterns, update the relevant memories
- **Meaningful names**: Use descriptive hierarchical names (`api/auth/jwt-flow` not `memory1`)
- **Review post-onboarding**: After Serena onboarding, review generated memories and refine them

---

## Quick Reference: Which Tool for What

| Task | MUST Use | NEVER Use |
|------|----------|-----------|
| Explore code structure | Serena `get_symbols_overview` | `Read` on code files, `cat` |
| Find function/class | Serena `find_symbol` | `Grep` on code files, `bash grep` |
| Edit code | Serena symbolic or file/line tools | Standard `Edit` on code files, `sed` |
| Rename symbol | Serena `rename_symbol` | Manual find-and-replace |
| Search file contents | Serena `search_for_pattern` or `Grep` tool | `bash grep` / `rg` / `ag` |
| List a directory | Serena `list_dir` | `ls`, `tree`, `find -type d` |
| Find files by name | Serena `find_file` or `Glob` tool | `find -name`, `ls \| grep` |
| Read markdown content | Standard `Read` | `cat`, `head`, `tail` |
| Edit markdown content | Standard `Edit` / `Write` | `sed`, `awk`, `echo >>` |
| Edit config files (JSON, YAML, .env) | Standard `Read`/`Edit`/`Write` | `sed`, Serena symbolic tools |
| Library docs | Context7 | `WebSearch` / `WebFetch` |
| General research | Brave Search (sequential, 1/sec) | Parallel searches |
| Browser interaction | Playwright | `WebFetch` for rendered content |
