---
description: Authenticate a test user (user|guest) and export session token for UAT tools — never touches disk, never logs credentials
argument-hint: [--role=user|guest] [--login-endpoint=<path>] [--signup-endpoint=<path>]
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Always obey `.docs/guides/task-lifecycle.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**


# UAT Auth

Authenticates a stable test user for UAT runs and exports a session token into the Bash environment for subsequent API calls and Puppeteer cookie injection. Credentials never touch disk and are never emitted in logs, tool-call arguments, or summaries.

---

## Prime Directive: Credential Hygiene

These rules are **non-negotiable**. A single violation invalidates the run.

- **Never emit a literal credential value** as part of any Bash command text, text output, summary, or tool-call argument. Not in thinking, not in reasoning, not in completion reports.
- Only **shell-expanded env-var references** (e.g. `"$UAT_TEST_PASSWORD"`) are permitted in command text. The agent writes the variable reference; the shell resolves the value at execution time.
- **Never write credentials to any file** — including `.env*`, cookie jars on disk, log files, screenshots, or scratch scripts.
- **Cookie jars are permitted only in `/tmp/uat-auth-*.jar`** with restrictive mode (`chmod 0600`) and **must be removed** at end of run.
- All user-facing mentions of the test email are **masked** as `test-***@example.test`. Never print the real `uat-user@example.test` / `uat-guest@example.test` address in summaries shown to the user.

---

## Scope

- **Roles supported**: `user` (default), `guest`.
- **Out of scope**: admin roles, OAuth/SSO flows (Google, GitHub, magic links). If requested, **fail-closed** immediately with a diagnostic and exit non-zero.
- **Stable test emails**: `uat-user@example.test`, `uat-guest@example.test`. These are reused across runs — there is **no teardown** of the test accounts themselves, only of session state.

---

## Phase 1: Detect Auth Scheme

Read `CLAUDE.md`, `README.md`, and `.env.example` for auth-scheme hints. Look for markers such as:

- `JWT_SECRET`, `AUTH_ENDPOINT`, `SESSION_SECRET`
- Route literals: `/api/auth/login`, `/api/login`, `/auth/signin`
- Framework signals: NextAuth, Supabase, Clerk, Auth0, Lucia

Accept explicit overrides via arguments:

- `--login-endpoint=<path>` — login URL (e.g. `/api/auth/login`)
- `--signup-endpoint=<path>` — signup URL (e.g. `/api/auth/signup`)
- `--token-json-path=<jq-path>` — JSON path to extract the token (default `.token`)
- `--cookie-name=<name>` — session cookie name for UI injection (default `session`)

If no scheme is determinable **and** no override args are provided, emit the diagnostic and exit non-zero:

```
[FAIL: uat-auth: auth scheme undetectable — add auth endpoints to CLAUDE.md or pass --login-endpoint]
```

---

## Phase 2: Resolve Credentials

**Email** is always the stable pattern based on role:

- `--role=user` (default) → `uat-user@example.test`
- `--role=guest` → `uat-guest@example.test`

**Password resolution order:**

1. `$UAT_TEST_PASSWORD` if already set in the environment — export it into the Bash env for this run.
2. Otherwise, generate a strong random password via `openssl rand -base64 24` and capture it directly into the `UAT_TEST_PASSWORD` env var. **Never print it, never write it to disk, never echo the command's output.**

Export `UAT_TEST_EMAIL` and `UAT_TEST_PASSWORD` into the Bash session scope **for this run only**. They must be unset in the cleanup phase.

---

## Phase 3: Login-First, Signup-Fallback

Attempt login first. Only fall back to signup on `401` or `404`.

**Login attempt** — one Bash call, env-var expansion only, no literal credentials in the command text:

```bash
curl -sS -o /tmp/uat-auth-resp.json -w '%{http_code}' -X POST "$UAT_LOGIN_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<EOF
{"email":"$UAT_TEST_EMAIL","password":"$UAT_TEST_PASSWORD"}
EOF
```

**Inspect status:**

- **2xx** → extract the token: `jq -r '.token // .access_token // .data.token' /tmp/uat-auth-resp.json` and `export UAT_AUTH_TOKEN=<captured>`.
- **401 / 404** → signup attempt using the same template pointing at `$UAT_SIGNUP_URL`, then retry login **exactly once**.
- **Retry still fails** → exit with:
  ```
  [FAIL: uat-auth: login failed after signup — <status>]
  ```
  **Do not print the response body** — it may contain secrets, session IDs, or reflected credentials.

**Immediately `rm -f /tmp/uat-auth-resp.json`** on both success and failure paths.

---

## Phase 4: UI Session Injection

For UI tests, the caller must pass `--inject-cookie` (set by `/uat-auto` when Puppeteer is active).

Use `puppeteer_set_cookies` with:

- `name=<cookie-name>` (from `--cookie-name`, default `session`)
- `value=$UAT_AUTH_TOKEN` (or `$UAT_SESSION_COOKIE` if the app uses a separate session cookie)
- `domain` derived from the test's `Page:` URL
- `path=/`
- `httpOnly=true`
- `secure=true` when the `Page:` URL is `https`

**Never** use `puppeteer_type` to enter a password into a login form. If the app has no API login and requires form login, **fail-closed**:

```
[FAIL: uat-auth: app requires form login — not supported in v1 for credential-safety]
```

---

## Phase 5: Masked Summary

Emit **exactly** this format to stdout. No variables are interpolated into the text — only the mask is shown:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UAT AUTH READY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Role:     user
Email:    test-***@example.test
Token:    $UAT_AUTH_TOKEN (env var, not printed)
Cookie:   injected into Puppeteer (if --inject-cookie)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Phase 6: Cleanup Contract

The caller is responsible for invoking cleanup when done:

```bash
unset UAT_AUTH_TOKEN UAT_TEST_EMAIL UAT_TEST_PASSWORD UAT_SESSION_COOKIE
rm -f /tmp/uat-auth-*.jar /tmp/uat-auth-*.json
```

`/uat-auto` performs this in its Step 6 **regardless of pass/fail** outcome.

---

## Important Rules

### No interaction
- **No `AskUserQuestion`**, no prompts, no clarifying questions. On any ambiguity, **fail-closed** with a diagnostic and exit non-zero.

### No literal credentials
- Every Bash call referencing the password uses `"$UAT_TEST_PASSWORD"` shell expansion.
- The agent must **never** emit the literal credential value in any tool-call argument, thinking block, summary, or text output.

### No disk persistence
- Cookie jars live only in `/tmp/`, are created with mode `0600`, and are deleted at end of run.
- No `.env*` writes, no log files, no scratch scripts containing credentials.

### No screenshots of login state
- If a screenshot is taken, it must be **post-navigation to an authenticated page** — never of a filled login form, never of a page with the email/password field populated.

### No OAuth/SSO / admin
- OAuth, SSO, magic-link, and admin-role flows are out of scope. If requested, **fail-closed** with a diagnostic and exit non-zero.

---

## Begin Auth

Now execute Phase 1 through Phase 6 in order:

1. **Phase 1** — detect the auth scheme from `CLAUDE.md`, `README.md`, `.env.example`, and override args. Fail-closed if undetectable.
2. **Phase 2** — resolve the role-based email and the password (env var or `openssl rand`). Export into the Bash session.
3. **Phase 3** — login first; on 401/404, signup and retry login once. `rm` the response file on both paths.
4. **Phase 4** — if `--inject-cookie`, set the session cookie in Puppeteer. Never type passwords into forms.
5. **Phase 5** — emit the masked summary exactly as specified.
6. **Phase 6** — the caller (typically `/uat-auto`) runs the cleanup contract at end of its run.

**Start now — detect the auth scheme and begin.**
