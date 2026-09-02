# @platform/feature-flags

## Purpose

Feature-flag evaluation — decouples release from deploy and provides kill switches
(docs/architecture/12). Phase-1 minimum only.

## Architecture

- `FeatureFlags` — the evaluation port (`isEnabled(key, context)`).
- `EvaluationContext` — `{ subjectId }`; the stable identity future rollout will bucket on (ignored
  by the in-memory adapter).
- `InMemoryFeatureFlags` — a static key→enabled map; unknown keys are disabled (safe default +
  kill switch). No rollout, percentage hashing, multivariate evaluation, or targeting — those are
  owned by the future Experimentation implementation and are the production source of truth.

## Dependencies

None at runtime (a dependency-graph leaf). Dev-only: build/test tooling. Consumed by application
services to gate Phase-1 features behind flags.

## Extension points

- Replace `InMemoryFeatureFlags` with an Experimentation-backed `FeatureFlags` (deterministic
  bucketing, multivariate, targeting) behind the same port.
- Extend `EvaluationContext` with targeting attributes (additive, non-breaking) when targeting lands.
