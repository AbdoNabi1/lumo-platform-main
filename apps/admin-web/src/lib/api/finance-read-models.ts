/**
 * The finance read-model names, split out of `./finance.ts` so a Client Component can import them.
 *
 * `./finance.ts` imports `./client`, which imports `@/lib/auth/session`, which imports
 * `next/headers` — server-only. `finance-model-picker.tsx` is a `"use client"` component that
 * needs nothing from that chain but this three-element list, and importing it from `./finance.ts`
 * dragged the whole server auth graph into the client bundle. That is a build error, not merely a
 * size problem: `next build` fails with "You're importing a component that needs next/headers".
 *
 * This module must therefore stay import-free. Anything needing `getAdminApi` belongs in
 * `./finance.ts`, which re-exports these so existing server-side importers are unaffected.
 */

/**
 * The only three models `FinanceProjectionService.rebuild` ever populates
 * (`services/finance/src/application/finance-projection.service.ts`) — `readModels.put("profit"|
 * "margin"|"financial_health", period, …)`. `InMemoryReadModelStore.query` (the `ReadModelStore`
 * implementation) never 404s on an unknown model name — it silently returns an empty page — so the
 * explorer validates against this known list itself rather than trusting the backend to reject a
 * typo'd or unsupported model.
 */
export const FINANCE_READ_MODELS = ["profit", "margin", "financial_health"] as const;
export type FinanceReadModelName = (typeof FINANCE_READ_MODELS)[number];

export function isFinanceReadModelName(value: string): value is FinanceReadModelName {
  return (FINANCE_READ_MODELS as readonly string[]).includes(value);
}
