-include .env
export

GHCR_REPO   = ghcr.io/codewizard-dt/tmux-conductor
DROPLET_IP ?=
PROJECT     = tmux-conductor
GITHUB_USER ?= $(shell gh api user --jq .login 2>/dev/null)
BACKEND_PORT ?= 8788
FRONTEND_PORT ?= 4321

.PHONY: ports ps up dev dev-build push deploy deploy-pull ssh-alias login down typecheck-backend typecheck-frontend typecheck lint-backend lint-frontend lint

## ports — print service URLs
ports:
	@echo "Dashboard API: http://localhost:$${BACKEND_PORT}"
	@echo "Dashboard UI:  http://localhost:$${FRONTEND_PORT} (dev) | http://localhost:$${BACKEND_PORT} (prod)"

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
# dev: down
# 	docker compose -f docker-compose.build.yml up --wait
dev:
	(cd frontend && npm run dev) & (cd backend && npm run dev)
	@echo "API:        http://localhost:$${BACKEND_PORT}"
	@echo "UI (dev):   http://localhost:$${FRONTEND_PORT}"

dev-build: down
	docker compose -f docker-compose.build.yml up --build --wait
	@echo "API:        http://localhost:$${BACKEND_PORT}"
	@echo "UI (dev):   http://localhost:$${FRONTEND_PORT}"

## up — pull latest GHCR images and start the production stack
up:
	docker compose pull && docker compose up -d --wait

## push — build linux/amd64 prod image and push to GHCR (bypasses CI)
## Pass PUBLIC_API_URL if the API is not on the same origin as the UI
push:
	docker buildx build --platform linux/amd64 \
		$(if $(PUBLIC_API_URL),--build-arg PUBLIC_API_URL=$(PUBLIC_API_URL),) \
		-t $(GHCR_REPO)-dashboard:latest --push \
		-f Dockerfile.prod \
		.

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

## typecheck-backend — run tsc --noEmit in backend/
typecheck-backend:
	cd backend && npx tsc --noEmit

## typecheck-frontend — run tsc --noEmit in frontend/
typecheck-frontend:
	cd frontend && npx tsc --noEmit

## typecheck — run tsc --noEmit in both backend/ and frontend/
typecheck: typecheck-backend typecheck-frontend

## lint-backend — run ESLint in backend/
lint-backend:
	cd backend && npm run lint

## lint-frontend — run ESLint in frontend/
lint-frontend:
	cd frontend && npm run lint

## lint — run ESLint in both backend/ and frontend/
lint: lint-backend lint-frontend

## strict-typecheck — run typecheck and lint in both backend/ and frontend/
strict-typecheck: typecheck lint
