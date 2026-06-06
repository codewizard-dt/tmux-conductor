# Docker Compose Deployment with GitHub Actions

End-to-end guide: build images on GitHub Actions, push to GHCR, auto-deploy to a Linux VPS via a self-hosted runner. No inbound firewall ports required on the VPS.

### Target quick-reference

| Target | When to run |
|---|---|
| `make ports` | Check which URLs/ports the stack is using |
| `make login` | First-time GHCR auth on a new machine or VPS |
| `make dev` | Day-to-day local development (hot-reload, builds from source) |
| `make up` | Start production stack from pre-built GHCR images |
| `make down` | Stop and remove all containers |
| `make ps` | Check container health/status |
| `make push` | Build and push prod images manually (CI bypass) |
| `make deploy` | Full manual deploy: sync files to VPS + pull + restart |
| `make deploy-pull` | Run on VPS directly after files are already synced |
| `make ssh-alias` | Add/update the `~/.ssh/config` entry for the VPS |

---

## Architecture

- **GitHub Actions** (cloud) builds Docker images on every push to `main` and pushes them to GHCR.
- **GHCR** stores versioned images (`latest` + semver tag).
- **Self-hosted runner** (daemon on the VPS) picks up the `deploy` job after the build succeeds, pulls the new images, and restarts the stack.
- **VPS** runs only pre-built images — it never builds anything.
- **Local dev** uses a Docker Compose overlay to build from source.

```
git push main
    └── GitHub Actions: build job
            ├── builds backend / frontend / caddy images
            ├── pushes :latest + :<version> to GHCR
            └── triggers deploy job (self-hosted runner on VPS)
                    ├── docker compose pull
                    └── docker compose up -d --wait
```

---

## Prerequisites

- Docker Engine and Docker Compose v2 on the VPS (`docker compose` subcommand)
- SSH access to VPS as root
- GitHub repository (private — see Security Notes)
- GitHub CLI (`gh`) installed locally and on the VPS (for GHCR auth)

---

## Part 1 — Docker Compose Structure

### Three compose files

**`docker-compose.yml`** — production base. All services use pre-built GHCR images. No `build:` context. This is what runs on the VPS.

```yaml
services:
  backend:
    image: ghcr.io/<ORG>/<PROJECT>-backend:latest
  frontend:
    image: ghcr.io/<ORG>/<PROJECT>-frontend:latest
  caddy:
    image: ghcr.io/<ORG>/<PROJECT>-caddy:latest
```

**`docker-compose.build.yml`** — local dev overlay. Adds `build:` context and source volume mounts. Used with:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build --wait
```

**Additional overlays** (optional) — for services not always needed (e.g. local ML sidecars). Layered on top as needed.

### Production Dockerfiles

Create `Dockerfile.prod` for each service:

- Multi-stage build: builder stage installs deps and compiles; runtime stage is lean.
- Set `ENV NODE_ENV=production` in the runtime stage.
- Use `npm install` (not `npm ci`) in Docker builder stages — `npm ci` silently omits platform-specific native bindings when the lock was generated on a different OS.
- Never run dev servers in production containers. For static frontends: build with the framework, serve `dist/` with `serve` or nginx. Install `wget` in the runtime image for Docker healthchecks.
- For backends: compile to `dist/`, run with `node`.
- Install `openssl` if the project uses Prisma.

### Reverse proxy (Caddy)

If using Caddy, create a `Dockerfile.caddy` that copies the `Caddyfile` into `FROM caddy:2-alpine` and push it to GHCR as another service image. Do not use `tls internal` for public domains — Caddy will provision a Let's Encrypt cert automatically. Ensure port 80 is open on the VPS for the ACME HTTP-01 challenge.

---

## Part 2 — GitHub Actions Workflows

### Build and push: `.github/workflows/build.yml`

Triggers on push to `main`. Builds each service image in a matrix and pushes two tags (`:latest` and `:<version>`). After all images push, the `deploy` job runs on the self-hosted runner.

```yaml
name: Build & Push

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  OWNER: <ORG>

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    strategy:
      matrix:
        include:
          - image: <PROJECT>-backend
            context: ./backend
            dockerfile: ./backend/Dockerfile.prod
          - image: <PROJECT>-frontend
            context: ./frontend
            dockerfile: ./frontend/Dockerfile.prod
          - image: <PROJECT>-caddy
            context: .
            dockerfile: ./Dockerfile.caddy

    steps:
      - uses: actions/checkout@v4

      - name: Get version
        id: version
        run: echo "VERSION=$(node -p "require('./backend/package.json').version")" >> $GITHUB_OUTPUT

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.dockerfile }}
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.OWNER }}/${{ matrix.image }}:latest
            ${{ env.REGISTRY }}/${{ env.OWNER }}/${{ matrix.image }}:${{ steps.version.outputs.VERSION }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: [self-hosted, <LABEL>]
    steps:
      - name: Pull new images and restart stack
        working-directory: /opt/<PROJECT>
        run: |
          docker compose pull
          docker compose up -d --wait
```

Replace `<ORG>`, `<PROJECT>`, and `<LABEL>` with your values. `<LABEL>` must match the label set when registering the runner (Step 4 below).

**Notes:**

- `needs: build` ensures deploy only runs after all matrix jobs succeed.
- `--wait` blocks until all healthchecks pass. Remove it if services have no healthchecks.
- The version is read from `backend/package.json`. Adjust the path if your layout differs.

### Security scanning: `.github/workflows/security.yml`

Runs CodeQL SAST and Gitleaks secret detection on every push and PR.

```yaml
name: Security

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  codeql:
    name: SAST (CodeQL)
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      actions: read
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/autobuild@v3
      - uses: github/codeql-action/analyze@v3

  secret-scan:
    name: Secret Detection (Gitleaks)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Part 3 — VPS Bootstrap

Run `.scripts/startup.sh` on a fresh Ubuntu 24.04 VPS to install all required dependencies:

- zsh, curl, git, make, unzip, openssl
- Docker CE + docker-compose-plugin
- GitHub CLI
- Oh My Zsh; zsh as default shell for root and UID 1000 user

```bash
bash .scripts/startup.sh
```

Copy the compose file and secrets to the VPS (do this once manually; never automate `.env` copies):

```bash
scp docker-compose.yml root@<VPS_IP>:/opt/<PROJECT>/
scp .env.production root@<VPS_IP>:/opt/<PROJECT>/.env
```

The VPS only ever needs `docker-compose.yml` + `.env`. All other config (Caddyfile etc.) should be baked into the images.

---

## Part 4 — Self-Hosted Runner Setup

### Step 1 — Register the runner on GitHub

1. Go to **Settings → Actions → Runners → New self-hosted runner**
2. Select **Linux / x64**
3. Copy the registration token (single-use, expires in 1 hour)

On the VPS:

```bash
mkdir -p /opt/actions-runner && cd /opt/actions-runner

curl -fsSL -o runner.tar.gz \
  https://github.com/actions/runner/releases/download/v2.331.0/actions-runner-linux-x64-2.331.0.tar.gz
tar xzf runner.tar.gz && rm runner.tar.gz

./config.sh \
  --url https://github.com/<ORG>/<REPO> \
  --token <REGISTRATION_TOKEN> \
  --name <RUNNER_NAME> \
  --labels <LABEL> \
  --work /opt/actions-runner/_work \
  --unattended
```

| Placeholder | Example |
|---|---|
| `<ORG>/<REPO>` | `acme/my-app` |
| `<REGISTRATION_TOKEN>` | Token from GitHub UI |
| `<RUNNER_NAME>` | `vps-prod` |
| `<LABEL>` | `prod` |

### Step 2 — Install as a systemd service

```bash
cd /opt/actions-runner
./svc.sh install
./svc.sh start
```

Verify:

```bash
systemctl status "actions.runner.*"
# Expected: active (running)
systemctl is-enabled "actions.runner.*"
# Expected: enabled
```

The runner appears as **Idle** under **Settings → Actions → Runners** in the GitHub UI.

### Step 3 — Authenticate Docker with GHCR

`docker compose pull` needs GHCR credentials persisted on the VPS.

**Option A — GitHub CLI:**

```bash
gh auth token | docker login ghcr.io -u <GITHUB_USER> --password-stdin
```

**Option B — Personal Access Token:**

Create a PAT with `read:packages` scope at **GitHub → Settings → Developer settings → Tokens (classic)**, then:

```bash
echo <PAT> | docker login ghcr.io -u <GITHUB_USER> --password-stdin
```

Credentials are stored in `/root/.docker/config.json`. Output should be `Login Succeeded`.

### Step 4 — Verify the first deploy

1. **Settings → Actions → Runners** — runner shows **Idle**
2. Push a commit to `main`
3. Runner status changes to **Running** while the deploy job executes
4. Deploy job shows a green checkmark in the Actions UI
5. On the VPS: `docker compose -f /opt/<PROJECT>/docker-compose.yml ps` — `STATUS` column shows `Up` or `healthy`

---

## Makefile Reference

Useful targets for day-to-day operations (keep a `Makefile` in the repo root):

```makefile
-include .env
export

GHCR_REPO  = ghcr.io/<ORG>/<PROJECT>
DROPLET_IP ?= <VPS_IP>
PROJECT    = $(shell basename $(CURDIR))

.PHONY: ports ps up dev push deploy deploy-pull ssh-alias login down

# --- Helpers ---

## ports — print all service URLs based on .env values
ports:
	@echo "App (HTTPS): https://$(or $(CADDY_DOMAIN),localhost)$(if $(filter-out 443,$(or $(HTTPS_PORT),443)),:$(HTTPS_PORT),)"
	@echo "Backend:  http://localhost:$(BACKEND_PORT)"
	@echo "Frontend: http://localhost:$(FRONTEND_PORT)"
	@echo "Database: localhost:$(DB_PORT)"

## login — authenticate Docker with GHCR (run once locally and once on the VPS)
login:
	gh auth token | docker login ghcr.io -u <GITHUB_USER> --password-stdin

## ps — show running container status
ps:
	docker compose ps

## down — stop and remove containers
down:
	docker compose down

# --- Local Development ---

## dev — build from source with hot-reload bind mounts (Dockerfile.dev)
dev:
	docker compose -f docker-compose.yml -f docker-compose.build.yml up --wait
	@$(MAKE) --no-print-directory ports

# --- Production / CI bypass ---

## up — pull latest GHCR images and start the production stack (no build)
up:
	docker compose pull && docker compose up -d --wait

## push — build linux/amd64 prod images and push to GHCR (bypasses CI)
push:
	docker buildx build --platform linux/amd64 \
		-t $(GHCR_REPO)-backend:latest --push \
		-f backend/Dockerfile.prod backend
	docker buildx build --platform linux/amd64 \
		-t $(GHCR_REPO)-frontend:latest --push \
		-f frontend/Dockerfile.prod frontend
	docker buildx build --platform linux/amd64 \
		-t $(GHCR_REPO)-caddy:latest --push \
		-f Dockerfile.caddy .

## deploy — sync compose file, Makefile, and .env.production to VPS then restart
deploy:
	ssh $(PROJECT) "mkdir -p /opt/$(PROJECT)"
	scp docker-compose.yml Makefile $(PROJECT):/opt/$(PROJECT)/
	scp .env.production $(PROJECT):/opt/$(PROJECT)/.env
	ssh $(PROJECT) "cd /opt/$(PROJECT) && make deploy-pull"

## deploy-pull — alias for `up`; run directly on the VPS after syncing files
deploy-pull: up

## ssh-alias — upsert ~/.ssh/config Host entry for the prod server (idempotent)
## Usage: make ssh-alias DROPLET_IP=1.2.3.4
ssh-alias:
	@mkdir -p ~/.ssh && touch ~/.ssh/config
	@if grep -q "^Host $(PROJECT)$$" ~/.ssh/config; then \
		awk 'BEGIN{found=0} /^Host $(PROJECT)$$/{found=1} found && /^[[:space:]]+HostName /{sub(/^([[:space:]]+HostName ).*/, "  HostName $(DROPLET_IP)"); found=0} {print}' \
			~/.ssh/config > /tmp/.ssh_config_tmp && mv /tmp/.ssh_config_tmp ~/.ssh/config; \
		echo "Updated: Host $(PROJECT) → $(DROPLET_IP)"; \
	else \
		printf "\nHost $(PROJECT)\n  HostName $(DROPLET_IP)\n  User root\n" >> ~/.ssh/config; \
		echo "Added: Host $(PROJECT) → $(DROPLET_IP)"; \
	fi

```

---

## Sizing Guide

| Scenario | VPS |
|---|---|
| Small app (≤4 containers, no ML) | $12/mo — 1 vCPU, 2 GB |
| Medium app (4–8 containers) | $24/mo — 2 vCPU, 4 GB |
| App with ML sidecars (TTS/STT) | $48/mo — 2 vCPU, 8 GB |

---

## Security Notes

- **Keep the repo private.** Self-hosted runners on public repos are dangerous — fork PRs can execute arbitrary code on the VPS. If the repo must go public, disable fork PR runs: **Settings → Actions → General → Fork pull request workflows from outside collaborators → Require approval**.
- **Registration tokens are short-lived.** The token from Step 1 is single-use and expires within one hour. The runner exchanges it for a long-lived credential stored in `/opt/actions-runner/.credentials`. To rotate, re-run `config.sh --replace` with a new token.
- **The runner runs as root** on a single-tenant VPS. If you want a lower-privilege setup, create a dedicated user: `useradd -m -G docker runner`, then re-run `config.sh` and `svc.sh install` as that user.
- **Never commit `.env` or credentials.** GitLab CI / GitHub Actions secret detection will flag them.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Runner shows **Offline** | `systemctl restart "actions.runner.*"` |
| `docker compose pull` — 401 / permission denied | Re-run Step 3 (GHCR auth) |
| Deploy job stays **Queued** indefinitely | Runner is offline or label mismatch — verify runner is **Idle** in GitHub UI and `runs-on` labels match |
| `docker compose up --wait` times out | A healthcheck is failing — `docker compose ps` and `docker compose logs <service>` |
| Images build but wrong version deployed | Confirm `:latest` tag is being pushed and `docker compose pull` is pulling `:latest`, not a pinned digest |
