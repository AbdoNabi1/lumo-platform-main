import { emptyPlatformKpis, type PlatformKpis } from "./platform-kpis";

/**
 * Projects platform-wide KPIs from Tenancy/Licensing/Usage/System integration events
 * (ADR-0018 Sprint-5.6 addendum §J) — read-model only, owns no business logic, mutates only its own
 * in-memory snapshot. A later runtime milestone wires this onto the live event bus; here it exposes
 * `apply()` so the composition root (or a test) can feed it recorded integration events directly.
 */
export class PlatformKpisProjection {
  private snapshot: PlatformKpis = emptyPlatformKpis();

  apply(eventType: string, payload: Record<string, unknown>): void {
    switch (eventType) {
      case "tenancy.tenant.created":
        this.snapshot = { ...this.snapshot, tenantCount: this.snapshot.tenantCount + 1 };
        break;
      case "tenancy.tenant.cancelled":
        this.snapshot = {
          ...this.snapshot,
          tenantCount: Math.max(0, this.snapshot.tenantCount - 1),
          churnedCount: this.snapshot.churnedCount + 1,
        };
        break;
      case "licensing.subscription.started":
        this.snapshot = { ...this.snapshot, trialCount: this.snapshot.trialCount + 1 };
        break;
      case "licensing.subscription.activated":
        this.snapshot = {
          ...this.snapshot,
          trialCount: Math.max(0, this.snapshot.trialCount - 1),
        };
        break;
      case "licensing.invoice.paid": {
        const amount = typeof payload.amount === "number" ? payload.amount : 0;
        this.snapshot = {
          ...this.snapshot,
          revenue: this.snapshot.revenue + amount,
          mrr: this.snapshot.mrr + amount,
          arr: (this.snapshot.mrr + amount) * 12,
        };
        break;
      }
      case "licensing.invoice.failed":
        this.snapshot = { ...this.snapshot, failedPayments: this.snapshot.failedPayments + 1 };
        break;
      case "platform.usage.recorded": {
        const resource = typeof payload.resource === "string" ? payload.resource : "";
        const amount = typeof payload.amount === "number" ? payload.amount : 0;
        if (resource === "AI_TOKEN") {
          this.snapshot = { ...this.snapshot, aiUsage: this.snapshot.aiUsage + amount };
        } else if (resource === "STORAGE") {
          this.snapshot = { ...this.snapshot, storageUsage: this.snapshot.storageUsage + amount };
        } else if (resource === "API_REQUEST") {
          this.snapshot = { ...this.snapshot, apiUsage: this.snapshot.apiUsage + amount };
        } else if (resource === "MARKETPLACE_INSTALL") {
          this.snapshot = {
            ...this.snapshot,
            marketplaceRevenue: this.snapshot.marketplaceRevenue + amount,
          };
        }
        break;
      }
      default:
        break;
    }
  }

  current(): PlatformKpis {
    return this.snapshot;
  }
}
