# Lead Site Plan D1 — review round 3 (final convergence)

Reviewed HEAD `64ad30b8` (`docs(plans): lead site part d1 amendments after plan review 2`) on `morbeh/lead-site`. Scope: only round-2 findings 8 and 9, the concluding **Opus triage (round 2)**, and whether their amendments contradict already agreed requirements. `plan:L` refers to line L of `2026-11-23-lead-site-part-d1-ad-platform-connections-and-payloads.md` at this HEAD. Resolution is at the plan level, not a claim that future D1 implementation or tests already exist.

## Finding 8 — Resolved

**Evidence:** Task 4 now explicitly prescribes `runInTenantTransaction(this.db, tenantId, async (tx) => …)` and forbids calling the old root-bound `append` inside that transaction (`plan:815–826`). The actual store declares `private readonly db: RegistryDb` (`apps/runtime/src/tracking/tracking-registry.ts:75–95`); existing append uses that root member (`:129–150`). `RegistryDb` includes `Database`, and `runInTenantTransaction` accepts a root Prisma client and supplies a transaction client after tenant setup (`packages/db/src/transaction.ts:41–56`). The nonexistent `this.prisma` reference identified in round 2 is therefore corrected without requiring a constructor rename or a root-client cast.

**Consistency:** The agreed bound advisory-lock key, transaction-bound `writerOver(tx, tenantId)`, tenant-qualified registry operations, post-lock live-connection read, rollback coverage and concurrent-sync coverage remain intact. The lock is first in the supplied transaction callback, after the helper's tenant setup; this does not reverse the existing tenant-scoping contract. No change to the accepted serialization design is requested.

## Finding 9 — Resolved

**Evidence:** Task 1 replaces the broad original secret pattern with `/^[A-Za-z0-9._~+/=:|-]+$/`, keeps the 10–1024 length limits, updates the validation message, and requires quote/backslash/space rejection tests (`plan:358–360`). Task 3 repeats the same rule and replaces serialized-JSON substitution with recursive redaction of decoded strings, array items, object keys and values (`plan:684–694`). Its needles explicitly include raw, URL-encoded and JSON-escaped forms; both returned diagnostics and thrown transport-error messages pass through redaction. Over-depth or oversized vendor responses are dropped rather than returned unsanitized.

The original whole-EventRecord/history/attempts, dead-letter, logger, unchanged-registry-URL and record-before-send checks are retained (`plan:695–698`). Added regressions exercise accepted punctuation-bearing tokens in nested keys, values and authenticated URLs. Together these instructions remove the JSON-escaping mismatch established by round 2; they do not rely on replacing raw token text over serialized JSON.

**Consistency:** The Task 1 and Task 3 rules agree. The revised alphabet accommodates the vendor token character sets supplied in the review brief, including Snap's dots/base64url and GA4's hyphen/underscore. Narrowing the original pattern is an explicit binding amendment, not a competing instruction. Building authentication locally and sanitizing returned diagnostics preserves the already agreed secret-handling and endpoint-immutability requirements. No new requirement is introduced.

## Verification and scope limits

- Re-read the full round-2 review through its concluding triage, the amended plan, the latest amendment diff and the relevant existing store/transaction code.
- A read-only Node assertion probe, run through the prescribed native pnpm entry point with `pnpm_config_verify_deps_before_run=false`, evaluated the actual amended regex: five accepted samples and four rejected samples passed, exit 0. It also confirmed the plan uses `this.db` and no longer contains the erroneous transaction call using `this.prisma`. The samples are synthetic; this is not live-vendor validation or implementation-test evidence.
- No contradiction with already agreed requirements was found in these amendments. The other 17 findings remain closed without re-review; OPTIONAL remains OPTIONAL, and prior accepted deviations remain accepted.
- Only this round-3 review file was written. No plan/code edits, dependency installs, builds, migrations, DB operations or live vendor calls were performed.

VERDICT: AGREED
