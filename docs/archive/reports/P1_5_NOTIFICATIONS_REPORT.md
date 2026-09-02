# P1.5 — Runtime Composition Hardening: Notifications

**Closes (partially):** [C-01](docs/investigations/C-01-in-memory-persistence.md) — Notifications slice
**Baseline:** `main` @ `689b4e9` (P1.5 Returns)
**Pattern reused verbatim from:** `services/returns/src/composition.ts` (P1.5) — single-repository shape.

---

## 1. Change

`services/notifications/src/composition.ts` — added a Prisma branch to `wireNotifications`.

- `NotificationsWiringDeps` gained additive optional `prisma?: Database` / `tenantId?: string`.
- Present ⇒ `PrismaNotificationRepository` + `PrismaUnitOfWork(deps.prisma)`.
- Absent ⇒ byte-identical in-memory behaviour; extracted `buildController(notifications, unitOfWork, deps)`.
- All 4 provider ports (`emailProvider`/`smsProvider`/`pushProvider`/`webhookProvider`) plus `processedProviderCallbacks` stay in-memory stubs in both branches (no real providers exist — the context's own doc-comment already disclosed this scope) — out of scope for C-01.

No change to `apps/admin/src/composition.ts`.

## 2. Public contract impact

**None.** Both fields optional; `WiredNotifications` unchanged.

## 3. Gates

| Gate         | Command          | Result                                                        |
| ------------ | ---------------- | ------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76                                                      |
| Lint         | `pnpm lint`      | ✅ 76/76                                                      |
| Test         | `pnpm test`      | ✅ 76/76                                                      |
| Architecture | `pnpm arch`      | ✅ no dependency violations (1531 modules, 6588 dependencies) |

## 4. Not done (deliberately out of scope)

Same two items as prior P1.5 milestones: the C-01 Step-1 boot guardrail, and live-DB execution (G-41).

## 5. State after this milestone

**16 of 39 contexts durable.** This closes the 12 contexts C-01 §5 named explicitly by suggested order
(orders → payments → inventory → cart → checkout → catalog → pricing → identity → shipping →
fulfillment → returns → notifications). Next: the remaining 23 contexts, minus 2 blocked
(analytics, platform-console — see `RUNTIME_COMPOSITION_BLOCKER_REPORT.md`) — 21 real conversions,
starting with automation.
