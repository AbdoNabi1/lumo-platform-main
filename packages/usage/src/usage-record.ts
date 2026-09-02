/**
 * The canonical, **Licensing-agnostic** usage record (ADR-0018 addendum §C). Any bounded context emits one; the
 * producer knows nothing about who consumes it (Licensing/Billing/Analytics/AI). `resource` is an opaque metered
 * dimension key (e.g. `ai_credits`, `products`, `storage_bytes`, `emails`, `api_calls`).
 */
export interface UsageRecord {
  readonly tenant: string;
  readonly resource: string;
  readonly amount: number;
  readonly unit: string;
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/** Validates a candidate usage record. Amount must be finite and non-negative; tenant/resource/unit required. */
export function isValidUsageRecord(record: UsageRecord): boolean {
  return (
    record.tenant.trim().length > 0 &&
    record.resource.trim().length > 0 &&
    record.unit.trim().length > 0 &&
    Number.isFinite(record.amount) &&
    record.amount >= 0
  );
}

/** Normalises a usage record (trims keys, clones metadata) — the shape carried on the integration event. */
export function normalizeUsageRecord(record: UsageRecord): UsageRecord {
  return {
    tenant: record.tenant.trim(),
    resource: record.resource.trim(),
    amount: record.amount,
    unit: record.unit.trim(),
    occurredAt: record.occurredAt,
    metadata: { ...record.metadata },
  };
}
