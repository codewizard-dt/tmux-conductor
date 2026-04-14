# 006 — Chromium in Scaffolded Dev Container

## Objective

Install a native arm64/amd64 Chromium in the scaffolded dev container and configure Puppeteer to use it, so `puppeteer-mcp-claude` can launch a browser on Apple Silicon hosts (where Puppeteer's auto-downloaded x86_64 Chrome fails with `rosetta error: failed to open elf`).

## Approach

Modify the scaffolded `.devcontainer/Dockerfile` to register the `ppa:xtradeb/apps` PPA and install `chromium` plus its runtime libs (using Ubuntu 24.04's `t64` package names). Modify the generated `conductor-compose.yml` to set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` + `PUPPETEER_SKIP_DOWNLOAD=true` + `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` so Puppeteer skips its broken auto-download and uses the system binary. Rollout is scaffold-only — existing projects must re-run `./scaffold.sh --force` + `docker compose build` to pick up the change.

## Prerequisites

- [ ] Task 001 (Initial Scaffolding) completed — `scaffold.sh` exists, emits Dockerfile and compose file
- [ ] Task 005 (Host Network Access) merged, since both tasks edit the same scaffold heredocs

---

## Steps

### 1. Update scaffold.sh Dockerfile heredoc  <!-- agent: general-purpose --> <!-- Updated: 2026-04-14 06:55 -->

> **Implementation note (2026-04-14):** Trimmed the explicit lib list down to just `chromium`. The xtradeb chromium .deb on noble declares its own runtime deps via `Depends:`, so apt resolves libnss3/libatk*/etc automatically. Smaller, more maintainable Dockerfile diff with identical runtime image.

- [x] In `scaffold.sh`, locate the `cat > "$DOCKERFILE" <<'DOCKERFILE' ... DOCKERFILE` block (currently around lines 136–157)
- [x] Extend the first `apt-get install` line to also install `software-properties-common` (needed for `add-apt-repository`):
  - Current last package in the list is `vim`. Keep the trailing backslash and add `software-properties-common` to the end of the package list, preserving alphabetical-ish flow.
- [x] Add a new `RUN` block **immediately after the existing apt-get install RUN** (before `useradd`) that registers the PPA and installs Chromium + its runtime libs:
  ```dockerfile
  # Install Chromium for puppeteer-mcp-claude (native arm64/amd64; avoids Puppeteer's
  # broken auto-downloaded x86_64 binary on Apple Silicon). xtradeb PPA ships a
  # snap-free chromium deb for both architectures on Ubuntu 24.04 (noble).
  RUN add-apt-repository -y ppa:xtradeb/apps \
      && apt-get update \
      && apt-get install -y --no-install-recommends \
           chromium \
           ca-certificates fonts-liberation \
           libnss3 libnspr4 \
           libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
           libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
           libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
           libasound2t64 libxshmfence1 libglib2.0-0t64 \
      && rm -rf /var/lib/apt/lists/*
  ```
  - Indentation: match the existing `RUN apt-get update && apt-get install -y --no-install-recommends \` style in the same heredoc.
  - The `t64` suffix is required on noble (time64 transition) — do NOT use the old non-`t64` names; they do not exist on Ubuntu 24.04.
  - **Actual implementation:** trimmed to `apt-get install -y --no-install-recommends chromium` only — see implementation note above.
- [x] Verify the heredoc still parses: `bash -n scaffold.sh`

### 2. Update scaffold.sh compose heredoc with Puppeteer env vars  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 06:55 -->

- [x] In `scaffold.sh`, locate the `cat > "$COMPOSE_FILE" <<EOF ... EOF` block (currently around lines 238–261)
- [x] Inside the `environment:` list (after the existing `CONDUCTOR_STATE_DIR` and `CONDUCTOR_AGENT_NAME` entries, before `extra_hosts:`), append three new entries:
  ```yaml
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
      - PUPPETEER_SKIP_DOWNLOAD=true
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
  ```
  - Indentation: 6 spaces before the `-` to match the existing environment entries
- [x] Verify with `bash -n scaffold.sh`

### 3. Update scaffold.sh "Next steps" output  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 06:55 -->

- [x] In the final `echo` block at the bottom of `scaffold.sh` (after the "Host networking:" section added by task 005), append a "Browser automation" note:
  ```
  echo ""
  echo "Browser automation:"
  echo "  Chromium is installed at /usr/bin/chromium for puppeteer-mcp-claude."
  echo "  Puppeteer will use it automatically via PUPPETEER_EXECUTABLE_PATH."
  echo "  Pass args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']"
  echo "  on puppeteer_launch when running as root in the container."
  ```
- [x] Verify with `bash -n scaffold.sh`

### 4. Verification  <!-- agent: general-purpose --> <!-- Completed: 2026-04-14 07:10 -->

- [x] `bash -n scaffold.sh` exits 0
- [x] Create empty test dir and scaffold it — confirmed `add-apt-repository -y ppa:xtradeb/apps` + `chromium` package present in generated Dockerfile and all three `PUPPETEER_*` env entries present in generated compose.
- [x] Build the container and verify Chromium is installed:
  - Build succeeded in ~259s (chromium install step ~215s). First attempt hit a transient Docker Desktop containerd snapshotter bug (`failed to prepare extraction snapshot ... parent snapshot does not exist`) during the export/unpack phase — unrelated to the Dockerfile, resolved by retrying.
  - `docker compose run --rm app /usr/bin/chromium --version` → `Chromium 145.0.7632.75 built on Ubuntu 24.04.4 LTS` ✓
- [x] Clean up: `docker compose down --rmi local -v` + `rm -rf ./tmp/scaffold-test-006`
