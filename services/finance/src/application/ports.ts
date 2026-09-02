import type { AccessControl, AuditTrail } from "@platform/contracts";

/**
 * Finance's own Security seam (ADR-0024: "Security reused via port") — composes the platform's
 * generic {@link AccessControl}/{@link AuditTrail} contracts with a step-up check for sensitive
 * commands (manual adjustment, exchange rate, period close). Finance defines this port and
 * fakes it in-memory for tests; it never imports `services/security` directly.
 */
export interface SecurityPort extends AccessControl, AuditTrail {
  /** Whether `principalId` has completed step-up authentication recently enough to proceed. */
  hasSteppedUp(principalId: string): Promise<boolean>;
}

/** Publishes a rebuilt read model for downstream consumers (Analytics) — offline-fakeable. */
export interface ReadModelPublisherPort {
  publish(model: string, key: string, value: unknown): Promise<void>;
}

/** Reads marketing spend facts owned by Analytics (D-065/066) — Finance never re-enters them. */
export interface MarketingSpendPort {
  getSpend(period: string, currency: string): Promise<number>;
}

/** AI forecasting — proposes-only; the caller must persist the result with `applied: false`. */
export interface ForecastProposal {
  readonly period: string;
  readonly figure: string;
  readonly proposedMinor: number;
  readonly currency: string;
  readonly applied: false;
}

export interface AiForecastPort {
  propose(figure: string, currency: string, horizonPeriods: number): Promise<ForecastProposal>;
}

/** Accounting-connector integration (deferred long-tail: QuickBooks/Xero/Zoho/Oracle/SAP/Dynamics). */
export interface AccountingIntegrationPort {
  readonly provider: "quickbooks" | "xero" | "zoho" | "oracle" | "sap" | "dynamics";
  exportJournal(journalId: string): Promise<void>;
}
