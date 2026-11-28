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
export type { LeadListQuery, LeadRepository, PendingTrackingQuery } from "./domain/lead-repository";
export { PrismaLeadRepository } from "./infrastructure/prisma-lead-repository";
export {
  LEAD_TRACKING_MAX_AGE_MS,
  LEAD_TRACKING_MIN_AGE_MS,
  SweepPendingLeadTracking,
  type LeadTrackingSweepDeps,
  type LeadTrackingSweepReport,
} from "./application/lead-tracking-sweep";
export { leadMatchesSearch, toLatinDigits } from "./domain/lead-search";
export type {
  LeadEmissionLedgerPort,
  LeadTrackingPort,
  LeadTrackingSubject,
  ShopFactsPort,
  SiteType,
} from "./application/ports";
export {
  CURRENCY_CALLING_CODE,
  MIN_FILL_MS,
  type LeadView,
  type SubmitLeadInput,
  type SubmitLeadOutput,
} from "./application/leads.use-cases";
