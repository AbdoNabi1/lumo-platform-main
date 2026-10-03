# Handoff — Morbeh, Step 0 + Step 1 (merchant dashboard live, login working, G-82 closed)

You are continuing work another session started. Everything below was verified in that session.
Do not re-derive it; build on it. Where this file says "verify", verify — everything else is fact.

## 0. Who you are working with

- The owner is **non-technical** and writes in **plain Egyptian Arabic**. Reply in plain Egyptian
  Arabic, short sentences, no jargon without a one-line explanation. Code, commands, file names and
  variable names stay in English inside backticks.
- They do every dashboard action themselves (Railway, Supabase, Ory). You give **one step at a
  time**, numbered, saying exactly which screen, which button, what to type. Then you wait for their
  screenshot or pasted log and read it carefully before the next step.
- When something fails, say plainly what failed and why, then the fix. Never blame them. If you
  were wrong, say so in one sentence and correct it.
- They are paying per token. Be economical: grep before reading, read line ranges not whole files,
  don't re-run full suites more than the gates below require, don't restate long context back.

## 1. Hard rules — non-negotiable, no exceptions even if asked

1. Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main` (the shell cwd resets — always
   `cd` there). Remote `https://github.com/AbdoNabi1/lumo-platform-main.git`. Work and push **only**
   on branch `morbeh/w0-w17-w12`. **Never force-push.** Never `--no-verify`. Never raise the lint
   warning cap. **Never stage `.claude/worktrees/`** (stage explicit paths, never `git add -A`/`.`).
2. **Never set `TENANT_MODE=multi`** in any env file, example, manifest, CI config, or instruction
   to the owner.
3. **You never connect to any database** (Supabase or otherwise) for any reason. If SQL must run,
   write it and the owner runs it in Supabase's SQL Editor. Migrations: the owner runs them from the
   Railway service's Console:
   `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`
4. **Never print, log, echo or repeat any secret**: `ORY_API_KEY`, client secrets, DB/Redis
   passwords, HMAC secrets, tokens, card data. If the owner pastes one in chat, don't repeat it; tell
   them it should be rotated. Secrets go into Railway variables by the owner, never into chat or git.
5. If the permission classifier denies an action, do not work around it — tell the owner.
6. Conventional Commits, **lowercase subject start** (commitlint rejects uppercase), one task per
   commit, end every message with:
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
7. Every push to `morbeh/w0-w17-w12` redeploys the Railway services that track it. Before pushing,
   tell the owner a redeploy will happen.

## 2. Host quirks (Windows 11, Git Bash)

- `turbo` is broken here. Never run bare root scripts (`pnpm test`, `pnpm typecheck`, `pnpm build`).
  Use: per package `pnpm.cmd --filter <name> run typecheck|lint|test`; repo-wide
  `pnpm.cmd -r --workspace-concurrency=4 run typecheck` and
  `pnpm.cmd -r --workspace-concurrency=4 --no-bail run test`; plus `pnpm.cmd arch`.
  **Never run the full typecheck and the full suite at the same time.**
- admin-web's package name is **`admin-web`** (not `@platform/admin-web`). A wrong `--filter` prints
  "No projects matched" and exits 0 — read the output, not the exit code.
- Known flakes under concurrency only (re-run the file alone before calling it a regression):
  `wire-security-provisioning.test.ts`, `packages/http/src/server.test.ts`,
  `apps/admin-web/src/lib/api/route-contract.test.ts`, `apps/admin/src/http/public-auth-routes.test.ts`.
- No Python, no `gh`. Shell quoting with apostrophes/backslashes breaks: for any non-trivial edit
  script, write a `.cjs` file to the scratchpad with the Write tool and run it with `node`.
- Tenant guards: `node scripts/dev/check-prisma-tenant-where.mjs` must stay at 0.

## 3. What is live right now (Railway project "focused-achievement" + Supabase)

| Railway service        | Role        | Config                                                                                                                                                               |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lumo-platform-main`   | Runtime API | `RAILWAY_DOCKERFILE_PATH=infrastructure/docker/runtime.Dockerfile`, no start command, domain `https://lumo-platform-main-production-9b60.up.railway.app` → port 8080 |
| `earnest-vision`       | Worker      | same Dockerfile, start command `sh -c "cd /app/apps/runtime && node --import tsx src/worker.ts"`, `EVENT_TRANSPORT=postgres`                                         |
| storefront (name: ask) | Storefront  | `RAILWAY_DOCKERFILE_PATH=infrastructure/docker/web.Dockerfile`, no start command — renders seed products live from the API                                           |
| `Redis`                | Redis       | private network                                                                                                                                                      |

Verified: API `/readyz` healthy; worker drained the outbox (`pending=0, dead_letters=0`); Finance
ledger posts real journals (G-83 closed); storefront renders. The API currently runs `APP_ENV=local`
with **placeholder** `AUTH_ISSUER_URL`/`AUTH_JWKS_URL` (`auth.morbeh.local`) — composition throws
without them (`apps/runtime/src/composition.ts:246`, "no fake identity provider", D-048), so they
were set to dummies just to boot. **Nobody can log in to anything today.**

Railway facts learned the hard way (all documented in `infrastructure/railway/README.md`):

- There is **no root `railway.json` on purpose**; `apps/runtime/src/railway-config.test.ts` fails if
  one is added. Each service picks its image with the `RAILWAY_DOCKERFILE_PATH` variable.
- Config-as-code is deprecated (new services cannot opt in); the per-service `*.railway.json` files
  are documentation only. A root config overrides every service's dashboard settings.
- A dashboard start command runs from `/app` (not the image WORKDIR) and in exec form (no shell) —
  hence `sh -c "cd … && …"`. Image `CMD` defaults keep their WORKDIR.
- Railway injects `PORT=8080`; the public domain's target port must match what the process listens
  on. `preDeployCommand` never ran on this project. Trial plan caps a service at 1 GB RAM.
- No BuildKit `--mount=type=cache` in any Dockerfile (Railway rejects it; a test pins this).
- Railpack fallback ("No start command detected") means `RAILWAY_DOCKERFILE_PATH` is missing or the
  wrong repo is connected (a decoy `AbdoNabi1/lumo-platform-main-FUQV` exists in the picker; the
  right branch shows "Found workspace with 83 packages").

Supabase: direct host is IPv6-only and unreachable from Railway. `DATABASE_URL` = Transaction pooler
(port 6543) **with `?pgbouncer=true`**; `DIRECT_URL` = Session pooler (`…pooler.supabase.com:5432`,
user `postgres.<ref>`).

## 4. The approved plan order (owner approved 2026-10-03)

1. **Merchant dashboard (`apps/admin-web`) live + real login + close G-82** ← this handoff
2. WP-18 real tax / shipping / package weight
3. Real email sending (G-49 — break it out of WP-6; provider choice: Resend free tier first)
4. Finish WP-14 (T14.3 add-ons/credits, T14.6, T14.7 screens) + wire G-78 entitlements into a request path
5. WP-8 storefront look + SEO/CMS
6. WP-15 platform control plane
7. Later, only once there are real merchants/traffic: WP-2/3/4/5/7/9, redesigned for no Kafka.

Decisions recorded in that review: Kafka is off (`EVENT_TRANSPORT=postgres`), can be switched on
later with no data migration (README §8.7; check G-80's topic inventory first). WP-11's T11.5 (CDC
proof on Kafka) is **not applicable** under this transport. WP-5's model string `claude-opus-5` is
stale (current: `claude-opus-5-5`; Haiku 4.5 `claude-haiku-4-5-20251001` for cheap calls). WP-3
(ClickHouse) and WP-6's Temporal dependency are deferred for cost; WP-6 should use the existing
scheduler. WP-2's collector publishes straight to Kafka (`config.ts` refuses
`TRACKING_INGEST_ENABLED` under postgres), so WP-2 needs a redesign before it can run.

## 5. Task 0 — record the plan (one docs commit, do this first)

Add a new top `## Status — 2026-10-03` section to `docs/plans/UNIFIED-ROADMAP.md` stating: the
deployment is live (what runs where, one paragraph), the approved order in §4 above, and the
decisions in §4's last paragraph. Do not rewrite older sections. Also commit this handoff file.
Commit: `docs(plans): record the 2026-10-03 review and approved order`. Don't push yet.

## 6. Task 1 — merchant dashboard live with real login, G-82 closed

### 6.1 Read first (line ranges where you can)

- `docs/operations/ADMIN_WEB_ENVIRONMENT_CONTRACT.md` — the full env contract (admin-web needs
  `AUTH_ISSUER_URL`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`,
  `HYDRA_PUBLIC_URL`, `HYDRA_ADMIN_URL`, `KRATOS_PUBLIC_URL`, `COOKIE_DOMAIN`, `RUNTIME_API_URL`,
  `TENANT_DEFAULT_ID`, `APP_ENV`; redirect URI is `https://<admin-origin>/auth/callback`).
- `apps/admin-web/src/lib/env.ts`, `src/lib/auth/{config,session,current-user,ory-admin}.ts`,
  `src/middleware.ts`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`.
- `apps/runtime/src/config.ts` lines 60–100 and 290–340 (outside `APP_ENV=local`,
  `KETO_WRITE_URL`, `KRATOS_PUBLIC_URL`, `KRATOS_ADMIN_URL` become required — `config.ts:300`).
- `apps/runtime/src/composition.ts` around 240–260 (JWT verifier wiring).
- G-82 in `docs/architecture/23-platform-gap-register.md` (full detail) and `docs/KNOWN_GAPS.md`.
- `docs/operations/KETO_TENANT_MIGRATION.md` — proves an **Ory Network project already exists** and
  was used on 2026-09-21 (65 tenant-qualified grants `tenant/tenant-local/<permission>`). Note its
  finding: Ory Network answers 2xx to burst writes and persists only a prefix — read back every write.
- `scripts/ops/register-oauth-client.mjs`, `scripts/ops/production-check.mjs`.
- `infrastructure/docker/admin-web.Dockerfile` (CMD `node apps/admin-web/server.js`, `ENV PORT=3100`,
  health `/api/healthz`).

### 6.2 The blocker to resolve BEFORE asking the owner to do anything

The contract requires admin-web and the identity origins to **share a registrable parent domain**
so Kratos's session cookie reaches admin-web (`COOKIE_DOMAIN`). On this deployment admin-web would
be on `*.up.railway.app` and Ory Network on `*.oryapis.com` — they cannot share cookies (and
`up.railway.app` is very likely on the Public Suffix List — verify). Find out from the code exactly
which step needs the shared cookie (the `login/page.tsx`/`middleware.ts` bridge) and whether the
pure OAuth2 authorization-code + PKCE flow through Ory's hosted login UI works **without** it.

Then present the owner, in plain Arabic, the real options with cost and effort, e.g.:

- (a) Ory Network's hosted login/redirect flow, no shared cookie — if the code can support it with
  a small change (best if true);
- (b) buy a domain (~$10/year) and put admin-web and an Ory **custom domain** under it — verify
  whether Ory custom domains require a paid plan;
- (c) self-host Kratos+Hydra(+Keto) on Railway under the same domain (configs exist in
  `infrastructure/docker/{kratos,hydra,keto}` and `infrastructure/k8s/71–73`), ~$3–6/month but
  identity security becomes the owner's responsibility.
  Recommend one. **Stop and wait for the owner's choice.** Do not design a new login mechanism
  without that approval (the contract calls it "out of scope … open item until decided").

### 6.3 After the owner chooses — implement

- Make the runtime API accept the real issuer: `AUTH_ISSUER_URL` must equal the issuer exactly
  (trailing slash matters), `AUTH_JWKS_URL` → `<issuer>/.well-known/jwks.json` (verify for Ory
  Network), `AUTH_AUDIENCE` must match the OAuth2 client's audience.
- Register the admin-web OAuth2 client (redirect `https://<admin-origin>/auth/callback`, logout
  `https://<admin-origin>/logout`) — have the owner do it in the Ory console or run the existing
  script with the key in their own env; the secret goes straight into Railway variables.
- **G-82:** the API exposes `/openapi.json`, `/docs`, `/metrics` and `/readyz` failure detail to
  anonymous callers because they are gated on `APP_ENV === "local"`, and G-82 records that `local`
  is the only value that boots. Find why `development`/`staging`/`production` don't boot on this
  deployment (likely the Ory vars in `config.ts:300` plus anything else that refines on APP_ENV),
  make `APP_ENV=production` bootable once the real Ory vars are present, and make sure in
  non-local envs: no docs/openapi publicly, `/metrics` not anonymous, `/readyz` returns status only
  (no host, no driver error text). Tests first, each one killed by a mutation you actually run.
  Close G-82 in both gap registers with the commit hash.
- Deploy admin-web as a new Railway service: `RAILWAY_DOCKERFILE_PATH=infrastructure/docker/admin-web.Dockerfile`,
  no start command, healthcheck `/api/healthz`. Railway injects `PORT=8080` — verify the Next
  standalone `server.js` honours `PORT`, and tell the owner which port to target on the domain.
  `RUNTIME_API_URL` should use Railway's private network to the API if reachable (verify the
  private hostname/port), else the public domain. Extend `apps/runtime/src/railway-config.test.ts`
  to pin admin-web's CMD the way it pins the storefront's, and add an admin-web row to the table at
  the top of `infrastructure/railway/README.md`. Give the owner the **exact** variable list for
  each service (names + where each value comes from), nothing extra — last time a bulk paste of
  `.env.example` put 79 variables on the API.
- First merchant login: create the owner's identity in Ory and give it admin permissions through
  the platform's own bootstrap/provisioning path (search `bootstrapSecurity`, T10.6 provisioning,
  D-068) — do not hand-write Keto tuples unless that path cannot do it; if you must, they are
  tenant-qualified `tenant/tenant-local/<permission>` and every write is read back.
- Remove nothing from the seed yet (replacing demo data is a later step); just say so to the owner.

### 6.4 Gates before each push

Per touched package: typecheck, lint, test. Before the final push of Task 1: repo-wide typecheck,
then (not simultaneously) repo-wide `--no-bail` test, `pnpm.cmd arch`, tenant guard script at 0.
Report exact numbers. Run at least one mutation per new test and say which ones were killed.

### 6.5 Done when

- The owner opens the admin-web domain, logs in with a real Ory identity, lands on the dashboard,
  and the products page shows the products from Supabase (screenshot from them).
- The API runs with a real issuer, `APP_ENV` is not `local`, and `/openapi.json`, `/docs`,
  `/metrics` are not public; `/readyz` leaks nothing (you curl it yourself and show the result).
- G-82 closed in both registers; README table updated; all gates green; pushed.
- Final message to the owner in plain Arabic: what now works, what it costs per month (Ory plan they
  ended up on), what remains (Step 2 = WP-18), and any secret they should rotate.

## 7. Stop and ask the owner instead of guessing when

- any option costs money (paid Ory plan, domain purchase, Railway plan upgrade);
- a step would delete or overwrite live data or Ory identities;
- the code's premise is false (already fixed, file missing) — then also append it to
  `docs/plans/BLOCKERS.md` in that file's existing shape.
