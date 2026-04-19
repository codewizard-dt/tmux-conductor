# register-hooks.jq — jq program sourced by install-hooks.sh.
#
# Invoked as: jq --arg install_dir "$INSTALL_DIR" -f hooks/register-hooks.jq
#
# Given an existing Claude Code settings.json on stdin, emits a new document
# with tmux-conductor's four per-event hooks registered under .hooks, deduped
# against prior registrations (including stale repo-path entries and legacy
# .sh registrations from pre-task-011 installs). Foreign hook entries are
# preserved untouched.

# stale_cmd($new_cmd): predicate for the inner hooks[] entries.
# Returns true if this command should be pruned before we append the new
# registration. Two cases:
#   (a) Exact duplicate of the command we are about to add — dedup so
#       repeated runs of install-hooks.sh produce byte-identical output.
#   (b) Looks like one of our per-event scripts (path ends in
#       on-session-start / on-prompt-submit / on-stop / on-stop-failure
#       with a .sh or .js extension) but is NOT under the current
#       $install_dir — i.e. a stale registration pointing at an older
#       install location (e.g. the repo checkout from a prior version, or
#       a pre-task-011 Bash install). Purging these keeps us from leaving
#       dangling commands when users move/delete the repo or migrate from
#       the old .sh hooks to the new .js hooks.
# Foreign hooks (anything not matching the regex) are untouched.
def stale_cmd($new_cmd):
  (.command == $new_cmd)
  or (
    (.command | test("/hooks/on-(session-start|prompt-submit|stop|stop-failure)\\.(sh|js)$"))
    and ((.command | startswith($install_dir + "/")) | not)
  );

# purge($new_cmd): operates on the event-level array (e.g. .hooks.Stop).
# For each top-level entry, filter out stale inner hooks; then drop any
# entry that has been emptied as a result. This prevents us from leaving
# behind shell matcher/hooks wrappers with empty hooks[] arrays.
def purge($new_cmd):
  map(
    (.hooks |= (. // [] | map(select(stale_cmd($new_cmd) | not))))
    | select((.hooks | length) > 0)
  );

# register_with_matcher: used for SessionStart, which requires a `matcher`
# string to scope the hook to particular session-start reasons
# ("startup|resume|clear"). Ensures .hooks and .hooks[$event] exist, purges
# any stale/duplicate entries, then appends the fresh registration.
def register_with_matcher($event; $matcher; $new_cmd):
  .hooks |= (. // {})
  | .hooks[$event] |= ((. // []) | purge($new_cmd))
  | .hooks[$event] += [{
      "matcher": $matcher,
      "hooks": [{ "type": "command", "command": $new_cmd }]
    }];

# register: used for UserPromptSubmit / Stop / StopFailure, which do not
# take a matcher (they fire on every occurrence of the event).
def register($event; $new_cmd):
  .hooks |= (. // {})
  | .hooks[$event] |= ((. // []) | purge($new_cmd))
  | .hooks[$event] += [{
      "hooks": [{ "type": "command", "command": $new_cmd }]
    }];

# Pipeline: register each of the four events in turn.
# $install_dir_cmd uses ~ so registered commands are portable across users/machines.
# $install_dir (absolute) is used only for the stale-entry startswith check above.
register_with_matcher("SessionStart"; "startup|resume|clear"; $install_dir_cmd + "/on-session-start.js")
| register("UserPromptSubmit"; $install_dir_cmd + "/on-prompt-submit.js")
| register("Stop"; $install_dir_cmd + "/on-stop.js")
| register("StopFailure"; $install_dir_cmd + "/on-stop-failure.js")
