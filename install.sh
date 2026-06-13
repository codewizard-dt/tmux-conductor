#!/usr/bin/env bash
set -euo pipefail

# tmux-conductor installer
#
# Idempotent `curl ... | bash` installer. The SCRIPT ITSELF is authored to run
# under stock macOS bash 3.2 (no associative arrays, no mapfile/readarray, no
# ${var^^}/${var,,} case-conversion). The runtime scripts under scripts/ use
# bash >= 4 features (declare -A) and are NOT executed here — we only CHECK that
# a PATH bash >= 4 exists for them.
#
# Env overrides (Section 1):
#   CONDUCTOR_HOME          install dir            (default: $HOME/.tmux-conductor)
#   CONDUCTOR_REPO_URL      git remote            (default: HTTPS origin)
#   CONDUCTOR_BRANCH        branch to track       (default: main)
#   CONDUCTOR_PAIRING_CODE  pairing code          (default: empty)
#   CONDUCTOR_DAEMON_SOCK   daemon unix socket    (default: standard data dir)

# ----------------------------------------------------------------------------
# Helpers (defined before main; the only top-level CALL is `main "$@"`).
# ----------------------------------------------------------------------------

log() {
  # Timestamped line to stdout AND the install log.
  msg="$(date '+%Y-%m-%dT%H:%M:%S') $*"
  echo "$msg"
  if [ -n "${LOG_FILE:-}" ]; then
    echo "$msg" >>"$LOG_FILE"
  fi
}

warn() {
  log "WARN: $*"
}

die() {
  log "ERROR: $*"
  exit 1
}

# Pure-bash integer compare of two MAJOR.MINOR versions.
# Prints "ge" if $1 >= $2, else "lt". bash-3.2-safe.
version_ge() {
  have="$1"
  want="$2"

  have_major="${have%%.*}"
  have_rest="${have#*.}"
  if [ "$have_rest" = "$have" ]; then
    have_minor="0"
  else
    have_minor="${have_rest%%.*}"
  fi

  want_major="${want%%.*}"
  want_rest="${want#*.}"
  if [ "$want_rest" = "$want" ]; then
    want_minor="0"
  else
    want_minor="${want_rest%%.*}"
  fi

  # Default unparseable fields to 0.
  case "$have_major" in '' | *[!0-9]*) have_major=0 ;; esac
  case "$have_minor" in '' | *[!0-9]*) have_minor=0 ;; esac
  case "$want_major" in '' | *[!0-9]*) want_major=0 ;; esac
  case "$want_minor" in '' | *[!0-9]*) want_minor=0 ;; esac

  if [ "$have_major" -gt "$want_major" ]; then
    echo "ge"
  elif [ "$have_major" -lt "$want_major" ]; then
    echo "lt"
  elif [ "$have_minor" -ge "$want_minor" ]; then
    echo "ge"
  else
    echo "lt"
  fi
}

main() {
  # --------------------------------------------------------------------------
  # Step 1 — Skeleton & guards
  # --------------------------------------------------------------------------
  LOG_DIR="$HOME/.local/share/tmux-conductor"
  mkdir -p "$LOG_DIR"
  LOG_FILE="$LOG_DIR/install.log"

  log "=== tmux-conductor install started ==="

  # --------------------------------------------------------------------------
  # Section 1 — Env-overridable settings
  # --------------------------------------------------------------------------
  INSTALL_DIR="${CONDUCTOR_HOME:-$HOME/.tmux-conductor}"
  REPO_URL="${CONDUCTOR_REPO_URL:-https://github.com/codewizard-dt/tmux-conductor.git}"
  BRANCH="${CONDUCTOR_BRANCH:-main}"
  CONDUCTOR_PAIRING_CODE="${CONDUCTOR_PAIRING_CODE:-}"
  SOCK="${CONDUCTOR_DAEMON_SOCK:-$HOME/.local/share/tmux-conductor/daemon.sock}"

  log "install dir: $INSTALL_DIR"
  log "repo url:    $REPO_URL"
  log "branch:      $BRANCH"

  # OS hint for remedies.
  OS_NAME="$(uname -s 2>/dev/null || echo unknown)"

  # --------------------------------------------------------------------------
  # Section 2 — Prereq checks with remedies
  # --------------------------------------------------------------------------
  log "--- checking prerequisites ---"

  # git (hard)
  if command -v git >/dev/null 2>&1; then
    log "PASS: git found ($(command -v git))"
  else
    log "FAIL: git not found"
    if [ "$OS_NAME" = "Darwin" ]; then
      echo "  Remedy: xcode-select --install" >&2
    else
      echo "  Remedy: install git via your distro package manager (e.g. apt-get install git)" >&2
    fi
    die "git is required"
  fi

  # tmux >= 3.0 (hard)
  if command -v tmux >/dev/null 2>&1; then
    tmux_raw="$(tmux -V 2>/dev/null || echo '')"
    # Format: "tmux 3.4a" -> take the 2nd field, strip trailing non-digit/non-dot.
    tmux_ver="${tmux_raw#tmux }"
    # Strip a single trailing alpha suffix (e.g. 3.4a -> 3.4) and anything after.
    tmux_clean=""
    i=0
    while [ "$i" -lt "${#tmux_ver}" ]; do
      ch="${tmux_ver:$i:1}"
      case "$ch" in
        [0-9.]) tmux_clean="$tmux_clean$ch" ;;
        *) break ;;
      esac
      i=$((i + 1))
    done
    if [ "$(version_ge "$tmux_clean" "3.0")" = "ge" ]; then
      log "PASS: tmux $tmux_clean (>= 3.0)"
    else
      log "FAIL: tmux $tmux_clean (< 3.0)"
      if [ "$OS_NAME" = "Darwin" ]; then
        echo "  Remedy: brew install tmux" >&2
      else
        echo "  Remedy: install tmux >= 3.0 via your distro package manager" >&2
      fi
      die "tmux >= 3.0 is required"
    fi
  else
    log "FAIL: tmux not found"
    if [ "$OS_NAME" = "Darwin" ]; then
      echo "  Remedy: brew install tmux" >&2
    else
      echo "  Remedy: install tmux >= 3.0 via your distro package manager" >&2
    fi
    die "tmux >= 3.0 is required"
  fi

  # node >= 22.12 hard floor; warn if < 26.0.
  # Hard floor 22.12.0 comes from frontend/package.json engines.node (>=22.12.0).
  # Warn threshold 26.0.0 comes from backend/package.json engines.node (>=26.0.0);
  # the backend declares a stricter floor and will refuse to run below it, but we
  # only WARN here so a frontend/daemon-only user is not blocked. (daemon declares
  # no engines.node floor.)
  if command -v node >/dev/null 2>&1; then
    node_raw="$(node -v 2>/dev/null || echo '')"
    # Format: "v22.12.0" -> strip leading v.
    node_ver="${node_raw#v}"
    if [ "$(version_ge "$node_ver" "22.12")" = "ge" ]; then
      log "PASS: node $node_ver (>= 22.12.0)"
      if [ "$(version_ge "$node_ver" "26.0")" = "lt" ]; then
        warn "node $node_ver is below 26.0.0 — backend/package.json declares engines.node >=26.0.0 and will refuse to run; upgrade Node to run the backend."
      fi
    else
      log "FAIL: node $node_ver (< 22.12.0)"
      echo "  Remedy: install Node >= 22.12.0 via nvm, fnm, or the official Node installer." >&2
      if [ -f "$INSTALL_DIR/.nvmrc" ]; then
        echo "  The repo ships a .nvmrc — after cloning, run 'nvm use' in $INSTALL_DIR." >&2
      else
        echo "  The repo ships a .nvmrc once cloned — 'nvm use' will select the pinned version." >&2
      fi
      die "node >= 22.12.0 is required"
    fi
  else
    log "FAIL: node not found"
    echo "  Remedy: install Node >= 22.12.0 via nvm, fnm, or the official Node installer." >&2
    die "node >= 22.12.0 is required"
  fi

  # npm (hard)
  if command -v npm >/dev/null 2>&1; then
    log "PASS: npm found ($(command -v npm))"
  else
    log "FAIL: npm not found"
    echo "  Remedy: npm ships with Node — reinstall Node to obtain npm." >&2
    die "npm is required"
  fi

  # PATH bash >= 4 (hard). Inspect the PATH bash, NOT $BASH_VERSION.
  path_bash="$(command -v bash 2>/dev/null || echo '')"
  if [ -n "$path_bash" ]; then
    bash_line="$("$path_bash" --version 2>/dev/null | head -n 1)"
    # Format: "GNU bash, version 5.2.15(1)-release ..." -> grab the token after "version".
    bash_ver="${bash_line#*version }"
    bash_ver="${bash_ver%% *}"
    bash_major="${bash_ver%%.*}"
    case "$bash_major" in '' | *[!0-9]*) bash_major=0 ;; esac
    if [ "$bash_major" -ge 4 ]; then
      log "PASS: PATH bash $bash_ver (>= 4) at $path_bash"
    else
      log "FAIL: PATH bash $bash_ver (< 4) at $path_bash"
      if [ "$OS_NAME" = "Darwin" ]; then
        echo "  Remedy: brew install bash, then ensure \$(brew --prefix)/bin precedes /bin on PATH." >&2
      else
        echo "  Remedy: install bash >= 4 via your distro package manager and put it first on PATH." >&2
      fi
      die "the runtime scripts require bash >= 4 on PATH"
    fi
  else
    die "no bash found on PATH (unexpected)"
  fi

  # jq (hard) — install-hooks.sh needs it.
  if command -v jq >/dev/null 2>&1; then
    log "PASS: jq found ($(command -v jq))"
  else
    log "FAIL: jq not found (required by install-hooks.sh)"
    if [ "$OS_NAME" = "Darwin" ]; then
      echo "  Remedy: brew install jq" >&2
    else
      echo "  Remedy: install jq via your distro package manager (e.g. apt-get install jq)" >&2
    fi
    die "jq is required"
  fi

  # sqlite3 (warn-only)
  if command -v sqlite3 >/dev/null 2>&1; then
    log "PASS: sqlite3 found ($(command -v sqlite3))"
  else
    warn "sqlite3 CLI not found — used only for DB inspection; better-sqlite3 bundles its own engine, so this is optional."
    if [ "$OS_NAME" = "Darwin" ]; then
      echo "  Remedy (optional): brew install sqlite" >&2
    else
      echo "  Remedy (optional): install sqlite3 via your distro package manager" >&2
    fi
  fi

  # Xcode CLT / make + g++ (warn-only) — only needed if better-sqlite3 builds from source.
  has_make="no"
  has_cxx="no"
  command -v make >/dev/null 2>&1 && has_make="yes"
  if command -v g++ >/dev/null 2>&1 || command -v c++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1; then
    has_cxx="yes"
  fi
  if [ "$has_make" = "yes" ] && [ "$has_cxx" = "yes" ]; then
    log "PASS: make + C++ compiler available (source builds possible)"
  else
    warn "make and/or a C++ compiler missing — better-sqlite3 ships a prebuilt binary, so this is only needed if a source build is triggered."
    if [ "$OS_NAME" = "Darwin" ]; then
      echo "  Remedy (optional): xcode-select --install" >&2
    else
      echo "  Remedy (optional): install build-essential (apt) or equivalent" >&2
    fi
  fi

  # --------------------------------------------------------------------------
  # Section 3 — Clone or fast-forward update
  # --------------------------------------------------------------------------
  log "--- syncing repository ---"
  if [ ! -d "$INSTALL_DIR" ]; then
    log "cloning $REPO_URL ($BRANCH) into $INSTALL_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>&1 | tee -a "$LOG_FILE"
    clone_status="${PIPESTATUS[0]}"
    if [ "$clone_status" -ne 0 ]; then
      die "git clone failed (exit $clone_status) — check network access and that $REPO_URL is reachable."
    fi
  elif [ -d "$INSTALL_DIR/.git" ]; then
    porcelain="$(git -C "$INSTALL_DIR" status --porcelain 2>/dev/null || echo '')"
    if [ -n "$porcelain" ]; then
      warn "working tree at $INSTALL_DIR is dirty, skipping update; resolve manually."
    else
      log "fetching updates in $INSTALL_DIR"
      git -C "$INSTALL_DIR" fetch 2>&1 | tee -a "$LOG_FILE"
      if git -C "$INSTALL_DIR" merge --ff-only "origin/$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
        log "updated to origin/$BRANCH (fast-forward)"
      else
        warn "could not fast-forward to origin/$BRANCH (diverged history?) — leaving the tree untouched; reconcile manually."
      fi
    fi
  else
    die "$INSTALL_DIR exists but is not a git repository — move it aside or set CONDUCTOR_HOME to a fresh path."
  fi

  # --------------------------------------------------------------------------
  # Section 4 — npm installs
  # --------------------------------------------------------------------------
  log "--- installing npm dependencies ---"
  for pkg in backend frontend daemon; do
    if [ -d "$INSTALL_DIR/$pkg" ]; then
      log "npm install in $pkg/"
      (cd "$INSTALL_DIR/$pkg" && npm install) 2>&1 | tee -a "$LOG_FILE"
      npm_status="${PIPESTATUS[0]}"
      if [ "$npm_status" -ne 0 ]; then
        warn "npm install in $pkg/ exited $npm_status — see $LOG_FILE for details."
      fi
    else
      warn "directory $pkg/ not found under $INSTALL_DIR — skipping its npm install."
    fi
  done

  # Scan the log for native-build (node-gyp) failures.
  if grep -qiE 'node-gyp|node-pre-gyp|gyp ERR' "$LOG_FILE"; then
    warn "Detected a native-module build (node-gyp) issue in the install log."
    echo "  A native dependency (likely better-sqlite3) tried to build from source and failed." >&2
    if [ "$OS_NAME" = "Darwin" ]; then
      echo "  Remedy: xcode-select --install   (then re-run this installer)" >&2
    else
      echo "  Remedy: install build-essential (apt) or the Development Tools group, then re-run." >&2
    fi
    echo "  Note: the prebuilt-binary fallback usually avoids this — a clean re-run after installing the toolchain typically succeeds." >&2
  fi

  # --------------------------------------------------------------------------
  # Section 5 — Data dir + DB migrate / verify
  # --------------------------------------------------------------------------
  log "--- preparing data directory ---"
  mkdir -p "$INSTALL_DIR/data"

  # db:migrate (warn-skip if the npm script is absent).
  if node -e "process.exit(require('$INSTALL_DIR/backend/package.json').scripts['db:migrate']?0:1)" 2>/dev/null; then
    log "running db:migrate"
    (cd "$INSTALL_DIR/backend" && npm run db:migrate) 2>&1 | tee -a "$LOG_FILE"
    migrate_status="${PIPESTATUS[0]}"
    if [ "$migrate_status" -ne 0 ]; then
      warn "db:migrate exited $migrate_status — see $LOG_FILE."
    fi
  else
    warn "db:migrate script not wired yet — skipping (ROADMAP-001 surface)."
  fi

  # db:verify (always warn-only, never die).
  if node -e "process.exit(require('$INSTALL_DIR/backend/package.json').scripts['db:verify']?0:1)" 2>/dev/null; then
    log "running db:verify"
    (cd "$INSTALL_DIR/backend" && npm run db:verify) 2>&1 | tee -a "$LOG_FILE"
    verify_status="${PIPESTATUS[0]}"
    if [ "$verify_status" -ne 0 ]; then
      warn "db:verify exited $verify_status — continuing (verify is advisory)."
    fi
  else
    warn "db:verify script not wired yet — skipping."
  fi

  # --------------------------------------------------------------------------
  # Section 6 — Install Claude Code hooks
  # --------------------------------------------------------------------------
  log "--- installing Claude Code hooks ---"
  if [ -x "$INSTALL_DIR/install-hooks.sh" ] || [ -f "$INSTALL_DIR/install-hooks.sh" ]; then
    "$INSTALL_DIR/install-hooks.sh" 2>&1 | tee -a "$LOG_FILE"
    hooks_status="${PIPESTATUS[0]}"
    if [ "$hooks_status" -ne 0 ]; then
      warn "install-hooks.sh exited $hooks_status — ensure jq is installed and re-run \"$INSTALL_DIR/install-hooks.sh\"."
    else
      log "Claude Code hooks installed."
    fi
  else
    warn "install-hooks.sh not found under $INSTALL_DIR — skipping hook installation."
  fi

  # --------------------------------------------------------------------------
  # Section 7 — Symlink the conductor CLI
  # --------------------------------------------------------------------------
  log "--- linking conductor CLI ---"
  mkdir -p "$HOME/.local/bin"
  ln -sf "$INSTALL_DIR/bin/conductor" "$HOME/.local/bin/conductor"
  log "linked conductor -> $HOME/.local/bin/conductor"

  PATH_HINT_NEEDED="no"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) : ;;
    *) PATH_HINT_NEEDED="yes" ;;
  esac
  if [ "$PATH_HINT_NEEDED" = "yes" ]; then
    log "NOTE: $HOME/.local/bin is not on PATH."
    echo "  Add this line to your shell rc (~/.zshrc or ~/.bashrc):" >&2
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
  fi

  # --------------------------------------------------------------------------
  # Section 8 — Daemon service install + health poll
  # --------------------------------------------------------------------------
  log "--- installing daemon service ---"
  DAEMON_HEALTHY="no"
  if "$INSTALL_DIR/bin/conductor" daemon install 2>&1 | tee -a "$LOG_FILE"; then
    log "daemon service installed."
  else
    warn "conductor daemon install exited non-zero — continuing; you can re-run 'conductor daemon install' later."
  fi

  log "polling daemon health at $SOCK"
  tries=0
  while [ "$tries" -lt 10 ]; do
    if curl -s --unix-socket "$SOCK" http://localhost/healthz >/dev/null 2>&1; then
      DAEMON_HEALTHY="yes"
      break
    fi
    tries=$((tries + 1))
    sleep 1
  done
  if [ "$DAEMON_HEALTHY" = "yes" ]; then
    log "daemon healthy"
  else
    warn "daemon did not become healthy within 10s — check ~/.local/share/tmux-conductor/daemon.log and run 'conductor daemon status'."
  fi

  # --------------------------------------------------------------------------
  # Section 9 — Pairing, graceful degrade
  # --------------------------------------------------------------------------
  log "--- pairing ---"
  PAIRED="skipped"
  # Detect whether the `pair` subcommand exists. With no `pair)` case in the CLI,
  # this hits the Unknown-command branch and exits non-zero -> treat as ABSENT.
  if "$INSTALL_DIR/bin/conductor" pair --help >/dev/null 2>&1; then
    if [ -n "$CONDUCTOR_PAIRING_CODE" ]; then
      if "$INSTALL_DIR/bin/conductor" pair "$CONDUCTOR_PAIRING_CODE" 2>&1 | tee -a "$LOG_FILE"; then
        PAIRED="yes"
        log "paired with provided code."
      else
        warn "pairing with provided code failed — re-run 'conductor pair <code>' manually."
      fi
    elif [ -r /dev/tty ]; then
      printf 'Pairing code (blank to skip): '
      read -r code </dev/tty || code=""
      if [ -n "$code" ]; then
        if "$INSTALL_DIR/bin/conductor" pair "$code" 2>&1 | tee -a "$LOG_FILE"; then
          PAIRED="yes"
          log "paired with entered code."
        else
          warn "pairing failed — re-run 'conductor pair <code>' manually."
        fi
      else
        log "no pairing code entered — skipping."
      fi
    else
      log "non-interactive, no pairing code — skipping."
    fi
  else
    log "pairing not available yet — skipping."
  fi

  # --------------------------------------------------------------------------
  # Section 10 — Summary + next steps
  # --------------------------------------------------------------------------
  log "=== install complete ==="
  echo ""
  echo "tmux-conductor installation summary"
  echo "-----------------------------------"
  echo "  install dir:    $INSTALL_DIR"
  echo "  daemon health:  $DAEMON_HEALTHY"
  echo "  paired:         $PAIRED"
  echo "  conductor CLI:  $HOME/.local/bin/conductor"
  if [ "$PATH_HINT_NEEDED" = "yes" ]; then
    echo "  PATH note:      add 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to your shell rc"
  fi
  echo ""
  echo "Next steps:"
  echo "  conductor start          # create the tmux session and spawn agents"
  echo "  conductor list           # list configured agents / queue"
  echo "  Backend dashboard API:   http://localhost:8788"
  echo "  Frontend dashboard:      http://localhost:4321"
  echo ""
  echo "  Install log: $LOG_FILE"
}

main "$@"
