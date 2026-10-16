import type { Database } from "@platform/db";
import { type QuotaRequest, type QuotaVerdict, type UsageQuotaPort } from "@platform/entitlement";

/**
 * Production `UsageQuotaPort` (P1.3 §4) — a **read** over Licensing's event-sourced `UsageCounter`
 * projection (per tenant × resource running total). Consumption stays owned by Usage/Licensing (via
 * `platform.usage.recorded`); this adapter only reads the current counter and derives a quota
 * verdict. Deterministic and side-effect-free.
 *
 * **Disclosed deviation from the dirty-tree source:** the dirty tree's own copy of this adapter
 * queries a period-bucketed `UsageCounter.current`/`.limit` shape. That shape has no primary-source
 * backing anywhere (ADR-0018's Addendum §C and `G5_MILESTONE_REPORT.md` both document and
 * gate-verify the `amount`/`unit`/`lastRecordedAt` running-total shape actually committed for
 * Licensing's `UsageCounter`) — it is unattested drift, not evidenced history, so it is not
 * reconstructed here. This adapter instead reads the real, committed `UsageCounter.amount`. Per-tenant
 * limits have no read method on Licensing's controller yet (the same gap P1.3 §12 already discloses
 * for `LicensingPolicyPort`'s subscription-state read), so every resource resolves unmetered
 * (`limit: -1`) until Licensing exposes one — fail-open by the same documented precedent as that
 * sibling adapter, since an absent limit is not itself a denial.
 */
export class PrismaUsageQuota implements UsageQuotaPort {
  constructor(private readonly deps: { readonly prisma: Database }) {}

  async check(request: QuotaRequest): Promise<QuotaVerdict> {
    const row = await this.deps.prisma.usageCounter.findFirst({
      where: { resource: request.resource, tenantRef: request.tenant },
    });
    // WP-11 (F-07): `amount` is `Decimal` now (was `Float`) — Prisma returns a `Prisma.Decimal`
    // instance, not a `number`. This is a one-shot read for a quota display figure (never
    // persisted back), so a single `Number(...)` conversion is exact enough; no accumulator
    // needed the way `UsageCounter`'s own domain class needs one for repeated increments.
    const used = Number(row?.amount ?? 0) + (request.amount ?? 1);
    return { resource: request.resource, state: "ok", used, limit: -1, ratio: 0 };
  }
}
