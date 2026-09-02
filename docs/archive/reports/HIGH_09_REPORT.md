# HIGH-09 — Dependency & Security Advisories

**Source finding:** `H2-8` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` — _"The dependency-audit gate
never fails, and its stated justification is inaccurate."_
**Type:** Remediation. Dependency + CI config changed. **Public contract impact: none** (dependency
version bumps only; no source code touched).

---

## 1. Investigate

- `.github/workflows/ci.yml:45-49` (before this change) — `pnpm audit --audit-level high` ran with
  `continue-on-error: true`, justified as _"known dev-tooling advisories
  (vitest/vite/esbuild/postcss/OTel, G-6b)."_
- Executed at `HEAD`: **32 vulnerabilities — 1 critical, 18 high, 13 moderate.**
- Cross-referencing each High/Critical advisory's dependency path (`pnpm why <package>`) against the
  justification found it stale: `@fastify/static` (admin API transport, via `@fastify/swagger-ui`),
  `find-my-way` (Fastify's router — every API), and `next`/`sharp` (storefront, production) all carried
  High-severity advisories and are **not** dev tooling.

## 2. Prove

Re-ran `pnpm audit --audit-level high --json` after each change and diffed the advisory count and the
specific GHSA IDs present, rather than trusting a visual pass/fail — this is what a false negative in
this exact gate would look like if a fix were incomplete or a version bump silently reverted by a later
`pnpm install`. Also ran the full four-gate suite (typecheck/lint/test/arch) **and** `pnpm build`
(exercises the storefront's actual Next.js build with the bumped `next`/`sharp`/`postcss`, not just type
surfaces) after every dependency change.

## 3. Implement — production-facing advisories (fixed)

`pnpm-workspace.yaml` gained an `overrides` block forcing four packages to their patched versions,
because none of them could be reached by bumping a direct dependency alone:

| Package           | Was      | Now     | Why an override was needed                                                                                                                                                            |
| ----------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next`            | 15.5.19  | 15.5.22 | (direct dep bump, `pnpm --filter storefront update next`, stays within `^15.0.0`)                                                                                                     |
| `sharp`           | 0.34.5   | 0.35.3  | `next@15.5.22`'s own `optionalDependencies` still request `sharp ^0.34.3` (read from the installed package.json) — no next patch reaches the fix                                      |
| `find-my-way`     | 9.6.0    | 9.7.0   | Transitive via `fastify@5.9.0`, which does not itself declare a newer pin                                                                                                             |
| `@fastify/static` | 9.1.3    | 10.1.2  | Transitive via `@fastify/swagger-ui@5.2.6`; the fix requires `@fastify/swagger-ui@6.x` (a major bump) — the override reaches the patched `@fastify/static` without that larger change |
| `postcss`         | (varied) | 8.5.23  | Transitive via `next` and the `vite`/`vitest` toolchain; three separate advisories, all closed by one patch-level floor                                                               |

This alone took the count from **32 (1 critical / 18 high / 13 moderate)** to **16 (1 critical / 10
high / 5 moderate)** — every production-facing High advisory the audit named is gone.

## 4. Implement — remaining advisories, allowlisted (not silently dropped)

The remaining 10 High + 1 Critical are `vitest`/`vite` (test runner) and `brace-expansion`/`fast-uri`
(transitive through `eslint`, `typescript-eslint`, `commitlint`, and `dependency-cruiser`'s own `ajv`) —
verified via `pnpm why` that every path terminates in a devDependency-only tool chain with no reachable
code path in the built runtime/collector/storefront images. `brace-expansion` specifically has **two
different major-version populations already coexisting** (one under `eslint`'s `minimatch`, one under
`typescript-eslint`'s newer `minimatch`); a blanket semver override (`>=1.1.18`, say) would apply
uniformly and could hand the older consumer a major version it never asked for — a real regression risk
for zero production benefit, so this was deliberately not attempted.

Rather than leave the gate soft (the thing this finding exists to fix), `pnpm-workspace.yaml` gained an
`auditConfig.ignoreGhsas` list — the exact mechanism `pnpm audit --ignore <id>` persists, verified by
running it once and reading back what it wrote — naming all 8 distinct GHSA IDs with a comment
explaining the reasoning per group and instructing future sessions to re-verify the classification
before adding to it. This is the audit's own recommended fallback: _"allowlist them explicitly by
advisory ID rather than disabling the gate wholesale."_

## 5. Implement — the gate itself

`.github/workflows/ci.yml` — removed `continue-on-error: true`. `pnpm audit --audit-level high` is now a
hard gate; verified locally it exits `0` (`10 high (10 ignored)`, `1 critical (1 ignored)`) with the
allowlist in place, and would exit non-zero the moment a new, un-allowlisted High/Critical advisory
appears — which is the entire point.

## 6. Run

| Gate                            | Result                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm typecheck`                | ✅ 76/76 (including `storefront` and `@platform/admin`, both touching bumped deps) |
| `pnpm lint`                     | ✅ 76/76                                                                           |
| `pnpm build`                    | ✅ storefront builds and prerenders cleanly on `next@15.5.22`/`sharp@0.35.3`       |
| `pnpm test`                     | ✅ 76/76 tasks                                                                     |
| `pnpm arch`                     | ✅ no dependency violations (1,531 modules, 6,672 deps)                            |
| `pnpm audit --audit-level high` | ✅ exit 0 (was non-blocking before this change; hard gate now)                     |

## 7. Remaining, accepted (Medium bucket, out of this sprint)

5 Moderate advisories remain unaddressed: `esbuild` (build tooling), `vite` ×2 (test tooling),
`protobufjs` ×2 (OTel's OTLP exporter dependency — worth a closer look in a future sprint since OTel now
actually runs in the runtime process per `HIGH_03`, but Moderate severity is below this gate's
`--audit-level high` threshold and outside this finding's scope).

## 8. Scope discipline

No source code changed — only `pnpm-workspace.yaml` (overrides + audit allowlist), the lockfile, and one
CI workflow line. No architecture change, no new bounded context, no public API change.
