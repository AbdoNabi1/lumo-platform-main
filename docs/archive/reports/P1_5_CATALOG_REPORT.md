# P1.5 — Runtime Composition Hardening: Catalog

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Catalog slice
**Baseline:** `main` @ `0c928be` (P1.5 Checkout)
**Pattern reused verbatim from:** `services/orders/src/composition.ts` (P1.5), extended to a 4-repository set the same way [Inventory](P1_5_INVENTORY_REPORT.md) extended it to 2.

---

## 1. Change

`services/catalog/src/composition.ts` — added a Prisma branch to `wireCatalog`.

- `CatalogWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ all 4 Prisma repositories (`PrismaProductRepository`/`PrismaCategoryRepository`/`PrismaBrandRepository`/`PrismaCollectionRepository`, all sharing one `PrismaCatalogRepositoryDeps` shape from `prisma-catalog-repositories.ts`) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildControllers(repos, unitOfWork, deps)` (all 4 controllers) so the use-case wiring is written once. Extracted the 26-entry `CATALOG_EVENT_TYPES` list to a module constant (was inline in the removed `wireCatalog` body) — pure hoist, same values, only used by the in-memory branch's subscriber loop.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredCatalog` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6558 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**10 of 39 contexts durable.** Next: Pricing.
