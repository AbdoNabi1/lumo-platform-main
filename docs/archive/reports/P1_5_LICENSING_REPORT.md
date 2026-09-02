# P1.5 — Runtime Composition Hardening: Licensing

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Licensing slice
**Baseline:** `main` @ `deab6c6` (P1.5 Tenancy)
**Pattern reused verbatim from:** `services/catalog/src/composition.ts` (P1.5) — multi-repository shape, extended to 7 repos.

---

## 1. Change

`services/licensing/src/composition.ts` — added a Prisma branch to `wireLicensing`.

- `LicensingWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ all 7 Prisma repositories (`PrismaPlanRepository`/`PrismaSubscriptionRepository`/`PrismaMerchantFeatureOverrideRepository`/`PrismaMerchantCapabilitiesRepository`/`PrismaUsageCounterRepository`/`PrismaCreditRepository`/`PrismaInvoiceRepository`, all sharing one `PrismaLicensingRepositoriesDeps` shape) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(repos, unitOfWork, deps)`.
- `processedUsageRecords` (idempotency store) and the deferred `payments`/`financeLedger` billing-adapter stubs stay in-memory in both branches — out of scope for C-01 (not persistence of Licensing's own aggregates).

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredLicensing` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6668 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**36 of 39 contexts durable.** Next: Wishlist (last of the 33 real conversions).
