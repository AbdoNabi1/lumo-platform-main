# Sol review — Shopify parity Wave 1b, round 3 (final convergence)

**Result: R7 RESOLVED; 0 blocking findings.** Scope is only round 2's remaining R7 and contradictions that amendment precedence cannot resolve. R1–R6 and R8–R12 remain resolved and were not re-litigated. No OPTIONAL finding was upgraded.

## R7 — RESOLVED

Evidence in `docs/superpowers/plans/2026-11-23-shopify-parity-w1b.md`:

- **Precedence (L14):** `round 2 > round 1 > original task text`; later blocks within a task win. Task 4's explicitly binding round-2 block at L293–295 supersedes the raw string/array limits at L278/L280 and the original schemas at L262/L265. Those older limits no longer govern tags.
- **Structural transport (L294):** BOTH create and replacement bodies use `tags: z.array(z.string())`, optional only for create. The block explicitly forbids array/string `.max()` checks, retaining only the shared HTTP body-size limit. The raw-before-normalization rejection identified in round 2 is removed from the effective contract.
- **Application authority (L294, consistent with L211–217):** `parseTags` alone enforces 40 code points per normalized tag and 250 tags AFTER comma splitting/de-duplication; semantic failure is 422 `VALIDATION` with field `tags`. Create's aggregate validation before repository calls remains intact.
- **Regression oracle (L295):** both create and tags HTTP routes must accept the single raw string containing `tag000` through `tag099`, return 201 / 200 respectively, and persist those 100 tags sorted. The existing 40-emoji, padded-tag, Latin/Arabic-comma and 251-distinct cases are expressly retained.
- **Consumer compatibility (L322, L326, L335, L338):** the unchanged string-array client/action contracts, including create's `[raw]` comma-separated input, now fit the effective transport schema and application normalization. No contradiction remains that the stated precedence cannot resolve.

## Verification and boundaries

- Read `AGENTS.md`, round-2 R7 and Opus triage (`w1b/plan-review-2.md:L36–41,L79–80`), the precedence rule, and the affected Task 3–5 passages.
- A read-only Python check exited 0: all eight targeted amendment assertions passed. Independently reconstructed the oracle: 798 UTF-16 units, 100 distinct normalized tags, maximum tag length 6 code points, normalized order exactly `tag000` through `tag099`. This checks the plan's counterexample data, not execution of future application code or HTTP tests.
- Only `docs/superpowers/plans/w1b/plan-review-3.md` was written. No source edits, pnpm, install, test suite, build, database operation, commit or other git write was performed. No review issue remains open within this convergence scope.

VERDICT: AGREED
