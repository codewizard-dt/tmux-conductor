Scaffold the deployment infrastructure described in the guide above for the project at: __PROJECT_DIR__

## Your task

Inspect the project's structure (directory layout, existing Dockerfiles, package.json/pyproject.toml/go.mod, existing Makefile, existing docker-compose files), then create or update the files listed below using real project values — never placeholder strings like `<ORG>`, `<PROJECT>`, or `<LABEL>`.

**If you cannot confidently identify the services, their entrypoints, or their runtimes from the files you find, stop and ask the user before creating anything.**

---

### Step 1 — Detect services

Identify each deployable service by scanning for directories (or the repo root for single-service repos) that contain any of:

- `package.json` — Node.js. Check `scripts.dev` / `scripts.start` for the dev command and inspect `dependencies` to identify the framework: Vite, Next.js, Express, Fastify, etc.
- `pyproject.toml` or `requirements.txt` — Python. Check dependencies for `fastapi`/`uvicorn`, `flask`, `django`, etc.
- `go.mod` — Go.
- `Cargo.toml` — Rust.

For each service record: **runtime · framework · dev command · port · whether it proxies to another service**.

---

### Step 2 — Create or update files

#### 1. `.github/workflows/security.yml` — always overwrite
Generic; no project-specific content. Include:
- **CodeQL** — matrix over the detected languages (use `python`, `javascript-typescript`, `go`, etc. as appropriate)
- **Gitleaks** secret detection with `fetch-depth: 0`

#### 2. `.github/workflows/build.yml` — create only if absent
Fill in real image names, Dockerfile paths, and runner label. Do not touch if the file already exists.

#### 3. `.gitleaks.toml` — create only if absent

#### 4. `Makefile` — merge Docker targets if a Makefile already exists; create from scratch if not
Add only the targets from the guide that are not already present. Never remove or reformat existing targets.
Set `GITHUB_USER ?= $(shell gh api user --jq .login 2>/dev/null)` so auth resolves at runtime rather than being hardcoded.

#### 5. `docker-compose.build.yml` — create only if absent
Local dev overlay. Layered on top of `docker-compose.yml` via:
```
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build --wait
```
For each service:
- Add a `build:` block pointing to the service directory and its `Dockerfile.dev`
- Bind-mount the full source tree into the working directory (e.g. `./backend:/app`)
- **Shield installed dependencies with an anonymous volume** declared immediately after the source mount. This prevents the host bind mount from overwriting the container's installed packages:
  - Node.js: `- /app/node_modules`
  - Python venv: `- /app/.venv`
  - Add others (e.g. `/app/.cargo`) for any runtime that installs into a subdirectory
- **Override service URLs that hardcode `localhost`**: inside Docker, `localhost` resolves to the container itself. Replace with the compose service name (e.g. `DATABASE_URL: postgresql+asyncpg://postgres:postgres@db:5432/mydb`)
- **Vite / Node frontend proxy targets**: Vite's dev-server proxy runs server-side (Node.js), so its `target` also can't use `localhost` to reach the backend container. Pass the backend address via an env var in the compose service (e.g. `PROXY_TARGET: http://backend:8000`) and update `vite.config.ts` to read it:
  ```ts
  target: process.env.PROXY_TARGET ?? 'http://localhost:8000',
  ```
- **Vite `--host` flag**: the Vite dev server binds to `127.0.0.1` by default and is unreachable via Docker port mapping. Override the container command: `command: npx vite --host` (do not bake `--host` into the Dockerfile so the image stays usable outside Docker)
- Wire `depends_on` with `condition: service_healthy` for any service that requires the database to be ready before starting

#### 6. `Dockerfile.dev` + `docker-entrypoint.sh` per service — create only if absent
Minimal, fast-to-build dev image. The guiding principle: **install dependencies in the image; let source arrive via the bind mount at runtime**.

**Use a `docker-entrypoint.sh` watcher script** for Node.js and Python services so that adding or removing a dependency inside the container is not needed — the entrypoint watches the manifest file for changes and automatically reinstalls + restarts the dev server. This makes the developer workflow seamless: edit `package.json` or `pyproject.toml` on the host, save, and the container self-heals.

**Node.js entrypoint pattern** (`docker-entrypoint.sh`, place alongside `Dockerfile.dev`):
```sh
#!/bin/sh
set -e

npm install

HASH=$(md5sum package.json | cut -d' ' -f1)
APP_PID=""

start_app() {
  npx vite --host &   # or: npm run dev &, npx ts-node-dev src/index.ts &, etc.
  APP_PID=$!
}

stop_app() {
  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" 2>/dev/null
    wait "$APP_PID" 2>/dev/null || true
    APP_PID=""
  fi
}

start_app

while sleep 3; do
  NEW=$(md5sum package.json | cut -d' ' -f1)
  if [ "$NEW" != "$HASH" ]; then
    echo "[entrypoint] package.json changed — reinstalling..."
    npm install
    HASH=$NEW
    stop_app
    start_app
  fi
done
```

**Python entrypoint pattern** (`docker-entrypoint.sh`):
```sh
#!/bin/sh
set -e

pip install -e ".[dev]" --quiet   # or: pip install -r requirements.txt --quiet

MANIFEST=${MANIFEST_FILE:-pyproject.toml}   # override to requirements.txt if needed
HASH=$(md5sum "$MANIFEST" | cut -d' ' -f1)
APP_PID=""

start_app() {
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &   # adjust module path
  APP_PID=$!
}

stop_app() {
  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" 2>/dev/null
    wait "$APP_PID" 2>/dev/null || true
    APP_PID=""
  fi
}

start_app

while sleep 3; do
  NEW=$(md5sum "$MANIFEST" | cut -d' ' -f1)
  if [ "$NEW" != "$HASH" ]; then
    echo "[entrypoint] $MANIFEST changed — reinstalling..."
    pip install -e ".[dev]" --quiet
    HASH=$NEW
    stop_app
    start_app
  fi
done
```

The `Dockerfile.dev` copies and `chmod +x`s the entrypoint, then sets it as `CMD`:

- **Node.js frontend (Vite / CRA / Next dev mode)**: `FROM node:22-alpine`, `COPY package*.json ./`, `RUN npm ci`, `COPY docker-entrypoint.sh ./`, `RUN chmod +x docker-entrypoint.sh`, `CMD ["/bin/sh", "./docker-entrypoint.sh"]`. Do not `COPY` source. Adjust the `start_app` command in the entrypoint for the framework (Vite uses `--host` in the entrypoint; remove the compose `command:` override for Vite if using the entrypoint).
- **Node.js backend (Express / Fastify / etc.)**: same Dockerfile pattern; update `start_app` in the entrypoint to run the server with hot-reload (e.g. `node --watch src/index.js` or `npx ts-node-dev src/index.ts`).
- **Python (FastAPI/uvicorn)**: `FROM python:3.11-slim`, copy the manifest (`pyproject.toml` or `requirements.txt`), install deps, copy and `chmod +x` the entrypoint, set `CMD` to run it. Adjust the uvicorn module path (`app.main:app`) and install command to match the project. Do not `COPY` source.
- **Go**: `FROM golang:1.22-alpine`, copy `go.mod` + `go.sum`, `RUN go mod download`, `CMD ["go", "run", "./cmd/server"]` (adjust path). Use `air` for hot-reload if the project already depends on it. No entrypoint watcher needed — Go has no install-time manifest changes that require a restart.
- **Other runtimes**: apply the same principle — install deps in the image; source arrives via bind mount; dev server runs with hot-reload; add an entrypoint watcher if the runtime has a lockfile-driven install step.

---

### Deriving the GHCR org/repo slug

Priority order:
1. `name` field in `package.json` or `pyproject.toml` — strip service-specific suffixes (`-backend`, `-frontend`, `-api`) to recover the project base name
2. GitHub remote URL (`git remote get-url origin`) — owner becomes the org; combine with the base name above or the directory name
3. Project directory name as a last resort

Image naming convention: `ghcr.io/<org>/<project>-<service>`
Examples: `ghcr.io/acme/myapp-backend`, `ghcr.io/acme/myapp-frontend`
