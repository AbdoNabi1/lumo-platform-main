/**
 * The kind of actor a {@link Principal} represents — the **unified identity model**. `human` is a
 * *reference* to an Identity-context user (Security stores no human PII, only a `subjectRef`); every
 * other kind is a **non-human** identity that Security fully owns (ADR-0023 amendment).
 */
export const PRINCIPAL_KINDS = [
  "human",
  "service_account",
  "machine",
  "api_key",
  "robot",
  "partner",
  "marketplace",
  "ai",
] as const;

export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/** `human` principals are owned by Identity (referenced here); all others are owned by Security. */
export function isHumanKind(kind: PrincipalKind): boolean {
  return kind === "human";
}

export function isPrincipalKind(value: string): value is PrincipalKind {
  return (PRINCIPAL_KINDS as readonly string[]).includes(value);
}

/** Lifecycle state of a principal. `disabled` is terminal; `suspended` is reversible. */
export const PRINCIPAL_STATUSES = ["active", "suspended", "disabled"] as const;
export type PrincipalStatus = (typeof PRINCIPAL_STATUSES)[number];
