# High Findings Remediation Sprint — Summary

**Baseline:** `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` (2026-08-05, `main` @ `aee3269`), re-verified at
current `HEAD` before this sprint (Critical-1..6 and V-1 already closed, per the sprint brief).
**Scope:** the 9 High findings only (H2-1 through H2-9 in the v2 audit's numbering), executed in the
assigned order H-01 → H-09. Medium and Low findings were explicitly out of scope and are unchanged
except where noted.
**Method:** for each finding — investigate, prove (a failing/passing test or reproducible check),
implement the smallest fix that closes it without redesigning architecture or introducing speculative
surface, run all four gates, produce `HIGH_<N>_REPORT.md`, commit alone. One commit per finding,
9 commits total (`556619b` → `8813210`).

---

## Fixed findings

| #    | Title                                    | Maps to (v2 audit)             | Report                                 | Commit    |
| ---- | ---------------------------------------- | ------------------------------ | -------------------------------------- | --------- |
| H-01 | Runtime Security Guards & Boot Hardening | H2-3 (guard-mounting half)     | [HIGH_01_REPORT.md](HIGH_01_REPORT.md) | `556619b` |
| H-02 | Audit Trail Persistence                  | H2-1                           | [HIGH_02_REPORT.md](HIGH_02_REPORT.md) | `be23623` |
| H-03 | Runtime Telemetry Wiring                 | H2-2                           | [HIGH_03_REPORT.md](HIGH_03_REPORT.md) | `e9903b9` |
| H-04 | Security Bootstrap / Entitlement Wiring  | H2-3 (provisioning-fleet half) | [HIGH_04_REPORT.md](HIGH_04_REPORT.md) | `1b44a3a` |
| H-05 | Retry Backoff Blocking                   | H2-4                           | [HIGH_05_REPORT.md](HIGH_05_REPORT.md) | `f0bbbe8` |
| H-06 | Tracking Topic Provisioning              | H2-5                           | [HIGH_06_REPORT.md](HIGH_06_REPORT.md) | `f58b277` |
| H-07 | Collector Deployment & Health            | H2-6                           | [HIGH_07_REPORT.md](HIGH_07_REPORT.md) | `2885f93` |
| H-08 | Observability / Prometheus               | H2-7                           | [HIGH_08_REPORT.md](HIGH_08_REPORT.md) | `1d492ff` |
| H-09 | Dependency & Security Advisories         | H2-8                           | [HIGH_09_REPORT.md](HIGH_09_REPORT.md) | `8813210` |

**H2-3 was one audit finding, closed across two commits (H-01 + H-04) by design.** It bundled three
unrelated dead-code clusters (the zero-trust HTTP guard, the principal-provisioning consumer fleet, and
the entitlement layer). H-01 makes the guard's dead config flag honest (fails boot rather than silently
no-opping) without mounting it — mounting it live is a materially larger, riskier change than a High
finding should carry in one sitting, and the audit's own recommended action offered this as the smaller,
always-correct alternative. H-04 does real, safe wiring for the other two-thirds: the security
provisioning fleet is fully wired (config-gated, off by default); entitlement wiring was investigated
and found to have **no real production adapter to wire against** (Licensing's committed controller has
no `checkEntitlement` PDP endpoint) — building one is out of this sprint's scope (new public surface on
another context), so it's left as a disclosed gap, not a fabricated wire-up. Full reasoning in both
reports.

**Every fix stayed inside the sprint's rules:** no architecture redesign, no new bounded context, no
public API changes beyond small additive fields/methods (all optional, all backward compatible — verified
by every existing test suite passing unmodified). All four gates (`typecheck`/`lint`/`test`/`arch`) were
green after every single commit, not just at the end.

---

## Remaining Medium findings (unchanged — out of this sprint's scope)

| ID   | Finding                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- |
| M2-1 | Purchase saga cannot complete (zero `.signal()` call sites)                                         |
| M2-2 | Media object storage is a stub that reports every object as existing                                |
| M2-3 | Licensing billing never moves money (in-memory payments/finance adapters)                           |
| M2-4 | `as never` defeats type checking at two runtime composition seams                                   |
| M2-5 | Analytics/Platform Console non-durable (disclosed, accepted — correct call per the audit)           |
| M2-6 | Storefront is built but not deployed (no Deployment/Service/Ingress)                                |
| M2-7 | Consumer-path payment verification optional (defensible; asymmetry undocumented at the wiring site) |

None of these were touched. **H2-9** — _"33 of 37 durable contexts have never executed against a real
database"_ — was also **not** addressed: it wasn't in the 9-item execution list this sprint was given,
and per the v2 audit it's substantial verification work (integration test suites for 6+ contexts), not a
wiring fix, so it wouldn't have fit this sprint's "smallest additive fix" shape regardless. It should be
the first item in whatever comes after Medium findings, or folded into the Medium pass — it's the single
highest-leverage remaining item per the v2 audit's own sequencing.

## Remaining Low findings (unchanged, one partially superseded)

| ID   | Finding                                                                    | Status                                                                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L2-1 | Dead packages (`@platform/temporal`, `@platform/grpc`, `services/example`) | unchanged                                                                                                                                                                                                                                                                                                 |
| L2-2 | `TENANT_MODE` dead configuration                                           | likely resolved as a byproduct of C2-6 (closed pre-sprint) — not independently reverified this sprint                                                                                                                                                                                                     |
| L2-3 | 34 milestone reports at the repository root                                | **worse, by design** — this sprint added 9 more (`HIGH_01_REPORT.md`…`HIGH_09_REPORT.md`) plus this summary, per the sprint's own required deliverables. A repo-hygiene pass to move these into `docs/implementation/` (as the original L2-3 finding recommended) would be a good Low-priority follow-up. |
| L2-4 | No `build` script for `apps/runtime` (by design — `tsx` at runtime)        | unchanged, not a defect                                                                                                                                                                                                                                                                                   |

---

## Updated Production Score

**Methodology note (read before trusting the number below):** this is a sprint-derived estimate, not a
fresh full audit. The v2 audit's own scoring required direct execution (booting the config, running
`pnpm audit`, counting schema tables) across every dimension; this sprint re-verified only the
dimensions its 9 findings touch. Dimensions marked "estimated" should be treated as directional, not
certified — a `v3` audit repeating v2's methodology is the right way to get an authoritative number.

| Dimension                      | Weight | v2 Score | This sprint's effect                                                                                                                                                                                                            | Est. now | Confidence                                             |
| ------------------------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| Architecture & code quality    | 15%    | 95       | None — `pnpm arch` stayed at 0 violations across all 9 commits                                                                                                                                                                  | 95       | High (directly re-verified)                            |
| Persistence correctness        | 15%    | 85       | None — not touched                                                                                                                                                                                                              | 85       | High (unchanged, not re-verified this sprint)          |
| Persistence verification depth | 10%    | 25       | None — H2-9 explicitly out of scope                                                                                                                                                                                             | 25       | High (unchanged)                                       |
| Build, CI/CD & supply chain    | 10%    | 70       | H-09 closes the disabled audit gate (the dimension's stated weakness); C2-5's migration step was already closed before this sprint                                                                                              | ~90      | High (directly re-verified)                            |
| Runtime bootability            | 15%    | 0        | C2-1 (config now boots) was closed before this sprint; H-01/H-03/H-06 remove three more silent-lie/dead-wiring gaps on the boot path                                                                                            | ~60      | **Estimated** — no live boot was performed this sprint |
| Payments / revenue path        | 10%    | 10       | Untouched by this sprint's scope; C2-2's webhook route exists (closed just before this sprint) but the real PSP adapter is still the fail-closed stub                                                                           | ~15      | Medium                                                 |
| Security posture               | 15%    | 30       | H-01 closes the false-assurance guard flag; H-04 populates the principal store (still not enforcing — deliberately, see H-01/H-04); C2-4's MFA fail-closed was already closed before this sprint                                | ~40      | **Estimated**                                          |
| Observability & operations     | 10%    | 35       | The most concentrated set of fixes this sprint: H-02 (durable audit trail), H-03 (OTel actually starts), H-07 (collector deployable + real health check), H-08 (Prometheus scrapes the runtime, API emits its readiness gauges) | ~75      | Medium-High                                            |

### Weighted estimate: **~62 / 100** (v2: 55/100)

---

## Updated Production Verdict

> ### ❌ STILL NOT APPROVED FOR PRODUCTION

The verdict has not flipped, and shouldn't have — this sprint's own rules (no PSP adapter, no live-Ory
boot, no new engineering on the true long poles) guaranteed it wouldn't. What changed is real:

- **Every High finding assigned to this sprint is closed** — 8 of the 9 v2-audit High findings (H2-3
  spanning two commits), with the ninth (H2-9) explicitly and honestly deferred rather than faked.
- **Two silent-lie configuration gaps are gone** (H-01's zero-trust flag, and the tracking topic/config
  visibility in H-06) — both were "an operator could enable this and nothing would happen" traps, now
  either honest failures or real wiring.
- **Observability went from mostly-blind to mostly-working**: the audit trail is durable, OTel actually
  starts, the collector has a real readiness check and is deployable, and Prometheus can see the runtime.

**What still blocks production, unchanged by this sprint (by design):**

1. **C2-2, the real PSP adapter** — still the single largest remaining piece of genuine engineering in
   the entire audit trail (v1 → v2 → this sprint all defer it as "long pole for revenue," correctly).
2. **H2-9, persistence verification depth** — 33 of 37 durable contexts have still never executed
   against a real database. This is the highest-leverage remaining item and should come next.
3. **The Medium bucket** (7 items, table above) — untouched, as instructed.
4. **Entitlement enforcement** — investigated this sprint (H-04) and found to have no real adapter to
   wire against; building one is Licensing-context work, not a wiring fix.

**Recommended sequencing for what comes next**, consistent with the evidence this sprint gathered:
H2-9 integration coverage first (converts persistence work from compile-time confidence to evidence,
and is prerequisite to trusting anything built on top of it) → the Medium bucket → C2-2's real PSP
adapter and a live Ory boot, which remain the two genuine long poles no amount of wiring-sprint work can
shortcut.
