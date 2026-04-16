#!/usr/bin/env bash
set -euo pipefail

# Skip re-initialization if sentinel present
if [[ -f "$HOME/.claude/.conductor-initialized" ]]; then
  exec "$@"
fi

mkdir -p "$HOME/.claude"

# Seed ~/.claude.json from host copy if present, else fallback onboarding seed
if [[ -f /host-claude-config/.claude.json ]]; then
  cp /host-claude-config/.claude.json "$HOME/.claude.json"
else
  echo '{"hasCompletedOnboarding":true,"installMethod":"native"}' > "$HOME/.claude.json"
fi

# Bring over ~/.claude/ contents (settings, CLAUDE.md, plugins) but NOT live session state
if [[ -d /host-claude-config/.claude/ ]]; then
  rsync -a \
    --exclude='.credentials.json' \
    --exclude='sessions/' \
    --exclude='projects/' \
    --exclude='history.jsonl' \
    --exclude='shell-snapshots/' \
    --exclude='telemetry/' \
    --exclude='ide/' \
    /host-claude-config/.claude/ "$HOME/.claude/"
fi

# Belt-and-suspenders: never carry host credentials into the container
rm -f "$HOME/.claude/.credentials.json"

# Guarantee onboarding + native install method so Claude Code won't prompt
jq '.hasCompletedOnboarding = true | .installMethod = "native"' "$HOME/.claude.json" > /tmp/claude.json && mv /tmp/claude.json "$HOME/.claude.json"

# Register Serena MCP project-local, keyed to the container workspace path
cd "/workspaces/tmux-conductor"
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project /workspaces/tmux-conductor 2>&1 || echo "Serena already registered, skipping"

# Merge conductor hook config into ~/.claude/settings.json (preserves any host-synced settings).
# Idempotency: the sentinel file $HOME/.claude/.conductor-initialized (touched below) short-circuits
# re-runs of this whole script, so this jq append runs exactly once per container lifetime — safe.
SETTINGS_FILE="$HOME/.claude/settings.json"
[ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"
HOOK_CMD="/conductor-hooks/claude-hook.sh"
jq --arg cmd "$HOOK_CMD" '
  .hooks = ((.hooks // {}) as $h |
    $h
    | .UserPromptSubmit = ((.UserPromptSubmit // []) + [{"hooks":[{"type":"command","command":($cmd + " UserPromptSubmit")}]}])
    | .PreToolUse       = ((.PreToolUse       // []) + [{"hooks":[{"type":"command","command":($cmd + " PreToolUse")}]}])
    | .Stop             = ((.Stop             // []) + [{"hooks":[{"type":"command","command":($cmd + " Stop")}]}])
    | .Notification     = ((.Notification     // []) + [{"hooks":[{"type":"command","command":($cmd + " Notification")}]}])
  )
' "$SETTINGS_FILE" > /tmp/settings.json && mv /tmp/settings.json "$SETTINGS_FILE"

# Drop sentinel so subsequent container restarts skip this work
touch "$HOME/.claude/.conductor-initialized"

exec "$@"
