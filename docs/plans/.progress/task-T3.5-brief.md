# Task T3.5 brief — Licensing usage counters in Settings

## Method (condensed)

1. Read `apps/admin/src/http/licensing-routes.ts`'s `GET /usage-counters` route — exact path,
   `schema`, `permission`.
2. Read the admin controller and the `services/licensing/src/interfaces/` controller to learn the
   real response shape.
3. Add `apps/admin-web/src/lib/api/licensing.ts` with `fetchUsageCounters()`, copying
   `apps/admin-web/src/lib/api/content.ts`'s pattern.
4. Edit the existing `apps/admin-web/src/app/settings/page.tsx` — do not create a new page.
5. Handle all four `ApiResult` outcomes for the new counters section.
6. Add every string to both `messages/en.ts` and `messages/ar.ts`.
7. No nav/middleware changes — `/settings` already exists and is reachable.
8. Test the API module (stub `global.fetch`, follow `lib/api/orders.test.ts`).

## T3.5 — Licensing usage counters in Settings

**Route:** `GET /usage-counters` (`apps/admin/src/http/licensing-routes.ts`).

`apps/admin-web/src/app/settings/page.tsx` currently renders a "Workspace & billing" section as
unavailable, and its doc comment explains why: admin-web cannot resolve *which* workspace is
current. That reasoning holds for Tenancy's `Workspace` and Licensing's `Plan`/`Subscription` —
but **not** for `GET /usage-counters`, which is tenant-scoped by the `x-tenant-id` header the
client already sends.

**Steps**

1. `apps/admin-web/src/lib/api/licensing.ts` with `fetchUsageCounters()`.
2. In the settings page, replace only the usage portion of the unavailable card with a real
   counters table. **Leave the workspace/plan/subscription unavailable state exactly as it is**
   and leave its doc comment intact — that gap is real and closes in Phase 4 (Tenancy read
   side).
3. Update the settings doc comment to say which half is now live and which half is still
   blocked, and why.

**Acceptance:** real usage counters render in Settings. The workspace/plan gap is still stated
honestly.

## Global constraints

Same as every Phase 3 task: domain aggregates never go on the wire (hand-type DTOs), never
fabricate data, every string in both dictionaries, no `git` commands, do not ask questions
(blockers → `docs/plans/BLOCKERS.md`, continue with the rest), tick `- [ ] Task complete` under
`## T3.5 — Licensing usage counters in Settings` in `docs/plans/PHASE-3-readonly-screens.md` when
done and verified.

Note: `settings/page.tsx` is a shared, already-populated page — read the whole current file
first, and do NOT touch or remove the existing workspace/plan/subscription unavailable block or
its doc comment beyond updating the wording as instructed above.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main`. `pnpm exec turbo` fails on this
Windows host — use the `--filter admin-web` commands directly.
