# P1.5 — Runtime Composition Hardening: Tenancy

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Tenancy slice
**Baseline:** `main` @ `41c2d6b` (P1.5 Media)
**Pattern reused verbatim from:** `services/inventory/src/composition.ts` (P1.5) — 2-repository shape sharing one Prisma deps type.

---

## 1. Change

`services/tenancy/src/composition.ts` — added a Prisma branch to `wireTenancy`.

- `TenancyWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaTenantRepository` + `PrismaWorkspaceRepository` (sharing one `PrismaTenancyRepositoriesDeps` shape) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(repos, unitOfWork, deps)`.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredTenancy` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6664 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**35 of 39 contexts durable.** Next: Licensing.
