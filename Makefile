-include .env
export

PROJECT       = tmux-conductor
DROPLET_IP   ?=
GITHUB_USER  ?= $(shell gh api user --jq .login 2>/dev/null)
BACKEND_PORT ?= 8788
API_PORT     ?= 8080
FRONTEND_PORT ?= 4321

.PHONY: dev docker-app docker-app-down deploy deploy-app ports ssh-alias \
	typecheck typecheck-host typecheck-api typecheck-frontend \
	lint lint-host lint-api lint-frontend

## dev — run all three services natively & concurrently
dev:
	(cd host-server && npm run dev) & (cd app/api && npm run dev) & (cd app/frontend && npm run dev)

## docker-app — run app/api + app/frontend locally via Docker Compose
docker-app:
	cd app && docker compose up --build

## docker-app-down — stop the local app Docker Compose stack
docker-app-down:
	cd app && docker compose down

## deploy — update the native host-server on the VPS
## One-time setup: install deploy/host-server.service as
##   /etc/systemd/system/tmux-conductor-host-server.service
deploy:
	ssh $(PROJECT) "cd /opt/$(PROJECT) && git pull && cd host-server && npm ci && sudo systemctl restart tmux-conductor-host-server"

## deploy-app — force an App Platform redeploy of app/api + app/frontend
## Push-to-deploy (deploy_on_push) usually handles this automatically.
deploy-app:
	doctl apps update $$(doctl apps list --format ID,Spec.Name --no-header | awk '/tmux-conductor/{print $$1}') --spec deploy/app.yaml

## ports — print service URLs
ports:
	@echo "host-server: http://localhost:$${BACKEND_PORT}"
	@echo "app/api:     http://localhost:$${API_PORT}"
	@echo "app/frontend: http://localhost:$${FRONTEND_PORT}"

## typecheck-host — run tsc --noEmit in host-server/
typecheck-host:
	cd host-server && npx tsc --noEmit

## typecheck-api — run tsc --noEmit in app/api/
typecheck-api:
	cd app/api && npx tsc --noEmit

## typecheck-frontend — run tsc --noEmit in app/frontend/
typecheck-frontend:
	cd app/frontend && npx tsc --noEmit

## typecheck — run tsc --noEmit in host-server, app/api, and app/frontend
typecheck: typecheck-host typecheck-api typecheck-frontend

## lint-host — run ESLint in host-server/
lint-host:
	cd host-server && npm run lint

## lint-api — run ESLint in app/api/ (skips if no lint script)
lint-api:
	cd app/api && if npm run | grep -q '^  lint$$'; then npm run lint; else echo "app/api: no lint script, skipping"; fi

## lint-frontend — run ESLint in app/frontend/
lint-frontend:
	cd app/frontend && npm run lint

## lint — run ESLint across host-server, app/api, and app/frontend
lint: lint-host lint-api lint-frontend

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
