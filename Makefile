-include .env
export

BACKEND_PORT ?= 8788
FRONTEND_PORT ?= 4321

.PHONY: usage dev start ports \
	typecheck typecheck-host typecheck-frontend \
	lint lint-host lint-frontend \
	hooks-install

## usage — show available make targets
usage:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## dev — run the host-server and frontend natively & concurrently
dev:
	npm run dev

## start — build the frontend and run host-server without hot reload
start:
	npm start

## ports — print service URLs
ports:
	@echo "host-server:  http://localhost:$${BACKEND_PORT}"
	@echo "frontend:     http://localhost:$${FRONTEND_PORT}"

## typecheck-host — run tsc --noEmit in host-server/
typecheck-host:
	npm run typecheck --workspace host-server

## typecheck-frontend — run tsc --noEmit in frontend/
typecheck-frontend:
	npm run typecheck --workspace ui

## typecheck — run tsc --noEmit in host-server and frontend
typecheck:
	npm run typecheck

## lint-host — run ESLint in host-server/
lint-host:
	npm run lint --workspace host-server

## lint-frontend — run ESLint in frontend/
lint-frontend:
	npm run lint --workspace ui

## lint — run ESLint across host-server and frontend
lint:
	npm run lint

## hooks-install — point git at the tracked .githooks/ dir (run once per clone)
hooks-install:
	git config core.hooksPath .githooks
