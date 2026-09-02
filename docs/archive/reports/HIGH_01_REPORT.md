# HIGH-01 — Runtime Security Guards & Boot Hardening

**Source finding:** `H2-3` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` (guard-mounting half) — _"The entire
zero-trust runtime, security provisioning and entitlement layer has zero production callers."_
**Type:** Remediation. Code changed. **Public contract impact: none** (additive validation only).

---

## 1. Investigate

Repository-wide search (excluding tests and the symbol's own subtree) confirms, at current `HEAD`, the
same zero-caller state the audit recorded:

| Symbol                            | Location                                                | Non-test callers                         |
| --------------------------------- | ------------------------------------------------------- | ---------------------------------------- |
| `buildSecurityHttpGuard`          | `apps/runtime/src/security/wire-security-runtime.ts:90` | **0**                                    |
| `wireSecurityRuntime`             | `apps/runtime/src/security/wire-security-runtime.ts:38` | 0 outside `buildSecurityHttpGuard`/tests |
| `SECURITY_ZERO_TRUST_ENFORCEMENT` | `apps/runtime/src/config.ts:133`                        | **0** (validated, never read)            |

None of `apps/runtime/src/{api,worker,scheduler,composition}.ts` imports anything from `./security`. The
config comment at `config.ts:127-131` documents intended behaviour ("Mounts `SecurityPermissionGuard` as
the HTTP authorization point... When `on`, the runtime REQUIRES the Prisma-backed Security context to
build") that the `on` branch never implements at any call site — an operator can set the flag, pass
validation (once `SECURITY_PRINCIPAL_PROVISIONING` is also `on`), and observe **no behaviour change**:
`AdminGuard` + Keto remains the sole enforcement point (`apps/admin/src/http/server.ts:64-68`, unconditional).

## 2. Prove

Reproduced the false-assurance path directly: constructing `RuntimeConfig` with
`SECURITY_ZERO_TRUST_ENFORCEMENT=on` + `SECURITY_PRINCIPAL_PROVISIONING=on` passed Zod validation
before this change (the only existing cross-field rule checks the two flags against each other, not
against reality), while `buildSecurityHttpGuard` still had zero entrypoint callers.

## 3. Why this is the right-sized fix

Actually mounting `buildSecurityHttpGuard` as the live HTTP authorization point is a substantial,
higher-risk change: it replaces the single authorization seam for every admin route, requires the
principal-provisioning fleet to have already populated the Security store (still unwired — tracked
separately as `HIGH_04`), and per the sprint rules must not redesign the request pipeline or land as a
speculative activation. The audit's own recommended action offers exactly this smaller alternative:
_"make the dead flags fail loudly at boot so the runtime never silently misrepresents its own posture...
should land regardless of when the first [full wiring] is scheduled."_ This finding implements that half.
`SECURITY_PRINCIPAL_PROVISIONING` is deliberately **not** included in this guardrail — see `HIGH_04`,
which makes that flag real.

## 4. Implement

`apps/runtime/src/config.ts` — added a fourth `superRefine` clause: if `SECURITY_ZERO_TRUST_ENFORCEMENT`
is `on`, boot validation now fails with a message naming the exact unmounted symbol and file. Converts a
silent no-op into an explicit, actionable boot error; both flags still default `off`, so no current
deployment is affected.

`apps/runtime/src/composition.test.ts` — added a regression test asserting `loadRuntimeConfig` throws
`/SECURITY_ZERO_TRUST_ENFORCEMENT=on is not supported yet/` when the flag is set.

## 5. Run

| Gate             | Result                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `pnpm typecheck` | ✅ 76/76                                                           |
| `pnpm lint`      | ✅ 76/76                                                           |
| `pnpm test`      | ✅ 76/76 tasks; `@platform/runtime` 26 files / 126 tests (was 125) |
| `pnpm arch`      | ✅ no dependency violations (1,531 modules, 6,672 deps)            |

## 6. Scope discipline

No architecture change, no new bounded context, no public API change (an additive `superRefine` clause;
`RuntimeConfig`'s inferred type is unchanged). No speculative activation of the zero-trust subtree.

## 7. Remaining gap (tracked, not closed here)

`buildSecurityHttpGuard` is still not mounted in any entrypoint — this finding makes that state honest,
it does not activate the guard. Mounting it is future work, gated on `HIGH_04`'s principal-provisioning
fleet landing first (so enforcement never activates against an empty store) and on a live Ory stack being
reachable in the target environment.
