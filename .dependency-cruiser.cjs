/**
 * Architecture fitness functions (docs/architecture/02, docs/development/WORKSPACE_GUIDE.md).
 * Enforces the dependency direction `domain ← application ← messaging ← infrastructure`, the
 * leaf/port boundaries, the public-entry import rule, and the absence of cycles. Run with
 * `pnpm arch`; runs in CI.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Runtime circular dependencies are forbidden. Type-only cycles (erased at compile time, e.g. a barrel re-export importing its own type back) are tolerated.",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "no-deep-package-imports",
      severity: "error",
      comment:
        "Import a workspace package via its public entry (`@platform/<pkg>` or a declared subpath such as `/testing`), never a deep internal `src/*` path.",
      from: { path: "^(packages|services)/([^/]+)/" },
      to: {
        path: "^(packages|services)/([^/]+)/src/",
        pathNot: [
          "^$1/$2/", // same package — relative imports are fine
          "(^|/)src/index\\.ts$", // the public entry
          "/src/[^/]+/index\\.ts$", // a declared subpath entry (e.g. `/testing`)
        ],
      },
    },
    {
      name: "domain-stays-pure",
      severity: "error",
      comment:
        "Domain depends only on the kernel (`@platform/types`, `@platform/utils`) and the shared `@platform/domain` building blocks — never application, messaging, contracts, or infrastructure.",
      from: { path: "(^packages/domain/src/)|(^services/[^/]+/src/domain/)" },
      to: {
        path: "^(packages|services)/",
        pathNot: [
          "^packages/(types|utils|domain)/src/",
          "(^packages/domain/src/)|(^services/[^/]+/src/domain/)",
        ],
      },
    },
    {
      name: "application-no-messaging-no-infra",
      severity: "error",
      comment:
        "Application must not import `@platform/messaging` or any infrastructure adapter — it depends on domain + ports only (Dependency Inversion).",
      from: { path: "(^packages/application/src/)|(^services/[^/]+/src/application/)" },
      to: {
        path: "^packages/(messaging|db|kafka|redis|clickhouse|storage|secrets|observability|health|id|clock)/src/",
      },
    },
    {
      name: "messaging-no-application-no-infra",
      severity: "error",
      comment:
        "Messaging sits above application and below infrastructure: it must not import the application layer or any infrastructure adapter.",
      from: { path: "^packages/messaging/src/" },
      to: {
        path: "^packages/(application|db|kafka|redis|clickhouse|storage|secrets|observability|health|id|clock)/src/",
      },
    },
    {
      name: "packages-never-import-apps-or-services",
      severity: "error",
      comment: "Shared packages must never import from `apps/`, `services/`, or `edge/`.",
      from: { path: "^packages/" },
      to: { path: "^(apps|services|edge)/" },
    },
    {
      name: "no-cross-service-internals",
      severity: "error",
      comment:
        "A service may not import another service's internals — only shared `@platform/*` packages (and, later, `@platform/domain-events` / `@platform/api-clients`).",
      from: { path: "^services/([^/]+)/" },
      to: {
        path: "^services/([^/]+)/src/",
        pathNot: ["^services/$1/"],
      },
    },
    {
      name: "feature-definitions-only-via-registry",
      severity: "error",
      comment:
        "Feature Registry FREEZE (ADR-0028, P1.1.2): no bounded context imports Feature Definitions/Bundles/CapabilityGraph directly. Access to feature capabilities must go through the Feature Registry public port (`@platform/feature-registry` barrel) or the Registry Engine (`@platform/registry`). This rule is redundant with `no-cross-service-internals` today but is pinned permanently so the boundary survives future refactors.",
      from: { pathNot: "^services/feature-registry/" },
      to: { path: "^services/feature-registry/src/(domain|infrastructure|application)/" },
    },
  ],
  options: {
    tsPreCompilationDeps: "specify",
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.(test|spec)\\.ts$" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "types", "default"],
      mainFields: ["module", "main", "types"],
    },
  },
};
