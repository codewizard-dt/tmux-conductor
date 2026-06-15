# register-codex-hooks.jq — jq program sourced by install-hooks.sh.
#
# Given an existing Codex hooks.json on stdin, emits a new document with
# tmux-conductor's Codex lifecycle hooks registered and deduped.

def stale_cmd($new_cmd):
  (.command == $new_cmd)
  or (
    (.command | test("/hooks/on-(session-start|prompt-submit|stop)\\.(sh|js)$"))
    and ((.command | startswith($install_dir + "/")) | not)
  );

def purge($new_cmd):
  map(
    (.hooks |= (. // [] | map(select(stale_cmd($new_cmd) | not))))
    | select((.hooks | length) > 0)
  );

def register_with_matcher($event; $matcher; $new_cmd):
  .hooks |= (. // {})
  | .hooks[$event] |= ((. // []) | purge($new_cmd))
  | .hooks[$event] += [{
      "matcher": $matcher,
      "hooks": [{ "type": "command", "command": $new_cmd }]
    }];

def register($event; $new_cmd):
  .hooks |= (. // {})
  | .hooks[$event] |= ((. // []) | purge($new_cmd))
  | .hooks[$event] += [{
      "hooks": [{ "type": "command", "command": $new_cmd }]
    }];

register_with_matcher("SessionStart"; "startup|resume|clear"; $install_dir_cmd + "/on-session-start.js")
| register("UserPromptSubmit"; $install_dir_cmd + "/on-prompt-submit.js")
| register("Stop"; $install_dir_cmd + "/on-stop.js")
