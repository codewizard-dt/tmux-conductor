**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**

# MANDATORY REQUIREMENTS

## YOU MUST USE MCP TOOLS. THIS IS NON-NEGOTIABLE.

| Operation | REQUIRED Tool | FORBIDDEN Alternative |
|-----------|---------------|----------------------|
| List memories | `mcp__serena__list_memories` | N/A |
| Read memories | `mcp__serena__read_memory` | N/A |
| Write memories | `mcp__serena__write_memory` | N/A |
| Edit memories | `mcp__serena__edit_memory` | N/A |
| Rename memories | `mcp__serena__rename_memory` | N/A |
| Explore code | `mcp__serena__find_symbol`, `mcp__serena__get_symbols_overview` | ~~Read~~ |
| Find files | `mcp__serena__find_file`, `mcp__serena__list_dir` | ~~Glob~~ |
| Search code | `mcp__serena__search_for_pattern` | ~~Grep~~ |

**PROHIBITED**: Using Read, Glob, or Grep for code exploration.

---

# Codebase Context Update

Quick workflow to refresh understanding of the codebase via Serena memories.

## Step 1: Discover & Read Memories

1. `mcp__serena__list_memorjies` → list all available memories (use `topic` parameter to filter by area, e.g. `topic="api"`)
2. `mcp__serena__read_memory` → read each relevant memory to rebuild context
3. Note any memories that appear stale or reference code that may have changed

**Memory organization uses `/` separators** for topic hierarchies (e.g. `modules/frontend`, `auth/login/logic`). Use topic filtering to efficiently navigate large memory sets.

## Step 2: Explore Codebase as Needed

Use MCP Serena to verify and extend your understanding:
- `mcp__serena__get_symbols_overview` → file/module structure
- `mcp__serena__find_symbol` → locate specific functions, classes, components
- `mcp__serena__search_for_pattern` → find patterns, usages, integrations

Cross-reference what you find against existing memories — if reality has drifted from what's documented, note it for Step 3.

## Step 3: Update Memories

Keep memories current and useful for future conversations:

1. **Edit stale memories**: Use `mcp__serena__edit_memory` with `mode="literal"` for precise text swaps or `mode="regex"` for pattern-based updates. Prefer editing over full rewrites.
2. **Write new memories**: Use `mcp__serena__write_memory` for genuinely new knowledge:
   - Architecture decisions and their rationale
   - Integration patterns between modules
   - Known gotchas, workarounds, and edge cases
   - Naming conventions and project-specific terminology
   - Use `/` in names for topic hierarchy (e.g. `api/auth/jwt-flow`)
3. **Rename disorganized memories**: Use `mcp__serena__rename_memory` to move memories into proper topic hierarchies
4. **Do NOT write memories for**: information already in code comments or docs, temporary state, easily re-derivable facts

See `.docs/guides/mcp-tools.md` for the complete Serena memory reference.
