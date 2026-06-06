You are integrating a design system into a frontend application.

**Design system path**: `<DESIGN_SYSTEM_PATH>`
**App source path**: `<APP_SRC_PATH>`
**Routes/pages path**: `<APP_ROUTES_PATH>` (the directory Claude should watch for edits)
**Skill name**: `<SKILL_NAME>` (kebab-case, e.g. `my-brand-route-design`)

IMPORTANT: if any of these paths are not obvious, ask the user for clarification

---

## Phase 1 — Migrate assets and tokens

1. Read the design system directory at `<DESIGN_SYSTEM_PATH>` to understand its structure
before doing anything else.
2. Create `<APP_SRC_PATH>/design-system/` with subdirectories `assets/` and `components/`.
3. Copy the CSS/token file (colors, typography, spacing, shadows, animation vars) into
`<APP_SRC_PATH>/design-system/design-system.css`. Preserve content exactly.
4. Copy all static assets (icons, logos, fonts, videos) into
`<APP_SRC_PATH>/design-system/assets/`.
5. Copy the original prototype/reference component files into
`<APP_SRC_PATH>/design-system/components/` **unmodified** — these are read-only reference.

## Phase 2 — Wire tokens into the app entry point

6. Read the app entry file (e.g. `main.tsx`, `main.ts`, `index.js`, `_app.tsx`).
7. Add the design-system CSS import as the **first** import, before any other styles or app
imports.

## Phase 3 — Convert prototype components to production TypeScript

For each prototype component in `<APP_SRC_PATH>/design-system/components/`:

8. Read the prototype file before writing any production code.
9. Produce a typed production equivalent in `<APP_SRC_PATH>/components/`. Rules:
    - Use the target framework's idiomatic component model (typed props, no `any`).
    - Drive all visual properties exclusively through CSS custom properties from
`design-system.css` — never hardcode color, spacing, or typography values.
    - Keep components stateless/pure where possible; lift state to callers.
    - Export each component as a named export from an `index` barrel file.

## Phase 4 — Wire components into routes/pages

10. For each route or page file in the app, read it before editing.
11. Import and render the corresponding production component.
12. Pass only the props the component declares; use mock/static data for any data that requires
a live backend (label it clearly as mock).

## Phase 5 — Create the brand enforcement skill

13. Read `<DESIGN_SYSTEM_PATH>/README.md` in full before writing the skill.
14. Create `.claude/skills/<SKILL_NAME>/SKILL.md` with the following structure:

    ```markdown
    ---
    name: <SKILL_NAME>
    description: Enforce <brand> design guidelines when implementing or modifying frontend
routes. Reads design tokens, component patterns, and brand rules. Auto-triggered by PostToolUse
hook when route files are edited.
    user-invocable: true
    ---

    You are implementing a <brand> frontend route. Before writing any UI code, read:

    1. `<APP_SRC_PATH>/design-system/design-system.css` — all CSS custom properties
    2. `<APP_SRC_PATH>/design-system/components/` — original prototype implementations for
reference
    3. `<DESIGN_SYSTEM_PATH>/README.md` — full brand rules, voice, iconography, animation spec

    Key non-negotiables:
    <EXTRACT THESE VERBATIM FROM THE DESIGN SYSTEM README — theme, color usage, typography
rules,
    spacing rules, component patterns, interaction rules, copy voice, icon library, animation
easing,
    confirmation requirements for destructive actions, anything explicitly prohibited>
    ```

    The "Key non-negotiables" section must be populated from the actual design system README,
not left as a placeholder.

## Phase 6 — Create the PostToolUse hook and register it

15. Create `.claude/hooks/` if it does not exist.
16. Create `.claude/hooks/on-route-edit.sh` with this content:

    ```bash
    #!/bin/bash
    # PostToolUse hook: fires after Edit or Write tool use.
    # If the modified file is under <APP_ROUTES_PATH>, injects the brand skill
    # into Claude's active context so design rules are always in scope.
    set -euo pipefail

    INPUT=$(cat)
    FILE_PATH=$(echo "$INPUT" | python3 -c "
    import sys, json
    try:
        d = json.load(sys.stdin)
        print(d.get('file_path', d.get('path', '')))
    except Exception:
        print('')
    " 2>/dev/null || echo "")

    if echo "$FILE_PATH" | grep -q "<APP_ROUTES_PATH>"; then
    ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    SKILL="$ROOT/.claude/skills/<SKILL_NAME>/SKILL.md"
    if [ -f "$SKILL" ]; then
        echo ""
        echo "=== <BRAND> DESIGN SYSTEM ==="
        cat "$SKILL"
        echo "=============================="
    fi
    fi
    ```

17. Make it executable: `chmod +x .claude/hooks/on-route-edit.sh`
18. Read `.claude/settings.json` if it exists; otherwise create it. Add the hook entry — do not
overwrite any existing hooks:

    ```json
    {
    "hooks": {
        "PostToolUse": [
        {
            "matcher": "Edit|Write",
            "hooks": [
            {
                "type": "command",
                "command": "bash .claude/hooks/on-route-edit.sh"
            }
            ]
        }
        ]
    }
    }
    ```

## Phase 7 — Verify

19. Run the framework's type checker (`tsc --noEmit`, `vue-tsc`, etc.) — must exit 0 with no
errors.
20. Confirm `<APP_SRC_PATH>/design-system/design-system.css` exists and contains the expected
`:root` custom property blocks.
21. Confirm `.claude/hooks/on-route-edit.sh` is executable (`ls -la` shows `-rwxr-xr-x`).
22. Confirm `.claude/settings.json` contains the `PostToolUse` hook entry.
23. Start the dev server and visually confirm each converted component renders without console
errors.

---

## Standing rules (always apply, no exceptions)

- Use CSS vars everywhere. No hardcoded hex, px, or font-family strings in component styles.
- Preserve the design system's theme — do not introduce a mode the prototype does not define.
- Every destructive or irreversible user action must show a confirmation step before the action
fires.
- Follow the icon library, stroke width, and size scale in the design system exactly — no
substitutions.
- Copy tone and casing follow the design system's voice guidelines exactly.

The key addition: Phase 5 requires reading the design system README before writing the skill,
and explicitly filling in the non-negotiables from it rather than leaving them as a
placeholder. That makes the skill self-documenting and accurate to the actual brand.
