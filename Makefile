-include .env
export

BACKEND_PORT ?= 8788
FRONTEND_PORT ?= 4321

.PHONY: usage dev ports \
	typecheck typecheck-host typecheck-frontend \
	lint lint-host lint-frontend

## usage — show available make targets
usage:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## dev — run the host-server and frontend natively & concurrently
dev:
	(cd host-server && npm run dev) & (cd frontend && npm run dev)

## ports — print service URLs
ports:
	@echo "host-server:  http://localhost:$${BACKEND_PORT}"
	@echo "frontend:     http://localhost:$${FRONTEND_PORT}"

## typecheck-host — run tsc --noEmit in host-server/
typecheck-host:
	cd host-server && npx tsc --noEmit

## typecheck-frontend — run tsc --noEmit in frontend/
typecheck-frontend:
	cd frontend && npx tsc --noEmit

## typecheck — run tsc --noEmit in host-server and frontend
typecheck: typecheck-host typecheck-frontend

## lint-host — run ESLint in host-server/
lint-host:
	cd host-server && npm run lint

## lint-frontend — run ESLint in frontend/
lint-frontend:
	cd frontend && npm run lint

## lint — run ESLint across host-server and frontend
lint: lint-host lint-frontend
