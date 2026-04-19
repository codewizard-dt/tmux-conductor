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

# Rewrite host path prefixes in hook commands: anything before "/.claude/" is replaced
# with the container's $HOME so foreign hooks (e.g. LSP enforcement kit) installed
# under ~/.claude/hooks/ still resolve inside the container. install-hooks.sh will
# separately dedup-merge tmux-conductor's own entries below.
if [[ -f "$HOME/.claude/settings.json" ]]; then
  jq --arg home "$HOME" '
    if .hooks then
      .hooks |= with_entries(
        .value |= map(
          .hooks |= map(
            if (.command // "") | test("/\\.claude/") then
              .command |= sub("^.*/\\.claude/"; $home + "/.claude/")
            else . end
          )
        )
      )
    else . end
  ' "$HOME/.claude/settings.json" > /tmp/settings-rehomed.json \
    && mv /tmp/settings-rehomed.json "$HOME/.claude/settings.json"
fi

# Register Serena MCP project-local, keyed to the container workspace path
cd "/workspaces/tmux-conductor"
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project /workspaces/tmux-conductor 2>&1 || echo "Serena already registered, skipping"

# Register conductor per-event hooks into ~/.claude/settings.json.
# Hook command prefixes were rewritten to the container's $HOME above, so foreign
# hooks (e.g. LSP enforcement) keep working alongside tmux-conductor's dedup-merged entries.
# install-hooks.sh handles settings file creation, jq merge, PreToolUse cleanup, and atomic write.
# Idempotency: the sentinel file $HOME/.claude/.conductor-initialized (touched below) short-circuits
# re-runs of this whole script, so install-hooks.sh runs exactly once per container lifetime — safe.
/conductor-hooks/install-hooks.sh

# Drop sentinel so subsequent container restarts skip this work
touch "$HOME/.claude/.conductor-initialized"

exec "$@"
