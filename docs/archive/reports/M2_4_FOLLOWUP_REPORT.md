# M2-4 Follow-up — the two `as never` casts

`M2_4_REPORT.md` (commit `3297234`) audited `as unknown as`, non-null `!`, `@ts-ignore`/`@ts-expect-error`, and real `any`, but did not separately grep for `as never` — a distinct unsafe-cast idiom that, unlike `as unknown as X`, requires no double-cast at all: `never` is TypeScript's bottom type, so `X as never` is always a legal _narrowing_ assertion regardless of `X`, and a `never`-typed value is in turn assignable to any parameter type. That makes it functionally equivalent to `as any` at the call site while looking like a single, "safe" cast.

The project's own verified-findings register recorded the real M2-4 defect as exactly two such casts, both at Prisma-store construction sites in the tracking ingest wiring:

- `apps/runtime/src/composition.ts:324` — `new PrismaTrackingRegistryStore(core.prisma as never, core.idGenerator)`
- `apps/runtime/src/tracking/wire-tracking-runtime.ts:169` — `new PrismaEventRecordStore(input.db as never, input.idGenerator)`

(Four other `as never` occurrences exist in test mock files — `tracking-ingest-wiring.test.ts`, `edge-middleware.test.ts`, `edge-zero-trust.test.ts` — casting a partial mock to satisfy a constructor parameter type in a test. Different, normal use; correctly out of scope, matching the register's own prior classification.)

## Investigation

Both casts exist to bridge `core.prisma` / `input.db` (typed `Database`, i.e. the generated `PrismaClient`) into a narrower local interface (`RegistryDb`, `TrackingDb`) declared in the same file as `Database & { <model>: { create/findMany/findFirst/count(args: unknown): Promise<unknown> } }` — a hand-rolled, loosely-typed view of the one Prisma model delegate each store actually uses.

Removing each cast and running `tsc --noEmit` against `apps/runtime` in isolation produced **zero errors** at both sites. The intersection type already structurally accepts the real `PrismaClient` without narrowing: TypeScript checks method-shorthand members bivariantly, so the real (generic, strongly-typed) Prisma delegate methods are accepted against the loose `unknown`-arg declarations without needing `never` as a bypass. Both casts were dead — stale defensive code that predates whatever made the direct assignment work, never revisited once it stopped being necessary.

## Fix

Removed both casts; the constructor calls now pass `core.prisma` / `input.db` directly, unchanged in every other respect. No type declarations, no public API, no event contract, and no other file touched.

## Regression risk

None. The removed casts were compile-time-only and provably redundant (confirmed by `tsc --noEmit` succeeding with zero errors after removal, and by the fact that both stores' methods are called with the same literal argument shapes as before — nothing about the runtime call sites changed).

## Verification results

| Gate         | Command          | Result                                                              |
| ------------ | ---------------- | ------------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` | ✅ 76/76 tasks successful                                           |
| Lint         | `pnpm lint`      | ✅ 76/76 tasks successful                                           |
| Test         | `pnpm test`      | ✅ 76/76 tasks successful (runtime: 30 files / 145 tests passed)    |
| Architecture | `pnpm arch`      | ✅ no dependency violations found (1531 modules, 6676 dependencies) |

## Summary

- `as never` (production, tracking Prisma-store construction): 2 → 0
- Files changed: 2 (`apps/runtime/src/composition.ts`, `apps/runtime/src/tracking/wire-tracking-runtime.ts`), 2 lines each
- New abstractions introduced: 0
