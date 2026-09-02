# M2-5 — Analytics and Platform Console non-durable state (disclosed, accepted)

Status: **CLOSED (docs-only)**. Per `MEDIUM_REMEDIATION_PLAN.md` §7: "Production impact: Low and
explicitly accepted — both are correctly-scoped in-process read-models with no aggregate to persist;
the only residual action is documenting the restart-resets-KPIs behavior for operators."

## Investigation

Re-verified against current source, not assumed from the prior audit:

- `services/analytics/src/composition.ts` — `wireAnalytics(): WiredAnalytics` takes **zero**
  parameters, constructs a fresh `SemanticRegistry` in-memory, and registers each context's canonical
  semantics (today: Finance, via `registerFinanceSemantics`). No store, no persistence dependency.
- `services/platform-console/src/composition.ts` — `wirePlatformConsole(): WiredPlatformConsole` takes
  **zero** parameters, constructs a fresh `PlatformKpisProjection` in-memory. No store, no persistence
  dependency. Its own doc comment already states it "owns no aggregates/events; nothing to drain."

Both are correct by design, not a defect: neither context has an aggregate to back a durable read-model
with, and building one purely to survive a restart would be exactly the kind of speculative
infrastructure this finding's remediation plan explicitly ruled out ("no aggregate exists to back either
with real persistence"). The only real gap was operational: nothing told on-call that a KPI dashboard
going to zero after a deploy is expected, not a data-loss incident.

## Change

Added a **Known non-durable state** section to `docs/operations/OPERATIONS_GUIDE.md` (between "Common
procedures" and "Error-budget policy"), naming both composition roots, why they reset, and the explicit
operator instruction: check deploy history before paging on an empty Platform Console dashboard or
Analytics catalog. No code changed.

## Regression risk

None — documentation only, no source files touched.

## Verification results

No code gates apply (docs-only change; `pnpm typecheck`/`lint`/`test`/`arch` are unaffected by a
markdown-only diff, consistent with the plan's own "Regression Risk: None" / "Implementation complexity:
Trivial (documentation only)" classification).

## Summary

- Files changed: 1 (`docs/operations/OPERATIONS_GUIDE.md`)
- Code changed: 0 files
- New abstractions introduced: 0
