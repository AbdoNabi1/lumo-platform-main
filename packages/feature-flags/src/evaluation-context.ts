/**
 * The context a flag is evaluated against. `subjectId` is the stable identity that future
 * deterministic rollout will bucket on; the in-memory adapter ignores it (flags are simple on/off).
 * Targeting attributes are a future addition owned by the Experimentation implementation.
 */
export interface EvaluationContext {
  readonly subjectId: string;
}
