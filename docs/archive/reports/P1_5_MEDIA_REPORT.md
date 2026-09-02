# P1.5 — Runtime Composition Hardening: Media

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Media slice
**Baseline:** `main` @ `3f790d6` (P1.5 Pages)
**Pattern reused verbatim from:** `services/inventory/src/composition.ts` (P1.5) — 2-repository shape sharing one Prisma deps type.

---

## 1. Change

`services/media/src/media-library.composition.ts` — added a Prisma branch to `wireMediaLibrary`.

- `MediaLibraryWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaFolderRepository` + `PrismaMediaAssetRepository` (sharing one `PrismaLibraryRepositoriesDeps` shape) + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(repos, unitOfWork, deps)`.

**Scope note — real, not invented:** the `media` package ships **two separate, unrelated composition functions**: `wireMedia` (Phase-1 `Asset` slice, `composition.ts`) and `wireMediaLibrary` (Sprint 5.4 Folder/MediaAsset extension, `media-library.composition.ts`) — confirmed by grep, `wireMedia` has zero callers outside its own package/tests. `apps/admin/src/composition.ts` only calls `wireMediaLibrary` (exposed as `mediaLibrary`); `wireMedia` is not part of the production admin composition graph C-01 describes at all. **Only `wireMediaLibrary` was converted** — `wireMedia` is untouched, deliberately, same "not part of the 39 `wireX(deps)` calls" exclusion the investigation itself uses to scope the finding.

## 2. Public contract impact

**None.** Both fields optional; `WiredMediaLibrary` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6660 dependencies) |

## 4. Not done (deliberately out of scope)

- The C-01 Step-1 boot guardrail, and live-DB execution (G-41) — same as every prior P1.5 milestone.
- `wireMedia` (Phase-1 Asset slice) — not reachable from `apps/admin`, see scope note above.

## 5. State after this milestone

**34 of 39 contexts durable** (counting Media as the one admin-reachable composition, `wireMediaLibrary`). Next: Tenancy.
