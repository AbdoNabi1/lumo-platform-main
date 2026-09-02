# `@platform/e2e` — Playwright suite (T6.1)

The first three specs, per `docs/plans/PHASE-5-6-backlog.md`'s T6.1:

1. `tests/guest-purchase.spec.ts` — browse → add to cart → checkout → confirmation, as an
   unauthenticated storefront visitor.
2. `tests/operator-create-product.spec.ts` — log in as an operator → create a product → publish it
   → see it on the storefront.
3. `tests/authorization.spec.ts` — `viewer`/`operator`/`admin` each hit a route above their own
   level and land on `/forbidden`, not the page.

## Prerequisites — there is no mock-backend mode

Both `apps/storefront` and `apps/admin-web` fail closed outside `APP_ENV=local|development`
(`apps/*/src/lib/env.ts`) and have no fixture/stub server. Bring up the full local stack first,
same sequence as `docs/development/SETUP.md`:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
pnpm --filter @platform/db db:migrate:deploy
```

Then seed the three role identities this suite's specs log in as (extends
`scripts/dev/seed-auth-local.mjs`'s pattern with the write-permission grants the operator spec
needs — see that script's own doc comment for why plain `seed-auth-local.mjs` isn't enough):

```bash
E2E_PASSWORD=<a password of your choosing> node apps/e2e/scripts/seed-e2e-identities.mjs
```

Start the runtime (api :3080 / worker :3081 / scheduler :3082):

```bash
pnpm --filter @platform/runtime dev
```

Then run the suite — `playwright.config.ts`'s `webServer` starts `storefront`/`admin-web`
themselves (`reuseExistingServer: true`, so it attaches instead if you already have them running):

```bash
E2E_PASSWORD=<the same password> pnpm --filter @platform/e2e e2e
```

or from the repo root via turbo: `E2E_PASSWORD=... pnpm e2e`.

## What's NOT wired here

- **CI.** T6.1 asked for the turbo task and the specs, not a CI job — bringing up
  docker-compose/migrations/seeding inside GitHub Actions is real infrastructure work of its own
  and needs validating on a host with Docker, which this session did not have (see
  `docs/plans/BLOCKERS.md`). A follow-up CI job should mirror `docs/development/SETUP.md`'s bring-up
  sequence above.
- **`guest-purchase.spec.ts`'s final assertion is expected to fail today** — `test.fail()`, with a
  comment pointing at `docs/plans/BLOCKERS.md`'s T2.3 entry (`POST /public/checkouts/:id/complete`
  throws for a genuine guest session). Every step before "place order" is a normal assertion.
- **None of this was run against a live stack in the session that wrote it** — no Docker was
  available (same limitation `docs/plans/BLOCKERS.md` records for every "not verified in a live
  browser" note across Phases 0–5). What WAS verified: `playwright test --list` parses every spec
  with no syntax/type errors, and `tsc --noEmit`/`eslint` are clean — see
  `docs/plans/BLOCKERS.md`'s T6.1 entry for the exact commands run.
