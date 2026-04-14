# UAT: Host Network Access for Scaffolded Dev Containers

> **Source task**: [`.docs/tasks/completed/005-host-network-access.md`](../../tasks/completed/005-host-network-access.md)
> **Generated**: 2026-04-14
> **Skipped**: 2026-04-14

---

## Prerequisites

- [ ] Working copy at repo root `/Users/davidtaylor/Repositories/tmux-conductor` is clean (no uncommitted scaffold output)
- [ ] `bash`, `docker` (with `docker compose` v2) available on PATH for the automated checks
- [ ] For `UAT-INT-001` only: a host dev server bound to `0.0.0.0:4321` (e.g. `astro dev --host`) and a built container from the scaffolded compose

---

## Shell / Scaffold Tests

### UAT-SH-001: scaffold.sh passes syntax check
- **Scope**: The task modified `scaffold.sh` (compose heredoc + "Next steps" output).
- **Steps**:
  1. From repo root, run the command below.
- **Command**:
  ```bash
  bash -n scaffold.sh
  ```
- **Expected Result**: Exit code `0`, no output. Any parse error means the heredoc or `echo` block is malformed.
- [ ] Pass

### UAT-SH-002: Scaffold output contains extra_hosts block
- **Scope**: Verifies the new `extra_hosts: ["host.docker.internal:host-gateway"]` entry is emitted into the generated `conductor-compose.yml`.
- **Steps**:
  1. From repo root, create the test dir and run the scaffold, then inspect the generated compose file.
- **Command**:
  ```bash
  mkdir -p ./tmp/scaffold-test && ./scaffold.sh ./tmp/scaffold-test && grep -A1 'extra_hosts:' ./tmp/scaffold-test/conductor-compose.yml
  ```
- **Expected Result**: `scaffold.sh` reports `Scaffold complete for: ./tmp/scaffold-test`. The `grep` output shows:
  ```
      extra_hosts:
        - "host.docker.internal:host-gateway"
  ```
  Indentation: 4 spaces before `extra_hosts:`, 6 spaces before the list item — matching sibling service keys (`volumes:`, `environment:`, `working_dir:`).
- [ ] Pass

### UAT-SH-003: Generated compose validates with docker compose config
- **Scope**: Confirms the new `extra_hosts` block is syntactically valid compose YAML.
- **Steps**:
  1. Run the command below (depends on `UAT-SH-002` having run and generated `./tmp/scaffold-test/conductor-compose.yml`).
- **Command**:
  ```bash
  docker compose -f ./tmp/scaffold-test/conductor-compose.yml config
  ```
- **Expected Result**: Exit code `0`. Rendered output includes the service with `extra_hosts:` → `host.docker.internal: host-gateway` mapped. If `docker` is unavailable on this host, mark this test **SKIPPED** and record the reason in the Pass comment.
- [ ] Pass

### UAT-SH-004: "Next steps" output includes Host networking block
- **Scope**: The task added a "Host networking:" section to the `scaffold.sh` final echo block.
- **Steps**:
  1. Re-run the scaffold against the same test dir and filter for the new note.
- **Command**:
  ```bash
  ./scaffold.sh ./tmp/scaffold-test | grep -A3 'Host networking:'
  ```
- **Expected Result**: Output contains exactly these lines (after the `Host networking:` header):
  ```
  Host networking:
    Reach host services from inside the container at host.docker.internal:<port>.
    Host dev servers MUST bind to 0.0.0.0 (not 127.0.0.1) to be reachable —
    e.g. 'astro dev --host' or 'vite --host 0.0.0.0'.
  ```
- [ ] Pass

---

## Documentation Tests

### UAT-DOC-001: README has Host network access section
- **Scope**: Task step 3 added a subsection to `README.md` under the scaffold / Container Mode area.
- **Steps**:
  1. From repo root, confirm the section exists and covers the required points.
- **Command**:
  ```bash
  grep -n -A8 'Host network access' README.md
  ```
- **Expected Result**: Output shows a heading (e.g. `### Host network access`) followed by prose that mentions: (a) `host.docker.internal:<port>` reachability from inside the container, (b) the `host-gateway` mapping is included for Linux portability, (c) host dev servers must bind to `0.0.0.0` with `astro dev --host` and `vite --host 0.0.0.0` as examples, and (d) a note that Docker Desktop on Mac/Windows resolves `host.docker.internal` without `extra_hosts`.
- [ ] Pass

---

## Integration Tests

### UAT-INT-001: Container reaches host dev server via host.docker.internal
- **Scope**: End-to-end verification that a container launched from the scaffolded compose can reach a host-bound service at `host.docker.internal:<port>`.
- **Prerequisites** (specific to this test):
  - Host dev server running and bound to `0.0.0.0:4321` (e.g. `astro dev --host` in another project). Confirm with `curl -sI http://127.0.0.1:4321` on the host returning a response.
  - A scaffolded project built and started: `cd ./tmp/scaffold-test && docker compose -f conductor-compose.yml up -d --build`.
- **Steps**:
  1. From the host, exec into the running container and curl the host dev server through `host.docker.internal`.
- **Command**:
  ```bash
  docker compose -f ./tmp/scaffold-test/conductor-compose.yml exec app curl -sI http://host.docker.internal:4321
  ```
- **Expected Result**: An HTTP status line (e.g. `HTTP/1.1 200 OK` or any `2xx`/`3xx`/`4xx` — the point is the TCP/HTTP round-trip succeeded, not the specific status). A connection refused / timeout / "could not resolve host" indicates the `extra_hosts` mapping or host bind is wrong.
- **Teardown**: `docker compose -f ./tmp/scaffold-test/conductor-compose.yml down && rm -rf ./tmp/scaffold-test`
- [ ] Pass

---

## Cleanup

- [ ] `rm -rf ./tmp/scaffold-test` (if any UAT-SH-* or UAT-INT-001 tests were run)
