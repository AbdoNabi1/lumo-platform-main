# Cloud Runbook — Supabase + Upstash + Ory Network

Operator runbook for the cloud topology this platform now runs on, replacing the local
Docker-compose stack (Postgres, Redis, Ory self-hosted) one service at a time. This document
records **what is actually true, measured against the live services**, not what any prior plan
assumed. Where reality diverged from the plan (`docs/superpowers/plans/2026-09-04-run-platform-on-supabase-and-production-readiness.md`),
that divergence is called out explicitly rather than silently corrected.

**Never put a secret value in this file.** Name the variable; the value lives only in `.env`
(gitignored — verify with `git check-ignore -v .env` before every commit) or the deploy host's
secret manager.

---

## 1. The three managed services

| Service               | Role                                                       | Env vars                                                                |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Supabase Postgres** | Primary datastore, 39 schemas / 132 models via Prisma      | `DATABASE_URL`, `DIRECT_URL`                                            |
| **Upstash Redis**     | Cache, rate limiting, idempotency, distributed locks       | `REDIS_URL`, `REDIS_KEY_PREFIX`                                         |
| **Ory Network**       | OAuth2/OIDC (Hydra), identity (Kratos), permissions (Keto) | `ORY_SDK_URL`, `ORY_API_KEY`, `AUTH_*`, `HYDRA_*`, `KRATOS_*`, `KETO_*` |

### Supabase Postgres

Both `DATABASE_URL` and `DIRECT_URL` currently point at the **session pooler** (port `5432`), not
split between a transaction pooler and a true direct connection as an earlier plan draft assumed.
Reason: `packages/db/src/client.ts` never appends `?pgbouncer=true` to the connection string, so
the transaction pooler (port `6543`) fails every query with Postgres error `42P05` ("prepared
statement already exists" — the classic pgbouncer transaction-mode symptom). The session pooler
sidesteps this with zero code change. **This is deliberate, not a workaround pending a real fix** —
switching `DIRECT_URL` to the true direct host (`db.<project-ref>.supabase.co:5432`) is possible
but needs a value from the Supabase dashboard (Project Settings → Database → Connection string →
Direct connection), deferred this session along with the other dashboard-only tasks below.

Migrations: `node node_modules/prisma/build/index.js migrate status` from `packages/db` (load
`.env` first). Expect "Database schema is up to date!", 37 migrations, 39 schemas (re-counted
directly from `prisma migrate status`'s own output on 2026-09-04 — an earlier plan document said
38, an off-by-one miscount of the same comma-separated schema list Prisma prints).

### Upstash Redis

`REDIS_URL` is a `rediss://` (TLS) connection string, region `eu-west-1` (closest to Supabase's
`eu-west-3`). Verify: boot the runtime, `curl http://localhost:3080/readyz` → `200` with both
`postgres` and `redis` reported `healthy`.

### Ory Network

Project slug `sharp-hofstadter-ww7td17fbp`, base URL `https://sharp-hofstadter-ww7td17fbp.projects.oryapis.com`.
`ORY_API_KEY` is a **project-scoped** Personal Access Token (`ory_pat_...`), created in Ory Console
→ Project Settings → API Keys. It authenticates Identity (Kratos) and OAuth2 (Hydra) admin calls
and relation-tuple writes — but **not** the Ory Console/workspace project-management API (see
§3.2).

`KRATOS_PUBLIC_URL` points at `http://localhost:4000` — the **Ory Tunnel**
(`scripts/dev/ory-tunnel.mjs`), not the project URL directly. admin-web's `/login` route forwards
the browser's cookie header to Kratos's `sessions/whoami` to resolve the session; that only works
when Kratos is on the same registrable domain as admin-web. Ory Network is on
`*.projects.oryapis.com`, a different domain, so the tunnel mirrors it on `localhost` instead.
Start it with `node scripts/dev/ory-tunnel.mjs` before starting admin-web.

---

## 2. Verification — the three checks that prove the stack works

Run these in order. All three passing is Phase 1's actual gate (superseding the plan's original
Task 6, which assumed the Keto permission check had to pass first — it doesn't, see §3.1).

**Check 1 — `/readyz` is 200:**

```bash
curl -s http://localhost:3080/readyz
```

Expect `{"status":"healthy","components":[{"name":"postgres","status":"healthy",...},{"name":"redis","status":"healthy",...}]}`.

**Check 2 — a real Hydra-issued JWT authenticates a real API call:**

Against Ory Network (i.e. `ORY_API_KEY` is set — as it is once `.env` is loaded), also export
`DEV_CLI_CLIENT_SECRET` first (see §3.4 — a real random value, never committed) or this refuses to
run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $(node scripts/dev/mint-local-token.mjs 2>/dev/null)" \
  -H "x-tenant-id: tenant-local" \
  "http://localhost:3080/api/v1/products?tenantId=tenant-local"
```

Expect `200` with the seeded products in the body. **Verified live on 2026-09-04.**

`mint-local-token.mjs` drives a real `client_credentials` OAuth2 grant against Hydra (not a bypass)
and requires `access_token_strategy: "jwt"` on the OAuth2 client — see §3.1, this is the actual
root cause the plan didn't anticipate and had to be found by direct measurement.

**Check 3 — Keto permission check returns `{"allowed":true}`:**

```bash
curl -s -H "Authorization: Bearer $ORY_API_KEY" \
  "$ORY_SDK_URL/relation-tuples/check?namespace=permissions&object=products:read&relation=granted&subject_set.namespace=User&subject_set.object=<IDENTITY_ID>&subject_set.relation="
```

**Green as of 2026-09-05** — see §3.2 for how it was unblocked (the OPL namespace upload, which
needed a Workspace API key the operator obtained). With `KETO_READ_URL`/`KETO_WRITE_URL` now set in
`.env`, the runtime's boot log no longer prints `authorization is permissive` — real enforcement is
live. Verified **both directions**, not just the allow path: a `client_credentials` token for a
principal with no grants gets `403 {"code":"FORBIDDEN","message":"Missing permission
\"products:read\""}` on `GET /api/v1/products`; the same call with a temporary grant added for that
principal gets `200` with real data. The temporary grant and its throwaway client were removed
immediately after verifying — only `admin@morbeh.local`'s identity holds standing permissions.

---

## 3. Findings that diverged from the original plan

### 3.1 — Ory Network issues opaque access tokens by default, not JWTs (found, fixed)

Ory Network's default `access_token_strategy` is **opaque** (`ory_at_...`, 2 URL-safe segments).
`JwtVerifier` (`packages/auth/src/jwt-verifier.ts`) only accepts a real RS256 JWT verifiable
against `AUTH_JWKS_URL` — an opaque token fails verification outright. This was failing **every**
authenticated request, independent of and prior to any Keto/authorization question, and the
original plan (Task 6) did not anticipate it.

**Fix:** `access_token_strategy: "jwt"` is a per-OAuth2-client field Hydra has supported since it
introduced token strategies — not a project-level (workspace-key-gated) setting. Set on
`morbeh-admin-web` (the real client) via `scripts/ops/seed-ory-network.mjs`'s `clientBody`, and on
`morbeh-dev-cli` (the dev token-minting client) via `scripts/dev/mint-local-token.mjs`'s own
`clientBody` — two different scripts, each owning its own client, each setting the field on every
run (create **or** update — see §3.4 for why "every run" mattered here specifically). No-op against
self-hosted Hydra (already JWT by default). Verified end-to-end (Check 2 above).

### 3.2 — Ory Network's Permissions (Keto) requires subject-set tuples, and its OPL namespace needed uploading (found, fully resolved 2026-09-05)

Two independent, compounding blockers, both measured directly against the live project:

1. **Wire format.** Ory Network's OPL-compiled Permissions namespaces reject `subject_id`
   relation-tuple writes/checks outright: `HTTP 400 "subject_id is not supported; please migrate
to subject sets"`. `KetoAccessControl` (`packages/auth/src/keto.ts`) and
   `scripts/ops/seed-ory-network.mjs`'s grant script both sent `subject_id`. **Fixed**: both now
   support a `subject_set`-shaped convention (`packages/auth/src/keto.ts`'s `subjectConvention`
   option, selected automatically for Ory Network via the same signal `createOryFetch` uses for the
   API key). Verified consistent between the write side (`seed-ory-network.mjs`'s `grantTupleBody`)
   and the read side (`keto.ts`) — both send `{namespace: "User", object: <principalId>, relation:
""}` and agree with the OPL model. **Correction (caught in review):** this does _not_ reuse the
   sibling `KetoRelationshipClient` (`packages/auth/src/keto-relationships.ts`)'s subject-set
   _semantics_, only its field names — that class always forces `subject_set.namespace` equal to
   the tuple's own namespace and its subject-parsing regex cannot represent an empty relation, so it
   cannot actually express what this model needs. See `keto.ts`'s `subjectConvention` doc for the
   detail; do not point a future migration (e.g. the `ory-clients.ts` follow-up below) at that class
   as a ready-made equivalent. Self-hosted Keto (`infrastructure/docker/keto/keto.yml`) is
   unaffected — it stays on `subject_id`, its existing, working behavior.

2. **Namespace not configured.** Independent of the wire-format fix, any write/check against the
   `permissions` namespace also gets `HTTP 404 "Unknown namespace with name \"permissions\""` —
   Ory Network requires the OPL namespace to be uploaded to the project before it exists at all.
   The definition is committed at `infrastructure/ory/network/permissions.opl.ts` (a `User`
   namespace + a `permissions` namespace whose `granted` relation holds a subject-set of `User`
   members — this is _why_ the wire format above is subject-set shaped, not an arbitrary choice).

   **Uploading it needs a Workspace API key** (`ory_wak_...`, created via api.console.ory.com or
   the Ory Console's workspace-level settings) — **not** the project-scoped `ORY_API_KEY`
   (`ory_pat_...`) already in `.env`. Confirmed empirically: `ORY_API_KEY` gets `HTTP 403` calling
   `GET https://api.console.ory.com/projects/<project-id>`, the project-management API that both
   `ory patch opl` (CLI) and a direct `PATCH /projects/<id>` (API) go through.

   **Resolved 2026-09-05.** The operator generated a Workspace API key in the Ory Console
   (Workspace Settings → API Keys) and completed an interactive `ory auth login` (the `ory` CLI's
   `patch opl` command requires a real browser-based session — it does not accept a workspace or
   project API key directly via env var or flag, confirmed by testing `ORY_API_KEY`/`ORY_PAT` with
   both `patch opl` and `auth login`; both always opened the interactive OAuth flow regardless).
   Then: `npx @ory/cli patch opl --file infrastructure/ory/network/permissions.opl.ts --project
8ef585e5-0c95-46ff-b8d3-c3060591cdea --yes` → "Project updated successfully!". Verified the
   project's `services.permission.config.namespaces` changed from `[]` to a compiled-artifact
   `location` reference (a GCS URL) — confirms the CLI compiles the OPL TypeScript server-side/
   client-side into an internal representation; hand-crafting this JSON via a raw `PATCH
/projects/{id}` (which was considered and rejected) would have required reverse-engineering that
   compiled format, undocumented and not worth the risk.

   Then `ADMIN_DEV_PASSWORD='<throwaway, unused for an existing identity>' node
scripts/ops/seed-ory-network.mjs` → `Granted all 65 permissions` (not 66 — the admin
   controllers' actual permission-string count as of this commit; regenerate via the grep in that
   script's own header comment if this ever needs re-verifying). Check 3 now returns
   `{"allowed":true}`. `KETO_READ_URL`/`KETO_WRITE_URL` are enabled in `.env`; the runtime's boot
   log no longer prints the permissive-authorization warning. Verified both directions (Check 2
   above): a principal with no grants gets a real `403`, a principal with a grant gets `200`.

3. ~~**A third, unexplained blocker on the read side specifically.**~~ **RESOLVED 2026-09-04 — this
   was never a blocker.** `GET /relation-tuples/check` returning `HTTP 403 {"allowed":false}` is
   Keto's **normal "denied" answer**, not an authentication failure. Measured directly against the
   live project, three requests to the same URL:

   | Credential                | Status | Body                                                         |
   | ------------------------- | ------ | ------------------------------------------------------------ |
   | Valid `ORY_API_KEY`       | `403`  | `{"allowed":false}`                                          |
   | Deliberately invalid key  | `401`  | `{"error":{...,"message":"Access credentials are invalid"}}` |
   | No `Authorization` header | `401`  | `{"error":{...,"message":"Access credentials are invalid"}}` |

   Auth failures are `401` with an error envelope; the valid key gets `403` with a _permission_
   body. So the key authenticates the check endpoint correctly and there is no missing scope. A
   deliberately bogus namespace returns the same `403 {"allowed":false}` — the check endpoint
   answers "denied" for an unknown namespace rather than `404`-ing, which is why this looked like a
   separate failure mode from the writes (`404 "Unknown namespace"`).

   `KetoAccessControl` treating any non-200 as `false` is therefore **correct** here, not a
   workaround: `403` genuinely means denied.

   **Consequence for the unblock steps above: step 2 is sufficient.** Upload the OPL namespace,
   re-run the seed, and Check 3 should go green. No different key and no check-specific auth mode
   is needed. The only credential still required is the Workspace API key for the OPL upload itself.

A second, currently-dormant integration point (`apps/runtime/src/security/ory-clients.ts`, which
backs the zero-trust security guard Task 14 would mount) has the same gaps and has not yet been
migrated — its `fetchFn` feeds **both** the `KetoRelationshipClient` (no API key, no subject-set
support) **and** `KratosIdentityService` (also no API key), so this is an unauthenticated-Kratos
gap too, not Keto-only. Tracked as a separate follow-up, to be done before Task 14 is attempted.

### 3.3 — Outbox relay has no Kafka broker to publish to (found, confirmed, reverted per plan)

`OUTBOX_RELAY_ENABLED=true` was set and the worker started against live Supabase (94 outbox rows).
Confirmed exactly the outcome the plan anticipated: `KAFKA_BROKERS` defaults to
`localhost:19092`, nothing listens there, and the worker enters an endless `kafkajs`
`ECONNREFUSED` retry loop rather than draining anything. Reverted the flag (commented out in
`.env`, not deleted, with the finding recorded inline) rather than leaving it looping. **Deferred**
until a managed Kafka/Redpanda broker is provisioned — a separate infrastructure decision, out of
scope here.

### 3.4 — A dev token-minting script provisioned a hardcoded secret onto the live Ory Network project (found in final review, fixed)

`scripts/dev/mint-local-token.mjs` has always had a hardcoded fallback client secret
(`"morbeh-dev-cli-secret-change-me"`) — harmless before this session's work, because the script only
ever talked to an ephemeral, unauthenticated, `dsn=memory` self-hosted Hydra on `localhost:4445`
(gone on restart, nothing to leak). Fixing §3.1 above made this script work against Ory Network
too (added `ORY_API_KEY` admin auth, `access_token_strategy: "jwt"`), and it was then actually run
against the live project while verifying that fix — provisioning a `client_credentials` OAuth2
client with a well-known secret onto a real, internet-reachable IdP, with the project slug
committed in this very document. Caught in the final whole-branch review, not before.

**Impact, as measured:** anyone with read access to this repo could mint a valid
`morbeh.admin`-scoped JWT for this Ory Network project from anywhere, no other credential needed —
Hydra's token endpoint is public. Current blast radius is bounded (the runtime isn't publicly
deployed — Task 17 is deferred — and authorization is currently permissive under `APP_ENV=local`
regardless of who holds a valid token), but this is a **hard pre-deploy blocker**, not an
acceptable steady state.

**Fixed:**

1. The live `morbeh-dev-cli` client was deleted from the Ory Network project immediately
   (`DELETE /admin/clients/morbeh-dev-cli` → `204`, verified gone → `404`).
2. `mint-local-token.mjs` now refuses to run against Ory Network (detected via `ORY_API_KEY` being
   set) unless `DEV_CLI_CLIENT_SECRET` is set explicitly — the hardcoded default is only used
   against self-hosted Hydra, where it remains harmless. Re-verified end-to-end: refuses without
   the var, works with it, and the client this leaves on the project carries an operator-chosen
   secret, not the well-known one.
3. Separately, the script's client-provisioning step was create-only (`if existing, return`), so
   even the `access_token_strategy: "jwt"` fix from §3.1 would never have reached a client that
   already existed before that fix landed — also caught in review, also fixed: it now creates-or-
   updates (`PUT`) every run, matching `seed-ory-network.mjs`'s existing pattern.

**Before running this script against Ory Network again**, generate a real random value for
`DEV_CLI_CLIENT_SECRET` and keep it out of every committed file, the same as `AUTH_CLIENT_SECRET`.

### 3.5 — The browser login loop, and the two Ory settings that fix it (found, fixed)

`admin-web` redirect-looped forever on `/login?login_challenge=...`. Two distinct causes, fixed in
order:

1. **Cookie domain.** `login/page.tsx` resolves the caller's session by forwarding the browser's
   `cookie` header to `${KRATOS_PUBLIC_URL}/sessions/whoami` server-side. Its own doc comment states
   the assumption: _"localhost cookies are host-only … Kratos's session cookie (set at :4433) is
   sent by the browser to this app at :3100 too."_ True for self-hosted Kratos — same host,
   different port, and cookies are not port-scoped. False for Ory Network, which is a different
   registrable domain, so the cookie never reaches `localhost:3100` and `whoami` 401s forever.
   **Fixed** with the Ory Tunnel (`scripts/dev/ory-tunnel.mjs`), which mirrors the Network APIs on
   `localhost`; `KRATOS_PUBLIC_URL` points at it (`http://localhost:4000`), not at the project URL.

2. **Which UI renders the login form.** Kratos still redirected to Ory's own hosted login UI, which
   is not what this repo expects: `admin-web`'s `/login` _is_ Kratos's self-service login UI (it has
   a `?flow=` branch that renders the Kratos form itself, and its doc comment names
   `selfservice.flows.login.ui_url` explicitly). **Fixed** by setting Ory Console → Branding → UI
   URLs → Login UI to `http://localhost:3100/login`.

   Note this is a _different_ setting from OAuth2 → URLs → Login UI, which was set earlier: that one
   is Hydra's login provider (where OAuth2 sends the browser once the authorization request starts);
   this one is Kratos's own login form UI. Both are required, and setting only the first produces
   exactly the loop above.

**Verified 2026-09-04:** `GET /self-service/login/browser` now `303`s to
`http://localhost:3100/login?flow=…`, and that page renders Morbeh's own branded sign-in form.
**Completing a login was not verified** — entering a password is outside what the agent does; run it
by hand with the seeded `admin@morbeh.local` identity to close Task 9.

---

## 4. Deferred this session — needs a dashboard credential or an operator decision

Explicit per user direction: skip anything needing a new credential from a web dashboard this
session, and surface it here rather than silently treating it as done.

| Item                                          | What's needed                                                                         | Where documented                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| Custom Kratos identity schema upload          | Not currently needed — `preset://email` is in use; only relevant if that ever changes | `infrastructure/ory/network/README.md` |
| Object storage (Supabase Storage)             | S3 access keys from Supabase dashboard                                                | Plan Task 11                           |
| Payments (Stripe test mode)                   | `sk_test_...` / `whsec_...` from Stripe dashboard                                     | Plan Task 12                           |
| `DIRECT_URL` → true direct connection         | Direct connection string from Supabase dashboard                                      | §1 above                               |
| Outbox relay                                  | A managed Kafka/Redpanda broker                                                       | §3.3 above                             |
| Mount the zero-trust security guard (Task 14) | §3.2 is resolved; the `ory-clients.ts` follow-up (§3.2) is the remaining blocker      | Plan Task 14                           |
| Expanded e2e coverage (Task 15)               | A completed browser login (see §3.5) — does **not** depend on §3.2 (now resolved)     | Plan Task 15 · §3.5                    |
| Deployment (Task 17)                          | Explicit human confirmation before any public deploy                                  | Plan Task 17                           |
| Observability export (Task 18)                | A managed OTLP collector endpoint                                                     | Plan Task 18                           |

## 5. What's actually done and verified this session

- Redis wired, `/readyz` green (Task 1).
- Runtime + admin-web Ory API-key wiring for admin calls (Tasks 2, 3).
- Windows production build unblocked via Developer Mode (Task 7).
- Ory Network project provisioned; OAuth2 client + admin identity seeded and idempotent (Task 0, 5
  partial — permission grants still blocked on §3.2).
- **A real authenticated `200` on a real API route, proven end-to-end** (Task 6, via §3.1's fix).
- Rich demo dataset: 10 products, 3 categories, a brand, price list + prices, a warehouse,
  inventory, 3 customers, 3 orders (placed/paid/refunded), a promotion, 3 reviews, 2 content
  blocks — all through real use-cases, idempotently, safe to re-run (Task 8).
- Outbox relay finding confirmed and documented (Task 10, deferred per §3.3).
- Keto authorization migrated to Ory Network's subject-set model in code, unit-tested; live
  verification deferred per §3.2.
