/**
 * The lead statuses (`LEAD_STATUSES` in `@platform/leads`, D6): `new` is the default, and the
 * merchant may move a lead from any status to any other. `apps/*` never import `services/*`, so this
 * is the UI's hand copy; the API refuses a value outside the list with a 422.
 */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "converted",
  "rejected",
  "spam",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}
