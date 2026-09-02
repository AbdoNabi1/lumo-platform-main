# P1.5 — Runtime Composition Hardening: Search

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Search slice
**Baseline:** `main` @ `7d2cb41` (P1.5 Reviews)
**Pattern reused verbatim from:** `services/reviews/src/composition.ts` (P1.5) — single-repository shape with an already-optional cross-context port.

---

## 1. Change

`services/search/src/composition.ts` — added a Prisma branch to `wireSearch`.

- `SearchWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaSearchIndexRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(indexes, unitOfWork, deps)`.
- `provider` (already-optional, defaults to `InMemoryIndexProvider` — the real OpenSearch/pgvector adapter is ADR-0020, out of this scope) stays in-memory in both branches — out of scope for C-01, which concerns Search's own index-metadata persistence, not the external index engine.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both new fields optional; `WiredSearch` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6612 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**22 of 39 contexts durable.** Next: Content.
