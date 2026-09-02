# Sprint 0.8 — Dependency Fitness Functions & Walking Skeleton — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all gates green) · **Phase 0 — Foundations (exit).**

## 1. Summary

Completed the Phase-0 plumbing: **architecture fitness functions** (dependency-cruiser) wired into a
`pnpm arch` script + CI gate, **generators** (`turbo gen`) for packages/services/aggregates/use-cases,
and a **walking skeleton** (`services/example`) that proves the architecture end to end in-process.
No new bounded context, no package redesign, no ADR.

## 2. Modifications applied (as approved)

- **No generator-smoke CI job** — `services/example` is the canonical generator output and is built +
  tested on every CI run; CI runs only lint / typecheck / build / test / **arch**.
- **No artificial rule-breaking** — validated that the **current** repository passes all rules and
  documented them; dependency-cruiser fails future violations on its own.
- **Neutral aggregate** — `ExampleAggregate` (not `Note`); the service is clearly a non-business
  reference.
- **Explicit deep-import rule** — `@platform/<pkg>` is allowed; `@platform/<pkg>/src/*` is forbidden.
- **Framework-agnostic controller** — no NestJS/Express/Fastify, no HTTP server.

## 3. Components implemented

### Architecture fitness functions (`dependency-cruiser`)

`.dependency-cruiser.cjs` + `pnpm arch` (`depcruise packages services`). Rules (all **error**):
`no-circular` (runtime cycles; type-only cycles tolerated), **`no-deep-package-imports`** (public
entry / declared subpath only — no deep `src/*`), `domain-stays-pure` (kernel + `@platform/domain`
only), `application-no-messaging-no-infra`, `messaging-no-application-no-infra`,
`packages-never-import-apps-or-services`, `no-cross-service-internals`. Type-aware
(`tsPreCompilationDeps: "specify"`); tests excluded. **Green on the current repo (191 modules, 0
violations).**

### Generators (`turbo/generators`, run via `pnpm gen`)

- **`package`** (enhanced) — now also emits `README.md`, `vitest.config.ts`, and a sample `*.test.ts`.
- **`service`** — a bounded-context slice (`domain/ application/ infrastructure/ interfaces/`),
  package.json with the kernel/domain/application/repository deps, tsconfig, vitest, README.
- **`aggregate`** — a domain aggregate + repository port + test, into a target service.
- **`use-case`** — an application use-case + test, into a target service.
  All generated code is strict-TS, dependency-rule-clean, and tested. Validated by generating a
  throwaway service+aggregate+use-case+package, confirming `typecheck`/`lint`/`test`/`arch` green, then
  deleting them (the permanent reference is `services/example`).

### Walking skeleton (`services/example` — reference, non-business)

Proves every layer in-process (no broker, no DB, no HTTP server):

- **domain** `ExampleAggregate` (raises `ExampleRegistered`) + `ExampleRepository` port (pure).
- **application** `RegisterExample` use-case (`@platform/application` `UseCase`) — depends on domain +
  ports only.
- **infrastructure** `InMemoryExampleRepository` (persists + writes the **outbox** via
  `@platform/messaging` on save), `InMemoryUnitOfWork`, `ExampleEventTranslator`.
- **interfaces** `RegisterExampleController` (framework-agnostic boundary) + `ExampleRegisteredConsumer`
  (`EventHandler`).
- **composition.ts** wires it with in-memory adapters (serializer/id/clock injected, so production
  code never imports the test-only serializer). `example.e2e.test.ts` drives API → application →
  domain → repository → outbox → relay → publisher → consumer and asserts the side effect.

### CI fitness gate

`.github/workflows/ci.yml` now runs **Architecture (`pnpm arch`)** after the test step; the test step
was relabelled (it now exercises the real `services/example` end-to-end).

## 4. Files created

- `.dependency-cruiser.cjs`
- `services/example/` (18): `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`;
  `src/index.ts`, `src/composition.ts`, `src/example.e2e.test.ts`;
  `src/domain/{example-aggregate.ts, example-registered.event.ts, example-repository.ts, example-aggregate.test.ts}`;
  `src/application/{register-example.use-case.ts, register-example.use-case.test.ts}`;
  `src/infrastructure/{in-memory-unit-of-work.ts, example-event-translator.ts, in-memory-example-repository.ts}`;
  `src/interfaces/{register-example.controller.ts, example-registered.consumer.ts}`.
- `turbo/generators/templates/package/{README.md.hbs, vitest.config.ts.hbs, index.test.ts.hbs}`
- `turbo/generators/templates/service/{package.json.hbs, tsconfig.json.hbs, vitest.config.ts.hbs, README.md.hbs, index.ts.hbs}`
- `turbo/generators/templates/aggregate/{aggregate.ts.hbs, repository.ts.hbs, aggregate.test.ts.hbs}`
- `turbo/generators/templates/use-case/{use-case.ts.hbs, use-case.test.ts.hbs}`

## 5. Files modified

- `package.json` — `arch` script + `dependency-cruiser` devDependency.
- `turbo/generators/config.ts` — `package` (enhanced) + new `service`/`aggregate`/`use-case` generators.
- `turbo/generators/templates/package/{package.json.hbs, index.ts.hbs}` — add vitest + sample export.
- `.github/workflows/ci.yml` — add the `arch` gate; relabel the test step.
- Docs: `PROJECT_STATE.md`, `AI_CONTEXT.md`, `docs/development/WORKSPACE_GUIDE.md`, this report.
- `pnpm-lock.yaml`. No existing **source** package was redesigned.

## 6. Validation results

| Gate             | Result                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- |
| `pnpm lint`      | ✅ PASS                                                                            |
| `pnpm typecheck` | ✅ PASS                                                                            |
| `pnpm test`      | ✅ PASS (serialized) — `services/example` 4 tests (domain 1, application 1, e2e 2) |
| `pnpm build`     | ✅ PASS                                                                            |
| `pnpm arch`      | ✅ PASS — 191 modules, 0 violations                                                |

No artificial violations were introduced. Generators were validated by generation + the standard
gates, then the throwaway outputs were removed.

**Note (environmental):** parallel `pnpm test` intermittently crashes an unrelated vitest worker on
this Windows host (see Sprint 0.7 §7); the serialized run (`turbo run test --concurrency=1`) is
reliably green. CI (Linux) is unaffected.

## 7. Deferred (NOT in 0.8)

NestJS/Apollo/gRPC servers + real HTTP; Prisma-backed repository/outbox; Redpanda/Debezium broker
wiring; GitOps/k8s deployment (the deploy half of the Phase-0 exit criteria — needs a Docker host);
any business bounded context.

## 8. Remaining work

None for Sprint 0.8. **Phase 0 plumbing is complete.** Next (per the roadmap): **Phase 1 — Commerce
Core**, starting with **Sprint 1.1 (Catalog + Media)**, scaffolded via `pnpm gen service`.

**Sprint 0.8 is complete. Stopping — not beginning Phase 1 until explicit approval.**
