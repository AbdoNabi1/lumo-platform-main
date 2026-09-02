# P1.5 — Runtime Composition Hardening: Wishlist

**Closes (final):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Wishlist slice, the last of the 33 convertible contexts
**Baseline:** `main` @ `badbdc3` (P1.5 Licensing)
**Pattern reused verbatim from:** `services/promotions/src/composition.ts` (P1.5) — single-repository shape with an already-optional cross-context port.

---

## 1. Change

`services/wishlist/src/composition.ts` — added a Prisma branch to `wireWishlist`.

- `WishlistWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaWishlistRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(wishlists, unitOfWork, deps)`.
- `cart` (already-optional, defaults to `InMemoryCartPort`) stays in-memory in both branches — out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both new fields optional; `WiredWishlist` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6672 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**37 of 39 contexts durable.** All 33 contexts that had a Prisma composition path available are now
converted (4 were already durable before P1.5: customer-360, feature-registry, finance, security).
The remaining 2 (analytics, platform-console) have no Prisma repository files anywhere in the repo —
see `RUNTIME_COMPOSITION_BLOCKER_REPORT.md` for the disclosed reason C-01 cannot be closed for them
without inventing infrastructure. **This is the last per-context P1.5 milestone.**
