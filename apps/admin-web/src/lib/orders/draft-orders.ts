import type { DraftOrderStatus } from "@/lib/api/draft-orders";

/** Shopify's page size; the API's maximum too. */
export const DRAFT_PAGE_SIZE = 50;
export const DRAFT_STATUSES: readonly DraftOrderStatus[] = ["open", "invoice_sent", "completed"];

export function parseDraftStatus(raw: string | undefined): DraftOrderStatus | undefined {
  return DRAFT_STATUSES.find((status) => status === raw);
}

/** A tab's link: the search stays, the cursor goes (a new tab starts on page one). */
export function draftsHref(state: {
  readonly status: DraftOrderStatus | undefined;
  readonly q: string | undefined;
}): string {
  const params = new URLSearchParams();
  if (state.status !== undefined) params.set("status", state.status);
  if (state.q !== undefined && state.q !== "") params.set("q", state.q);
  const query = params.toString();
  return query === "" ? "/draft-orders" : `/draft-orders?${query}`;
}

/** `orders:draft` / `orders:complete_draft` are operators' and admins' (the API decides; this only hides buttons). */
export function canEditDrafts(role: string | undefined): boolean {
  return role === "admin" || role === "operator";
}

/** "Mark as paid" also needs `payments:confirm_cod_collection` — admins only (spec Permissions). */
export function canMarkDraftPaid(role: string | undefined): boolean {
  return role === "admin";
}

/** Ruling 19: the API prefixes every draft 409 message with its code. */
export function conflictCodeOf(message: string): string | null {
  return /^([A-Z_]+):/.exec(message)?.[1] ?? null;
}
