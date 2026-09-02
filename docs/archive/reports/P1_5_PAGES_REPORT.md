# P1.5 — Runtime Composition Hardening: Pages

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Pages slice
**Baseline:** `main` @ `458caa1` (P1.5 Feature Flags)
**Pattern reused verbatim from:** `services/inventory/src/composition.ts` (P1.5) — 2-repository shape sharing one Prisma deps type.

---

## 1. Change

`services/pages/src/composition.ts` — added a Prisma branch to `wirePages`.

- `PagesWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaPageRepository` + `PrismaTemplateRepository` (sharing one `PrismaPagesRepositoriesDeps` shape) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(repos, unitOfWork, deps)`.

No change to `apps/admin/src/composition.ts`. (P1.4 already reconciled the `Template`→`page_templates` model rename at the schema/migration level — no composition-level impact here.)

## 2. Public contract impact

**None.** Both fields optional; `WiredPages` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6656 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**33 of 39 contexts durable.** Next: Media.
