import type { LeadAttribution } from "../domain/lead";

export type SiteType = "store" | "lead_site";

/** Outbound read of the shop's own facts (tenancy owns them; an adapter in the app wires it). */
export interface ShopFactsPort {
  siteTypeOf(tenantId: string): Promise<SiteType>;
  currencyOf(tenantId: string): Promise<string>;
}

export { type LeadEmissionLedgerPort } from "@platform/tracking";

/**
 * What the tracking emitter is told about one lead (Tracking P2-D9). Purpose-built, so what leaves the context is
 * explicit: the contact the ad platforms match on, the visitor's attribution and the instant; NEVER the `message`
 * (free text), the form id's content or any status.
 */
export interface LeadTrackingSubject {
  readonly tenantId: string;
  readonly leadId: string;
  readonly name: string;
  /** As the visitor typed it. */
  readonly phone: string;
  readonly phoneE164: string;
  readonly email: string | null;
  readonly sessionId: string;
  readonly submittedAt: Date;
  readonly attribution: LeadAttribution;
}

/**
 * Outbound port: send the lead to the tracking pipeline as a server `form_submitted` event. The adapter (apps/runtime)
 * builds the envelope and appends it to the outbox under a derived, stable message id, so calling it again for the
 * same lead is harmless — the sweeper relies on that. Rejects when the event could not be handed over.
 */
export interface LeadTrackingPort {
  emit(subject: LeadTrackingSubject): Promise<void>;
}
