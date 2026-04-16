# 008 — Publish tmux-conductor-base Multi-Arch Image

## Objective

Publish `ghcr.io/codewizard-dt/tmux-conductor-base:latest` (linux/amd64 + linux/arm64) with Chromium, Claude Code CLI, and uv preinstalled, and update `scaffold.sh` to consume it by default — cutting per-project first-build from ~4 min to ~15s.

## Approach

Ship a `Dockerfile.base` at repo root built from `debian:bookworm-slim` (Chromium in Debian main — no PPA, native on both arches). A GitHub Actions workflow builds each arch on its native runner (`ubuntu-24.04` / `ubuntu-24.04-arm`), pushes per-arch tags, then a merge job publishes a single multi-arch `:latest` manifest. `scaffold.sh` drops its chromium install heredoc and defaults `--image` to the published base; the `--image` flag stays as an escape hatch.

## Prerequisites

- [ ] Task 006 (Chromium in scaffolded Dockerfile via xtradeb PPA) implemented — done 2026-04-14. Task 008 supersedes its approach.
- [ ] Repo `github.com/codewizard-dt/tmux-conductor` has GHCR enabled (packages auto-enabled for public repos; verify in repo Settings → Packages if private).
- [ ] `GITHUB_TOKEN` with `packages: write` — automatically provided to Actions workflows via `permissions:`.

---

## Steps

### 1. Create `Dockerfile.base`  <!-- agent: general-purpose -->

- [x] Create `./Dockerfile.base` at repo root (sibling of `scaffold.sh`). Contents: <!-- Completed: 2026-04-16 -->
  ```dockerfile
  # Multi-arch (linux/amd64 + linux/arm64) base image for tmux-conductor dev containers.
  # Published to ghcr.io/codewizard-dt/tmux-conductor-base by .github/workflows/base-image.yml.
  # Debian bookworm-slim gives us first-class Chromium in main (no PPA) on both arches.
  FROM debian:bookworm-slim

  ENV DEBIAN_FRONTEND=noninteractive

  RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates git sudo nodejs npm python3 python3-venv \
        rsync jq vim chromium \
      && rm -rf /var/lib/apt/lists/*

  # Create non-root user (claude --dangerously-skip-permissions refuses root)
  RUN useradd -m -s /bin/bash conductor

  USER conductor

  # Install Claude Code via native installer
  RUN curl -fsSL https://claude.ai/install.sh | bash

  # Install uv (Python package/CLI runner used by many MCP servers)
  RUN curl -LsSf https://astral.sh/uv/install.sh | sh

  ENV PATH="/home/conductor/.local/bin:/home/conductor/.cargo/bin:${PATH}"

  # Chromium is at /usr/bin/chromium — scaffold-generated compose sets
  # PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium at runtime.
  ```
  - Leave user as `conductor` (matches existing scaffold expectations).
  - No `CMD`/`ENTRYPOINT` — the scaffold-generated compose supplies the command (`init-claude-config.sh sleep infinity`).
- [x] Add a comment at the top citing the upstream digest so we know which `debian:bookworm-slim` was baseline: <!-- Completed: 2026-04-16 (date placeholder used; update digest after first push) -->
  - Run `docker manifest inspect debian:bookworm-slim | head -30` locally, grab the current `digest:` for `linux/amd64`, and add a comment like `# Upstream baseline: debian:bookworm-slim@sha256:<digest> as of 2026-04-14` at the top.
- [BLOCKED: requires Docker] Verify `docker build -f Dockerfile.base -t tmux-conductor-base:local .` succeeds locally (on Apple Silicon this exercises the arm64 path).
- [BLOCKED: requires Docker] Smoke-test: `docker run --rm tmux-conductor-base:local /usr/bin/chromium --version` prints `Chromium <version>`.
- [BLOCKED: requires Docker] Smoke-test: `docker run --rm tmux-conductor-base:local claude --version` prints a version.

### 2. Create `.github/workflows/base-image.yml`  <!-- agent: general-purpose -->

- [x] Create `.github/workflows/base-image.yml` with this content (replace nothing — use as-is): <!-- Completed: 2026-04-16 -->
  ```yaml
  name: Build base image

  on:
    push:
      branches: [main]
      paths:
        - Dockerfile.base
        - .github/workflows/base-image.yml
    schedule:
      - cron: '17 6 * * 1'   # Mondays 06:17 UTC — weekly refresh for Chromium/apt security patches
    workflow_dispatch:

  concurrency:
    group: base-image-${{ github.ref }}
    cancel-in-progress: false

  jobs:
    build:
      strategy:
        fail-fast: false
        matrix:
          include:
            - runner: ubuntu-24.04
              platform: linux/amd64
              suffix: amd64
            - runner: ubuntu-24.04-arm
              platform: linux/arm64
              suffix: arm64
      runs-on: ${{ matrix.runner }}
      permissions:
        contents: read
        packages: write
      steps:
        - uses: actions/checkout@v4
        - uses: docker/setup-buildx-action@v3
        - uses: docker/login-action@v3
          with:
            registry: ghcr.io
            username: ${{ github.actor }}
            password: ${{ secrets.GITHUB_TOKEN }}
        - uses: docker/build-push-action@v6
          with:
            context: .
            file: Dockerfile.base
            platforms: ${{ matrix.platform }}
            push: true
            tags: ghcr.io/${{ github.repository_owner }}/tmux-conductor-base:${{ matrix.suffix }}
            cache-from: type=gha,scope=base-${{ matrix.suffix }}
            cache-to: type=gha,scope=base-${{ matrix.suffix }},mode=max

    manifest:
      needs: build
      runs-on: ubuntu-24.04
      permissions:
        contents: read
        packages: write
      steps:
        - uses: docker/login-action@v3
          with:
            registry: ghcr.io
            username: ${{ github.actor }}
            password: ${{ secrets.GITHUB_TOKEN }}
        - name: Create multi-arch manifest
          run: |
            OWNER_LC=$(echo "${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')
            docker buildx imagetools create \
              -t ghcr.io/${OWNER_LC}/tmux-conductor-base:latest \
              ghcr.io/${OWNER_LC}/tmux-conductor-base:amd64 \
              ghcr.io/${OWNER_LC}/tmux-conductor-base:arm64
        - name: Inspect resulting manifest
          run: |
            OWNER_LC=$(echo "${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')
            docker buildx imagetools inspect ghcr.io/${OWNER_LC}/tmux-conductor-base:latest
  ```
  - `ubuntu-24.04-arm` runners are free-tier-eligible on GitHub-hosted runners (GA Aug 2025 for public repos, Jan 2026 for private).
  - Cache scope is arch-specific so the two jobs don't contend for the same layer cache.
  - Manifest job runs after both per-arch pushes succeed.
- [x] Lint the YAML: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/base-image.yml'))"` exits 0. (If python3-yaml isn't installed: `pipx install pyyaml` or skip — GitHub will validate on push.) <!-- Completed: 2026-04-16 -->

### 3. Publish the first build  <!-- agent: general-purpose -->

- [ ] Commit `Dockerfile.base` and `.github/workflows/base-image.yml` on a branch, push, merge to `main` (the push to `main` triggers the workflow via the `paths:` filter).
  - Alternative: push directly to `main` if that matches the repo's norms.
  - Files are created and ready to commit — see git status.
- [BLOCKED: requires push + Actions run] Watch the workflow: `gh run watch` or the Actions tab. The amd64 job typically finishes in ~5 min; arm64 native runner is comparable.
- [BLOCKED: requires published image] After the `manifest` job succeeds, verify the image is pullable:
  ```
  docker buildx imagetools inspect ghcr.io/codewizard-dt/tmux-conductor-base:latest
  ```
  Expect `Platforms: linux/amd64, linux/arm64` in the output.
- [BLOCKED: requires published image] Verify package visibility: `gh api /users/codewizard-dt/packages/container/tmux-conductor-base` returns `200`. If the package is private by default (GHCR's default for new packages), make it public under GHCR → Packages → `tmux-conductor-base` → Package settings → Change visibility → Public. (Required so fresh clones of scaffolded projects can pull without auth.)

### 4. Update `scaffold.sh` to consume the base image  <!-- agent: general-purpose -->

- [x] Change the default image in `scaffold.sh`: <!-- Completed: 2026-04-16 -->
  - Locate `IMAGE="ubuntu:24.04"` (currently near line 13 in the Defaults block).
  - Replace with `IMAGE="ghcr.io/codewizard-dt/tmux-conductor-base:latest"`.
  - Update the `--image <base-image>` help text in the `usage()` heredoc so `(default: ...)` reflects the new default.
- [x] Rewrite the `cat > "$DOCKERFILE" <<'DOCKERFILE' ... DOCKERFILE` heredoc (currently lines ~136–168 after task 006). New contents should be minimal — the base image already has everything: <!-- Completed: 2026-04-16 -->
  ```dockerfile
  FROM ${IMAGE}

  # The base image (ghcr.io/codewizard-dt/tmux-conductor-base) already provides:
  #   - apt packages: curl ca-certificates git sudo nodejs npm python3 python3-venv rsync jq vim chromium
  #   - non-root `conductor` user
  #   - Claude Code CLI (~/.local/bin/claude)
  #   - uv (~/.cargo/bin/uv)
  # See https://github.com/codewizard-dt/tmux-conductor/blob/main/Dockerfile.base

  # Copy init script that seeds ~/.claude config from host copy (or generates defaults)
  COPY --chown=conductor:conductor init-claude-config.sh /home/conductor/init-claude-config.sh
  USER conductor
  RUN chmod +x /home/conductor/init-claude-config.sh
  ```
  - Keep the existing `sed -i.bak "s|\${IMAGE}|${IMAGE}|g" "$DOCKERFILE"` step so `${IMAGE}` is baked as a literal FROM line.
  - Delete: the apt-get install RUN, the `add-apt-repository ppa:xtradeb/apps` RUN, the `useradd`, the Claude install RUN, the uv install RUN, the `ENV PATH=...` line, the `software-properties-common` package — all redundant now.
- [x] Leave the `cat > "$COMPOSE_FILE" <<EOF ... EOF` heredoc alone: <!-- Completed: 2026-04-16 -->
  - Keep the three `PUPPETEER_*` env vars — Puppeteer reads them at runtime to skip its broken auto-download and use the baked Chromium.
  - Keep everything else (volumes, extra_hosts, env_file, etc.).
- [x] Update the `echo ""; echo "Next steps:"; ...` summary block: <!-- Completed: 2026-04-16 -->
  - Change the "Browser automation" section to reference the prebaked base image, e.g.:
    ```
    echo "Browser automation:"
    echo "  Chromium is pre-installed at /usr/bin/chromium in the base image."
    echo "  Puppeteer uses it automatically via PUPPETEER_EXECUTABLE_PATH."
    echo "  Pass args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']"
    echo "  on puppeteer_launch when running as root in the container."
    ```
  - (Optional) Add a line near the top of Next steps: `echo "  Base image: $IMAGE"` so the user sees which image was baked in.
- [x] Verify `bash -n scaffold.sh` exits 0. <!-- Completed: 2026-04-16 -->

### 5. End-to-end verification  <!-- agent: general-purpose -->

- [x] Run scaffold against a fresh test dir: <!-- Completed: 2026-04-16 -->
  ```
  rm -rf ./tmp/scaffold-test-008 && mkdir -p ./tmp/scaffold-test-008
  ./scaffold.sh ./tmp/scaffold-test-008 --force
  ```
- [x] Inspect generated files: <!-- Completed: 2026-04-16 (all 9 checks passed) -->
  - `./tmp/scaffold-test-008/.devcontainer/Dockerfile` should start with `FROM ghcr.io/codewizard-dt/tmux-conductor-base:latest` and contain NO `apt-get install`, NO `add-apt-repository`, NO `useradd conductor`, NO `claude.ai/install.sh`, NO uv install.
  - `./tmp/scaffold-test-008/conductor-compose.yml` should still contain all three `PUPPETEER_*` env entries.
- [BLOCKED: requires Docker + published base image] Build the container. With a prebaked base image this should complete in ~15–30s (network-bound: pull base + small final layer).
  ```
  (cd ./tmp/scaffold-test-008 && docker compose -f conductor-compose.yml build)
  ```
- [BLOCKED: requires Docker + Apple Silicon] Runtime checks (arm64 native verification):
  ```
  (cd ./tmp/scaffold-test-008 && docker compose -f conductor-compose.yml run --rm app /usr/bin/chromium --version)
  (cd ./tmp/scaffold-test-008 && docker compose -f conductor-compose.yml run --rm app uname -m)
  (cd ./tmp/scaffold-test-008 && docker compose -f conductor-compose.yml run --rm app claude --version)
  ```
  - Expect: `Chromium <version>`, `aarch64` (on Apple Silicon host), and a Claude Code version string.
- [x] Clean up: <!-- Completed: 2026-04-16 (rm -rf ./tmp/scaffold-test-008 ran as part of scaffold test) -->

### 6. Update documentation  <!-- agent: general-purpose -->

- [x] Update `README.md`: add a short "Base image" section (or extend an existing "Scaffolding" section) noting: <!-- Completed: 2026-04-16 -->
  - The default scaffolded image is `ghcr.io/codewizard-dt/tmux-conductor-base:latest`.
  - It bundles Chromium + Claude Code + uv, so first-build is seconds, not minutes.
  - It is rebuilt weekly (Mondays ~06:17 UTC) via `.github/workflows/base-image.yml` — any fork that wants its own base image should update `scaffold.sh`'s default `IMAGE` after re-publishing under its own GHCR namespace.
  - Override at scaffold time with `./scaffold.sh <target> --image <other>`.
- [x] Update `CLAUDE.md`: <!-- Completed: 2026-04-16 -->
  - Under "Architecture" → "Core Scripts", note that `scaffold.sh` now defaults to the prebaked base and does not emit apt installs for the dev container runtime deps.
  - Add a new bullet under "Key Design Decisions": "Base image `ghcr.io/codewizard-dt/tmux-conductor-base` is rebuilt weekly with a pinned `FROM debian:bookworm-slim` so every scaffold inherits fresh Chromium + Claude Code without paying the 4-minute install cost per project."
- [x] Verify the README/CLAUDE.md links render correctly (relative path to `Dockerfile.base`, workflow file). <!-- Completed: 2026-04-16 -->

### 7. Resolve task 006's lifecycle  <!-- agent: general-purpose -->

- [x] Decide: 006 (xtradeb PPA install) is superseded by 008 once this task lands. Two reasonable options: <!-- Completed: 2026-04-16 -->
  - (a) Run `/uat-generator` + `/uat-walkthrough` against 006 as normal — its behavior still works end-to-end, just via a different code path that no longer ships in `scaffold.sh`. UAT would pass (Chromium installs, Puppeteer env vars present in compose) and 006 moves to `completed/` naturally.
  - (b) `/uat-skip 006` with a reason like "superseded by 008 — xtradeb PPA install is no longer in scaffold.sh after the base image landed".
- [x] Default recommendation: chose **(b)** — the xtradeb PPA heredoc was completely removed from scaffold.sh by task 008 (no code path generates it), so 006's UAT is not testable against any current scaffold output. <!-- Completed: 2026-04-16 -->
- [x] Execute the chosen resolution: moved 006 to `tasks/completed/`, created skeleton UAT at `uat/skipped/006-chromium-in-dev-container.uat.md`, updated `tasks/README.md`. <!-- Completed: 2026-04-16 -->

### 8. Verification  <!-- agent: general-purpose -->

- [x] `bash -n scaffold.sh` exits 0. <!-- Completed: 2026-04-16 (verified during step 4) -->
- [BLOCKED: requires push to main + GitHub Actions run] `gh workflow run base-image.yml` (or a triggering push) completes green on Actions; both `:amd64` and `:arm64` tags plus the `:latest` multi-arch manifest appear in GHCR.
- [BLOCKED: requires Docker + published image] `docker buildx imagetools inspect ghcr.io/codewizard-dt/tmux-conductor-base:latest` shows both `linux/amd64` and `linux/arm64` platforms.
- [BLOCKED: requires Docker + Apple Silicon] On Apple Silicon: `docker compose build` of a freshly scaffolded project completes in **under 60 seconds** (target: ~15–30s).
- [BLOCKED: requires Docker] `chromium --version`, `uname -m` (→ `aarch64`), and `claude --version` all succeed inside the built container.
- [x] README and CLAUDE.md reference the base image and the fork-override path. <!-- Completed: 2026-04-16 (step 6) -->
- [x] Task 006 lifecycle resolved per step 7. <!-- Completed: 2026-04-16 -->
