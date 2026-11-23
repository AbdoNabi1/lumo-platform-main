export type SiteType = "store" | "lead_site";

/** Outbound read of the shop's own facts (tenancy owns them; an adapter in the app wires it). */
export interface ShopFactsPort {
  siteTypeOf(tenantId: string): Promise<SiteType>;
  currencyOf(tenantId: string): Promise<string>;
}

export { type LeadEmissionLedgerPort } from "@platform/tracking";
