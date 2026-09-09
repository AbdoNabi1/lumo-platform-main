import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Monorepo root, computed from this file's own location — NOT `process.cwd()`. This config is
// evaluated both via `pnpm --filter <pkg> exec eslint .` (cwd = that package's own directory) and
// via lint-staged's pre-commit hook (cwd = the repo root, invoked once across staged files from
// every package at once). `projectService` needs ONE stable root to resolve each linted file's
// own nearest tsconfig.json from, regardless of which of those invoked it.
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Root-level config/tooling files that fall outside every package's own tsconfig `include: ["src"]`
// (vitest.config.ts, next.config.ts, apps/runtime/scripts/*, …) — see `allowDefaultProject` below.
// One explicit depth level per workspace group (`apps/*/…`), not a recursive `**` glob:
// typescript-eslint refuses `**` here outright (a perf guard against silently defaulting large
// swaths of files off real project-based checking — https://tseslint.com/allowdefaultproject-glob-too-wide).
const workspaceGroups = ["apps", "packages", "services"];
const rootConfigGlobs = workspaceGroups.flatMap((group) =>
  ["ts", "mjs", "js"].map((ext) => `${group}/*/*.config.${ext}`),
);
const rootScriptGlobs = workspaceGroups.flatMap((group) => [
  `${group}/*/scripts/*.ts`,
  `${group}/*/scripts/*.mjs`,
]);
// G0-5/follow-up (launch-readiness review): root-level `scripts/ops/*.mjs` and `scripts/dev/*.mjs`
// (the fitness-function checkers, dev-only auth seeding, etc.) were never covered by any glob
// here — Stage 3 (H-09) added `projectService`/`allowDefaultProject` without ever having a staged
// change under root `scripts/` to surface the gap, so it went undetected until a later commit
// under `scripts/ops/` hit lint-staged directly. Confirmed via `pnpm exec eslint
// scripts/ops/check-env-docs.mjs`, which failed with the same "not found by the project service"
// error `rootScriptGlobs` above exists to prevent for per-workspace scripts.
const rootOpsScriptGlobs = ["scripts/*/*.ts", "scripts/*/*.mjs"];
// WP-17: same "not found by the project service" gap as rootOpsScriptGlobs above, hit for the
// first time when .dependency-cruiser.cjs (root-level tooling config, no tsconfig `include`s it)
// was touched for the apps-no-testing-imports rule — nothing under `scripts/` or `*/*/`.config.*
// covers a bare root dotfile config.
const rootToolingConfigGlobs = [".dependency-cruiser.cjs"];

/**
 * H-09 (audit): `tseslint.configs.recommended` runs zero type-aware rules — no
 * `no-floating-promises`, `no-misused-promises`, `await-thenable`, `require-await`, or the
 * `no-unsafe-*` family. In an async, Fastify+Prisma-heavy codebase, an unawaited promise in a
 * write path is a real money/inventory bug class, not a style nit — "zero ESLint warnings across
 * 78 packages" was measuring a shallow gate, not proving the absence of that class of bug.
 * `recommendedTypeChecked` needs each linted file's tsconfig, which `projectService: true`
 * resolves automatically (every package here already has its own tsconfig.json extending
 * @platform/tsconfig — no per-workspace `project: [...]` path list to maintain).
 */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: {
        projectService: {
          // Every package's tsconfig.json scopes `include` to `src` (see @platform/tsconfig) —
          // config files at each package's own root (vitest.config.ts, next.config.ts, etc.) are
          // legitimately outside that, not an oversight. projectService falls back to a
          // single-file inferred project for anything matching these globs instead of erroring
          // "was not found by the project service". Patterns are root-relative (built above from
          // `tsconfigRootDir`, not package-relative — `tsconfigRootDir` is now the fixed monorepo
          // root, not the invoking process's cwd; see that constant's own comment for why).
          allowDefaultProject: [
            ...rootConfigGlobs,
            ...rootScriptGlobs,
            ...rootOpsScriptGlobs,
            ...rootToolingConfigGlobs,
          ],
        },
        tsconfigRootDir: monorepoRoot,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      // H-09 phased rollout (audit remediation Stage 3): `recommendedTypeChecked` surfaced 433
      // real findings on first activation across the monorepo. 21 (no-unnecessary-type-assertion,
      // no-unused-vars, unbound-method, no-redundant-type-constituents, no-unsafe-return,
      // no-base-to-string, restrict-template-expressions) are fixed and stay at "error". The
      // remaining 412 are all `require-await` — a method declared `async` with no internal
      // `await`, near-universal across the Prisma repository adapters (`async findById(...)`
      // implementing a port that returns `Promise<T>` for callers awaiting a genuinely-async
      // interface, but backed today by a synchronous in-memory Map). Each one needs a
      // case-by-case check before converting (does removing `async` change synchronous-throw-vs-
      // rejected-promise behavior for any caller's `.catch()`?) — not a bulk mechanical fix.
      // "warn" keeps the finding visible in `pnpm lint` output everywhere (never silently
      // dropped) while that per-package cleanup happens incrementally; a package that reaches
      // zero should get a local override back to "error" (see packages/http, apps/runtime,
      // apps/admin, packages/feature-flags, packages/messaging, packages/kafka for the pattern —
      // already clean, first to prove it end-to-end).
      "@typescript-eslint/require-await": "warn",
    },
  },
  // Type-aware rules need a real tsconfig program; test files aren't part of any package's
  // `include` (tsconfig.json scopes to `src`, and vitest runs them directly, unchecked at build
  // time) — projectService can't resolve one for them, so type-checked linting is off for
  // *.test.ts(x) rather than erroring on every test file for an unrelated reason.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    ...tseslint.configs.disableTypeChecked,
  },
  // Flat-config authoring files — this file, next.mjs, and every workspace's own
  // eslint.config.mjs (root, apps/admin-web, apps/storefront) — are not application code: no
  // package.json#lint script of their own, no tsconfig.json, never compiled; imported/evaluated
  // as plain ES modules by ESLint itself. `allowDefaultProject`'s single-file inferred project
  // can't resolve real module types for their imports (@eslint/js, typescript-eslint,
  // eslint-config-prettier, globals, or — for the two app-level files — this file/next.mjs
  // themselves) the way a real tsconfig with proper `moduleResolution` can, so every import and
  // every `...spread` of one resolves as `any`/error-typed under type-aware rules. Same
  // not-a-real-project situation as test files above, not something worth a tsconfig just for.
  {
    files: ["packages/eslint-config/*.mjs", "**/eslint.config.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  // G0-5/follow-up (launch-readiness review): root-level `scripts/ops/*` and `scripts/dev/*` —
  // fitness-function checkers, dev-only auth seeding — are standalone Node scripts with no
  // package.json#lint script and no tsconfig.json `include`ing them, same not-a-real-project
  // situation as the flat-config files above. `allowDefaultProject` above only stops the "not
  // found by the project service" PARSE error; without also disabling type-checked rules here,
  // every Node built-in import (node:fs, node:path, node:child_process, …) resolves as
  // `any`/error-typed through the single-file inferred project, producing hundreds of
  // `no-unsafe-*` findings that have nothing to do with these files' actual correctness.
  {
    files: rootOpsScriptGlobs,
    ...tseslint.configs.disableTypeChecked,
  },
  // Same not-a-real-project situation as the flat-config files and root ops scripts above:
  // .dependency-cruiser.cjs has no tsconfig and is evaluated standalone by dependency-cruiser
  // itself, so its single-file inferred project can't resolve real types for its own `require`s.
  {
    files: rootToolingConfigGlobs,
    ...tseslint.configs.disableTypeChecked,
  },
  // Disable formatting rules that conflict with Prettier (must be last).
  prettier,
];
