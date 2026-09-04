/**
 * The security lifecycle transition tables, split out of `./security.ts` so Client Components can
 * import them.
 *
 * `./security.ts` imports `./client`, which imports `@/lib/auth/session`, which imports
 * `next/headers` — server-only. `identity-actions.tsx` and `audit-actions.tsx` are `"use client"`
 * components that need nothing from that chain but these two tables, and importing them from
 * `./security.ts` dragged the whole server auth graph into the client bundle. That is a build
 * error, not merely a size problem: `next build` fails with "You're importing a component that
 * needs next/headers".
 *
 * Note the distinction that makes this a small change: every other Client Component importing from
 * `@/lib/api/*` uses `import type`, which TypeScript erases before webpack ever sees it. Only
 * value imports — these two tables and `FINANCE_READ_MODELS` — actually pull the module in.
 *
 * This module must therefore stay import-free. Anything needing `getAdminApi` belongs in
 * `./security.ts`, which re-exports these so existing server-side importers are unaffected.
 */

export type PrincipalTransitionTarget = "suspended" | "active" | "disabled";

/**
 * UI-only mirror of `Principal`'s private `TRANSITIONS` table
 * (`services/security/src/domain/principal.ts`), read directly rather than assumed — used only to
 * gate which `to` options a per-row transition control offers for a principal's current status.
 * Not authoritative: `Principal.transition` is the sole source of truth and still enforces this
 * itself server-side; a UI/domain drift here can only offer an option the backend then rejects
 * with a normal form error (constraint #3/#10), never silently allow an illegal one.
 */
export const PRINCIPAL_STATUS_TRANSITIONS: Readonly<
  Record<PrincipalTransitionTarget, readonly PrincipalTransitionTarget[]>
> = {
  active: ["suspended", "disabled"],
  suspended: ["active", "disabled"],
  disabled: [],
};

export type IncidentLifecycleAction = "triage" | "mitigate" | "resolve" | "close";

/**
 * UI-only mirror of `Incident`'s private `TRANSITIONS` table (`services/security/src/domain/
 * incident.ts`): `detected` -> triage or close, `triaged` -> mitigate or close, `mitigating` ->
 * resolve or close, `resolved` -> close only, `closed` -> none (terminal). Not authoritative:
 * `Incident.transition` is the sole source of truth and still enforces this itself server-side — a
 * UI/domain drift here can only offer an action the backend then rejects with a normal form error
 * (constraint #3/#10), never silently allow an illegal one.
 */
export const INCIDENT_NEXT_ACTIONS: Readonly<Record<string, readonly IncidentLifecycleAction[]>> = {
  detected: ["triage", "close"],
  triaged: ["mitigate", "close"],
  mitigating: ["resolve", "close"],
  resolved: ["close"],
  closed: [],
};
