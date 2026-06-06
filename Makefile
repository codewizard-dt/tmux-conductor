-include .env
export

GHCR_REPO   = ghcr.io/codewizard-dt/tmux-conductor
DROPLET_IP ?=
PROJECT     = tmux-conductor
GITHUB_USER ?= $(shell gh api user --jq .login 2>/dev/null)

.PHONY: ports ps up dev push deploy deploy-pull ssh-alias login down

## ports — print service URLs
ports:
	@echo "Dashboard API: http://localhost:$${PORT:-8788}"
	@echo "Dashboard UI:  http://localhost:$${UI_PORT:-4321} (dev) | http://localhost:$${PORT:-8788} (prod)"

## login — authenticate Docker with GHCR (run once locally and once on the VPS)
login:
	gh auth token | docker login ghcr.io -u $(GITHUB_USER) --password-stdin

## ps — show running container status
ps:
	docker compose ps

## down — stop and remove containers
down:
	docker compose -f docker-compose.yml -f docker-compose.build.yml down

## dev — build from source with hot-reload (Dockerfile.dev)
dev: down
	docker compose -f docker-compose.build.yml up --wait
	@echo "API:        http://localhost:$${PORT:-8788}"
	@echo "UI (dev):   http://localhost:$${UI_PORT:-4321}"

dev-build: down
	docker compose -f docker-compose.build.yml up --build --wait
	@echo "API:        http://localhost:$${PORT:-8788}"
	@echo "UI (dev):   http://localhost:$${UI_PORT:-4321}"

## up — pull latest GHCR images and start the production stack
up:
	docker compose pull && docker compose up -d --wait

## push — build linux/amd64 prod image and push to GHCR (bypasses CI)
## Pass PUBLIC_API_URL if the API is not on the same origin as the UI
push:
	docker buildx build --platform linux/amd64 \
		$(if $(PUBLIC_API_URL),--build-arg PUBLIC_API_URL=$(PUBLIC_API_URL),) \
		-t $(GHCR_REPO)-dashboard:latest --push \
		-f scripts/dashboard/Dockerfile.prod \
		scripts/dashboard

## deploy — sync compose file, Makefile, and .env.production to VPS then restart
deploy:
	ssh $(PROJECT) "mkdir -p /opt/$(PROJECT)"
	scp docker-compose.yml Makefile $(PROJECT):/opt/$(PROJECT)/
	scp .env.production $(PROJECT):/opt/$(PROJECT)/.env
	ssh $(PROJECT) "cd /opt/$(PROJECT) && make deploy-pull"

## deploy-pull — pull images and restart; run directly on VPS after files are synced
deploy-pull: up

## ssh-alias — upsert ~/.ssh/config Host entry for the prod server (idempotent)
## Usage: make ssh-alias DROPLET_IP=1.2.3.4
ssh-alias:
	@mkdir -p ~/.ssh && touch ~/.ssh/config
	@if grep -q "^Host $(PROJECT)$$" ~/.ssh/config; then \
		awk 'BEGIN{found=0} /^Host $(PROJECT)$$/{found=1} found && /^[[:space:]]+HostName /{sub(/^([[:space:]]+HostName ).*/, "  HostName $(DROPLET_IP)"); found=0} {print}' \
			~/.ssh/config > /tmp/.ssh_config_tmp && mv /tmp/.ssh_config_tmp ~/.ssh/config; \
		echo "Updated: Host $(PROJECT) -> $(DROPLET_IP)"; \
	else \
		printf "\nHost $(PROJECT)\n  HostName $(DROPLET_IP)\n  User root\n" >> ~/.ssh/config; \
		echo "Added: Host $(PROJECT) -> $(DROPLET_IP)"; \
	fi
