# P1.5 — Runtime Composition Hardening: Identity

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Identity slice
**Baseline:** `main` @ `fba798d` (P1.5 Pricing)
**Pattern reused verbatim from:** `services/catalog/src/composition.ts` (P1.5) — same multi-repository shape.

---

## 1. Change

`services/identity/src/composition.ts` — added a Prisma branch to `wireIdentity`.

- `IdentityWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaCustomerRepository` (tenant-scoped via injected `tenantId`, same convention as every other P1.5 conversion) + `PrismaUserRepository`/`PrismaOrganizationRepository`/`PrismaMembershipRepository` (from `prisma-access-repositories.ts`) + `PrismaUnitOfWork(deps.prisma)`.
- **Real pre-existing asymmetry found and preserved, not "fixed":** `PrismaAccessRepositoryDeps` (the Users/Organizations/Memberships deps type) has **no `tenantId` field** — those three repositories read `tenantId` off each aggregate's own domain field instead (verified in `access.mappers.ts`), a different but equally real convention already built into this file. `PrismaCustomerRepository` still requires the injected `tenantId`. Both are wired exactly as their own Deps interfaces declare; no interface was changed to force uniformity.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildControllers(repos, unitOfWork, deps)` (both controllers) so the use-case wiring is written once.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredIdentity` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6572 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**12 of 39 contexts durable.** Next: Shipping.
