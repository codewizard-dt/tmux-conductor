# 005 — Host Network Access for Scaffolded Dev Containers

## Objective

Add `extra_hosts: ["host.docker.internal:host-gateway"]` to the scaffolded `conductor-compose.yml` so dev containers can reach host-bound dev servers (e.g. an Astro/Vite server on `localhost:4321`), and document the host-side bind requirement.

## Approach

`host.docker.internal` already resolves on Docker Desktop for Mac/Windows, but not on Linux unless `host-gateway` is mapped explicitly. Adding `extra_hosts` makes the scaffolded compose portable across all platforms. The companion failure mode — host servers bound to `127.0.0.1` rather than `0.0.0.0` — is purely host-side and only needs documentation in the scaffold output and README.

## Prerequisites

- [ ] Task 001 (Initial Scaffolding) completed — `scaffold.sh` exists and emits `conductor-compose.yml`

---

## Steps

### 1. Update scaffold.sh compose template  <!-- agent: general-purpose -->

- [x] In `scaffold.sh`, locate the `cat > "$COMPOSE_FILE" <<EOF ... EOF` block (the heredoc that writes `conductor-compose.yml`)
- [x] Add an `extra_hosts` entry to the service definition, immediately after the `environment:` block
  - The new lines to append inside the heredoc:
    ```
        extra_hosts:
          - "host.docker.internal:host-gateway"
    ```
  - Indentation must match the surrounding service keys (4 spaces for the key, 6 spaces for the list item) so it sits at the same level as `volumes:`, `environment:`, `working_dir:`, etc.
- [x] Verify the heredoc still parses by running `bash -n scaffold.sh`

### 2. Update scaffold.sh "Next steps" output  <!-- agent: general-purpose -->

- [x] In the final `echo` block at the bottom of `scaffold.sh` (the "Next steps:" section), add a "Host networking" note after the existing auth note
  - Suggested wording (one block, three echo lines):
    ```
    echo ""
    echo "Host networking:"
    echo "  Reach host services from inside the container at host.docker.internal:<port>."
    echo "  Host dev servers MUST bind to 0.0.0.0 (not 127.0.0.1) to be reachable —"
    echo "  e.g. 'astro dev --host' or 'vite --host 0.0.0.0'."
    ```
- [x] Verify with `bash -n scaffold.sh`

### 3. Update README.md  <!-- agent: general-purpose -->

- [x] Open `README.md` at the repo root
- [x] Find the section that documents the scaffold workflow (or the "Dev container" / "Scaffolding" section, whichever exists). If no such section exists, add a short "Host network access" subsection near the scaffolding instructions.
- [x] Add a paragraph explaining:
  - From inside the container, host services are reachable at `host.docker.internal:<port>`
  - The scaffolded compose maps `host-gateway` for Linux portability
  - Host dev servers must bind to `0.0.0.0` (not `127.0.0.1`) — give the Astro `astro dev --host` and Vite `vite --host 0.0.0.0` examples
  - Brief mention that on Docker Desktop Mac/Windows `host.docker.internal` works without the `extra_hosts` entry, but the entry is included for Linux compatibility

### 4. Verification  <!-- agent: general-purpose -->

- [x] `bash -n scaffold.sh` exits 0
- [x] Run `./scaffold.sh ./tmp/scaffold-test` (create `./tmp/scaffold-test` first as an empty dir) and confirm:
  - The generated `./tmp/scaffold-test/conductor-compose.yml` contains the `extra_hosts:` block under the service
  - `docker compose -f ./tmp/scaffold-test/conductor-compose.yml config` parses without error (requires Docker installed; if not available locally, document this skipped check in the UAT)
- [ ] Manually verify (with a host dev server bound to `0.0.0.0:4321`) from inside a built container: `curl -sI http://host.docker.internal:4321` returns an HTTP response <!-- Deferred to UAT -->
- [x] Clean up `./tmp/scaffold-test/` <!-- Updated: 2026-04-14 -->

<!-- Updated: 2026-04-14 -->
All automated verification steps passed. Manual curl test deferred to UAT (requires a running host dev server + built container).

---
**UAT**: [`.docs/uat/skipped/005-host-network-access.uat.md`](../../uat/skipped/005-host-network-access.uat.md) *(skipped)*
