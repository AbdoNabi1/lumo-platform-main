# C-04 — 36 of 129 tables declared in the Prisma schema have no `CREATE TABLE` in any migration

| Field                      | Value                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | Critical                                                                                                                                                                                                                        |
| **Area**                   | Database / Migrations                                                                                                                                                                                                           |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                                                                                              |
| **Blocker verdict**        | **True blocker.** Latent today only because C-01 masks it; becomes an immediate crash the moment C-01 is fixed. Not a deferral — **six migrations were dropped during history reconstruction and exist verbatim in `de46df9`.** |
| **Public contract change** | **No.**                                                                                                                                                                                                                         |

---

## 1. Location

| Path                                    | What is there                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema/*.prisma`    | 39 schema files declaring **129** `@@schema` + `@@map` tables                           |
| `packages/db/prisma/schema/migrations/` | **21** migrations declaring **93** distinct `CREATE TABLE`                              |
| `packages/db/prisma/MIGRATIONS.md` §0   | Confirms `prisma/schema/migrations/` is the _correct_ location for a multi-file schema  |
| `packages/db/package.json:21-24`        | `"prisma": { "schema": "prisma/schema", "seed": "tsx ../../apps/runtime/src/seed.ts" }` |

**Absent from `main`, present in `de46df9`:**

```
packages/db/prisma/schema/migrations/20260713010000_commerce_growth_sprint51/migration.sql
packages/db/prisma/schema/migrations/20260713020000_customer_experience_sprint52/migration.sql
packages/db/prisma/schema/migrations/20260713030000_platform_intelligence_sprint53/migration.sql
packages/db/prisma/schema/migrations/20260713040000_experience_platform_sprint54/migration.sql
packages/db/prisma/schema/migrations/20260713050000_saas_foundation_sprint55/migration.sql
packages/db/prisma/schema/migrations/20260713060000_saas_refinements_sprint56/migration.sql
packages/db/prisma/schema/migrations/20260719120000_tracking_platform_p5_m6/migration.sql
packages/db/prisma/schema/tracking.prisma
packages/db/prisma/schema/feature-flags.prisma
```

---

## 2. Current implementation

Extracting every `@@schema("X")` + `@@map("Y")` pair from `packages/db/prisma/schema/*.prisma` yields **129** fully-qualified tables. Extracting every `CREATE TABLE ["IF NOT EXISTS"] "X"."Y"` from all migration SQL yields **93**. The difference is 36 tables that the schema declares and no migration creates:

```
automation.automation_workflows        licensing.merchant_capabilities        reporting.dashboards
components.component_definitions       licensing.merchant_feature_overrides   reporting.report_definitions
content.content_blocks                 licensing.plans                        reviews.reviews
coupons.coupons                        licensing.subscriptions                search.search_indexes
experience.experiences                 licensing.usage_counters               seo.redirects
experiment.experiments                 localization.locales                   seo.robots_policies
feature_flags.feature_flags            localization.translation_sets          seo.seo_profiles
licensing.credits                      loyalty.loyalty_accounts               seo.sitemaps
licensing.invoices                     media.folders                          tenancy.tenants
media.media_assets                     pages.pages                            tenancy.workspaces
promotions.promotions                  pages.templates                        theme.themes
recommendations.recommendation_models  reporting.analytics_reports            wishlist.wishlists
```

These map exactly onto Sprints 5.1 (Growth), 5.2 (Customer Experience), 5.3 (Platform Intelligence), 5.4 (Experience Platform), and 5.5/5.6 (SaaS Foundation) — the same sprint boundaries as the six missing migration files.

**I verified the missing migrations actually close the gap.** Sampling 21 of the 36 tables against the SQL in `de46df9`'s missing migrations:

```
automation.automation_workflows          inDe46df9Migrations=True
components.component_definitions         inDe46df9Migrations=True
...
wishlist.wishlists                       inDe46df9Migrations=True

COVERED: 21 / 21
```

---

## 3. Why it is incorrect

`prisma migrate deploy` records applied migrations in `_prisma_migrations` and reports success. It does **not** verify that the resulting database matches `schema.prisma`. So a fresh production database would be reported as "up to date" while missing 36 tables that the generated Prisma Client is fully typed against.

Two independent failure surfaces:

1. **Runtime.** `prisma generate` emits `prisma.promotion`, `prisma.wishlist`, `prisma.tenant`, `prisma.review`, etc. Any call fails with `relation "promotions.promotions" does not exist` — a Postgres error surfaced as a 500, not a typed domain error.
2. **Migration history.** The next `prisma migrate dev` diffs schema against migrations, finds 36 missing tables, and authors them into **one unreviewed migration** — silently re-creating six sprints of schema work with none of the original indexes, constraints, or column comments unless they happen to be reproduced by the diff.

One thing that is **not** wrong, and that I want to record explicitly because it looks wrong: the migrations directory sits at `prisma/schema/migrations/`, not `prisma/migrations/`. `packages/db/prisma/MIGRATIONS.md` §0 documents why, and it is correct — with a multi-file schema, Prisma anchors the migrations directory to the directory containing the `datasource` block, _"verified in the installed `prisma@6.19.3` build"_. That is a resolved issue, not a defect.

---

## 4. Production impact

**Today: latent.** All 36 tables belong to contexts that C-01 leaves running in-memory, so nothing queries them and nothing fails.

**The moment C-01 is fixed: immediate, total failure of those contexts.** This is the critical sequencing constraint in the entire remediation plan:

> **Fixing C-01 without fixing C-04 first converts a silent data-loss defect into a hard runtime crash across 32 of the 35 converted contexts.**

Additional impacts once a real database exists:

- `prisma migrate deploy` in CD reports success against a structurally incomplete database — the deployment gate cannot detect the drift.
- `packages/db/package.json`'s seed (`apps/runtime/src/seed.ts`) may fail or silently seed a partial schema.
- Because `db-integration.yml` is absent (H-09), **no automated check has ever compared migrations to schema**. `MIGRATIONS.md` §1 confirms the initial migration _"has not run against a real database yet"_.

---

## 5. Smallest additive fix

**Restore, do not regenerate.** Regenerating via `prisma migrate diff` would produce one anonymous squashed migration and lose the per-sprint history, index definitions, and comments that the originals carry.

```bash
git checkout de46df9 -- \
  packages/db/prisma/schema/migrations/20260713010000_commerce_growth_sprint51 \
  packages/db/prisma/schema/migrations/20260713020000_customer_experience_sprint52 \
  packages/db/prisma/schema/migrations/20260713030000_platform_intelligence_sprint53 \
  packages/db/prisma/schema/migrations/20260713040000_experience_platform_sprint54 \
  packages/db/prisma/schema/migrations/20260713050000_saas_foundation_sprint55 \
  packages/db/prisma/schema/migrations/20260713060000_saas_refinements_sprint56 \
  packages/db/prisma/schema/migrations/20260719120000_tracking_platform_p5_m6 \
  packages/db/prisma/schema/tracking.prisma
```

### Then verify, do not assume

1. **Ordering.** The restored timestamps (`20260713*`) fall **between** existing migrations `20260712100000_notifications_core_sprint412` and `20260714000000_feature_registry_p1_1`. Since no database has ever had these applied (`MIGRATIONS.md` §1), inserting them in historical position is safe. **This would not be safe against a database that had already applied later migrations** — confirm no such database exists before proceeding.
2. **Run the drift check.** Once `db-integration.yml` is restored (C-03/H-09), this becomes a one-command gate:
   ```bash
   pnpm --filter @platform/db exec prisma migrate diff \
     --from-migrations prisma/schema/migrations \
     --to-schema-datamodel prisma/schema \
     --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
   ```
   `--exit-code` returns non-zero on any drift. **Add this as a permanent CI gate** — it is the check whose absence allowed 36 tables to go missing unnoticed.
3. **Resolve the `feature-flags.prisma` / `feature_flags.prisma` name difference.** `main` has `feature_flags.prisma` (underscore); `de46df9` has `feature-flags.prisma` (hyphen). Restoring blindly would produce two schema files for one context and a duplicate-model error. Diff them and keep one.
4. **`tracking.prisma` is entirely absent from `main`** — the Tracking platform has no schema at all on this branch. Restore it together with `20260719120000_tracking_platform_p5_m6`.

---

## 6. Public contract impact

**No TypeScript or HTTP contract changes.** Restoring migrations changes the database schema the Prisma Client is generated against, but the client's _shape_ is already generated from `schema.prisma` today — the restore makes the database match the client that already exists, rather than changing the client.

Restoring `tracking.prisma` **does** add new models to the generated client. That is purely additive: new `prisma.*` accessors, no changes to existing ones.

---

## 7. Blocker or intentional deferral?

**True blocker, and not a deferral.**

Nothing in `docs/KNOWN_GAPS.md` defers migrations for Sprints 5.1–5.6. The schema files for all 36 tables are present on `main` and are referenced by Prisma repositories that are also present on `main` (`services/promotions/src/infrastructure/prisma-promotion-repository.ts`, `services/wishlist/…`, etc.). The intent to persist these contexts is unambiguous — only the migrations went missing.

This is the same **file-loss defect from the history reconstruction** as C-02 and C-03, and shares their fix shape: restore from `de46df9`, review, gate.

---

## 8. How this was verified

- Parsed all 39 `*.prisma` files for `@@schema`/`@@map` pairs → 129 tables.
- Parsed all 21 migration `.sql` files with `CREATE TABLE ["IF NOT EXISTS"] "x"."y"` → 93 tables.
- Set difference → 36 tables, listed above.
- `git ls-tree -r --name-only de46df9 -- packages/db` diffed against `git ls-files packages/db` → 9 files missing from `main`.
- Concatenated the SQL of the 7 missing migrations from `de46df9` and regex-matched 21 sampled missing tables → **21/21 covered**.
- `prisma migrate diff` was attempted and correctly failed with `P1001` (no database reachable) — the static analysis above was used instead.
- `packages/db/prisma/MIGRATIONS.md` read to confirm the migrations-directory location is deliberate and correct.
- No code was modified.
