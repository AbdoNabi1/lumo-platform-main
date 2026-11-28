export { wireLeads } from "./composition";
export type { LeadsWiringDeps, WiredLeads } from "./composition";
export { LeadsController } from "./interfaces/leads.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export {
  Lead,
  LEAD_STATUSES,
  LEAD_TRACKING_STATUSES,
  type LeadAttribution,
  type LeadClickId,
  type LeadProps,
  type LeadUtm,
  type LeadStatus,
  type LeadTrackingStatus,
} from "./domain/lead";
export type { LeadListQuery, LeadRepository } from "./domain/lead-repository";
export { leadMatchesSearch, toLatinDigits } from "./domain/lead-search";
export type { LeadEmissionLedgerPort, ShopFactsPort, SiteType } from "./application/ports";
export {
  CURRENCY_CALLING_CODE,
  MIN_FILL_MS,
  type LeadView,
  type SubmitLeadInput,
  type SubmitLeadOutput,
} from "./application/leads.use-cases";
