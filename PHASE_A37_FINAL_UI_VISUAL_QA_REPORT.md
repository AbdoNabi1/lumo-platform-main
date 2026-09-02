# Phase A.37 — Final Visual QA & Design System Closure

Date: 2026-08-16
Scope: apps/admin-web UI redesign (soft lavender-white canvas, white sidebar, pastel KPI icons,
unified design-system primitives). This is a QA/verification pass, not a redesign. No colors,
visual concepts, or auth architecture were changed. No commits/pushes were made.

## 1. Environment Status

- Docker: **unavailable**. `docker ps` / `docker info` timed out / produced no response after
  20s in this environment (consistent with prior session records that WSL2/Docker is broken on
  this machine). No containers (Postgres, Hydra, Kratos, Keto, Admin API) could be started.
- Dev server: `apps/admin-web` runs standalone via `pnpm --filter admin-web exec next dev` on
  port 3100 (via `.claude/launch.json`, already configured with a `storefront` and `admin-web`
  entry). This works and was used for what QA is possible without the auth backend.
- One operational note (not a code defect): running `next build` (production) concurrently with
  a live `next dev` server against the same `apps/admin-web/.next` directory corrupted the dev
  server's webpack runtime (`Cannot find module './vendor-chunks/...'`, `routes-manifest.json`
  ENOENT), producing transient 500s. This was caused by my own overlapping commands, not the
  application. Fixed by stopping the dev server, deleting `.next`, and restarting `next dev`
  cleanly after the build finished. No source files were involved.

## 2. Authentication Status — BLOCKED

- `middleware.ts` gates every route except `/login`, `/consent`, `/auth/callback`, `/logout`,
  and `/api/healthz`. Any request without a valid session JWT (verified via Hydra's JWKS,
  `AUTH_JWKS_URL` = `http://localhost:4444/.well-known/jwks.json`) is redirected into Hydra's
  `/oauth2/auth` endpoint.
- `/login` itself does nothing useful standalone: with no `login_challenge` (from Hydra) or
  `flow` (from Kratos) query param it immediately `redirect("/")`s, which middleware then bounces
  back to Hydra. Both arrival shapes require a live Hydra + Kratos to originate the challenge/flow
  — there is no dev-mode credential shortcut in the code (correctly — the task forbids weakening
  middleware to bypass Hydra/Kratos).
- Because Docker is unavailable, Hydra/Kratos/Keto could not be started, so **no real
  `login_challenge` or Kratos `flow` could be obtained**, and no authenticated route (dashboard,
  customers, products, orders, discounts, content, automations, analytics, marketing,
  integrations, settings, order/customer detail, /forbidden, RTL/theme/responsive states on real
  data) could be reached and visually inspected in a real browser.
- Verified concretely: navigating to `/`, `/login`, and any other in-app route with no session
  cookie all end at `localhost:4444/oauth2/auth?...` (connection target unreachable — Hydra is
  down), exactly as `middleware.ts` specifies. This confirms the gating logic itself is working
  as designed; it just means no page content behind it can be visually QA'd right now.

**No dev credentials could be located** that bypass this (checked `.env.example`, seed scripts,
`infrastructure/docker/kratos`/`hydra` configs) — the seed identities are Kratos-side (created by
a running Kratos instance), not usable without the stack up.

## 3. Routes Tested

Given the auth blocker, only unauthenticated-reachable behavior was exercised in the real browser:

- `/` and `/login` — confirmed both correctly redirect into the Hydra OAuth2 authorize endpoint
  when no session cookie is present (expected/secure behavior).
- `/api/healthz` — confirmed reachable without auth (required — it's a dependency-free health
  probe, explicitly exempted in `PUBLIC_PREFIXES`).

No screenshots were captured of authenticated screens (dashboard, sidebar, customers, products,
orders, order detail, Arabic dashboard, mobile dashboard) — there is no honest way to render them
without a real session, and fabricating one (e.g., forging a JWT, stubbing Hydra's JWKS, or
loosening the middleware) is explicitly prohibited by this task's constraints (no weakening
middleware, no fake data, no changing auth architecture).

## 4. Design-System Consistency Sweep (static/code-level)

Performed against `apps/admin-web/src/**/*.{ts,tsx,css}`:

- Raw hex / rgb color literals: only 1 match, `apps/admin-web/src/app/layout.tsx`'s
  `viewport.themeColor` (`#f8fafc` light / `#020617` dark) — this is a Next.js `<meta
name="theme-color">` value (browser chrome color), not a component style, and matches the
  approved light/dark canvas tokens. Not a violation.
- Arbitrary bracket colors/radii (`rounded-[...]`, `bg-[#...]`, `text-[#...]`,
  `border-[#...]`): none found.
- Arbitrary shadow values (`shadow-[...]`): 4 matches, all in
  `apps/admin-web/src/components/dashboard/kpi-card.tsx`, e.g.
  `shadow-[0_0_20px_-2px_var(--info-subtle)]`. These reference design-system CSS custom
  properties (`var(--info-subtle)`, `var(--primary-subtle)`, etc.), not raw colors — this is the
  "atmospheric glow" effect the redesign brief calls for, implemented through tokens rather than
  hardcoded values. Not a violation.
- `rounded-*` utility classes are used broadly (24 files) but consistently draw from the standard
  Tailwind scale wired to the design system's radius tokens (no arbitrary `rounded-[Npx]` values
  found) — no inconsistency detected.

No design-system violations were found that warranted a fix.

## 5. Motion / RTL / Responsive / Accessibility Findings

Not assessable: all require authenticated, data-bearing screens (dashboard widgets, nav
interactions, RTL layout of populated tables/cards, responsive KPI grids) that are unreachable
without the live Hydra/Kratos stack. No findings recorded in either direction (no bugs found, but
also nothing was actually exercised) — do not read the absence of findings here as a pass.

## 6. Final Validation Command Results

| Command                         | Result                                                                                                                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm arch`                     | **PASS** — `depcruise packages services --config .dependency-cruiser.cjs` → "no dependency violations found (1572 modules, 6857 dependencies cruised)"                                                                                   |
| `pnpm typecheck`                | **PASS** — 78/78 tasks successful (turbo, full cache)                                                                                                                                                                                    |
| `pnpm lint`                     | **PASS** — 78/78 tasks successful (turbo, full cache)                                                                                                                                                                                    |
| `pnpm test`                     | **PASS** — 30 test files, 184 tests passed (via turbo, includes `@platform/runtime` composition tests; only expected dev-mode "permissive" warnings and an intentional `ECONNREFUSED` from a healthcheck-unreachable test, not failures) |
| `pnpm --filter admin-web build` | **PASS** — `next build` compiled successfully, 20/20 static pages generated, build traces finalized                                                                                                                                      |

All five claimed-passing gates were independently re-run and confirmed passing.

## 7. Fixes Made

**None.** No visual bugs, RTL breakage, accessibility regressions, or primitive-level motion
issues were directly demonstrated by real browser QA, because authenticated screens could not be
reached (see §2). The one operational hiccup (corrupted `.next` from overlapping build/dev
commands) was self-caused tooling noise, resolved by deleting `apps/admin-web/.next` and
restarting the dev server — no source files were touched.

The working tree's pre-existing uncommitted redesign changes (86 modified files per `git status`)
were left completely untouched, per instructions.

## 8. Issues Intentionally Left Unchanged

None identified as needing a fix; nothing was changed.

## 9. Remaining Blockers

- Docker/WSL2 is not functional in this environment, so the Hydra/Kratos/Keto/Postgres stack
  cannot be started, and there is no way to complete real authenticated browser QA
  (login, dashboard, all listed screens, RTL, theme, responsive, motion) without either fixing
  the local Docker/WSL2 install or running this QA pass on a machine/CI runner where the stack
  can actually come up.
- Until that infra is available, the redesign's authenticated-screen visual quality remains
  **unverified by real browser QA**, even though all static gates (arch/typecheck/lint/test/build)
  pass.

## 10. Final Verdict

**BLOCKED**

Rationale: per this task's own closure criterion, the verdict must be BLOCKED whenever real
browser QA with auth could not be completed due to infra — and it could not be, because Docker is
unavailable and no dev-mode auth bypass exists (correctly, since weakening middleware was
explicitly disallowed). All code-level gates (pnpm arch, typecheck, lint, test, admin-web build,
20/20 route compilation) are independently confirmed green, and the static design-system sweep
found no violations — so there is no evidence of regressions — but that is not equivalent to a
passing real-browser visual QA pass, which is what this phase requires for APPROVED or APPROVED
WITH MINOR ISSUES.
