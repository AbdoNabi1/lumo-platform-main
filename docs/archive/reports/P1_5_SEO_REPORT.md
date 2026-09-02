# P1.5 — Runtime Composition Hardening: SEO

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — SEO slice
**Baseline:** `main` @ `fadae8c` (P1.5 Loyalty)
**Pattern reused verbatim from:** `services/catalog/src/composition.ts` (P1.5) — 4-repository shape sharing one Prisma deps type.

---

## 1. Change

`services/seo/src/composition.ts` — added a Prisma branch to `wireSeo`.

- `SeoWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ all 4 Prisma repositories (`PrismaSeoProfileRepository`/`PrismaRedirectRepository`/`PrismaSitemapRepository`/`PrismaRobotsPolicyRepository`, all sharing one `PrismaSeoRepositoriesDeps` shape) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(repos, unitOfWork, deps)`.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredSeo` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6632 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**27 of 39 contexts durable.** Next: Components.
