/**
 * Wave 2b (D43): a store's own sending domain as the email provider sees it. Pure values; the
 * provider call itself is the `SenderDomainProvider` port.
 */

export const SENDER_DOMAIN_STATUSES = [
  "not_started",
  "pending",
  "verified",
  "failed",
  "temporary_failure",
] as const;

export type SenderDomainStatus = (typeof SENDER_DOMAIN_STATUSES)[number];

/** Only the exact word `verified` counts. Anything the provider adds later reads as still pending. */
export function normalizeDomainStatus(value: unknown): SenderDomainStatus {
  return typeof value === "string" && (SENDER_DOMAIN_STATUSES as readonly string[]).includes(value)
    ? (value as SenderDomainStatus)
    : "pending";
}

/** One DNS record the merchant has to add at their DNS host (DKIM / SPF / MX ...). */
export interface DnsRecord {
  /** The provider's label, e.g. `DKIM`, `SPF`, `Receiving`. */
  readonly record: string;
  readonly name: string;
  /** `TXT`, `MX`, `CNAME` ... */
  readonly type: string;
  readonly value: string;
  readonly ttl: string;
  readonly status: string;
  readonly priority: number | null;
}

/** A store's sending domain row (one per store in v1). */
export interface StoredSenderDomain {
  readonly domain: string;
  readonly providerDomainId: string;
  readonly status: SenderDomainStatus;
  readonly records: readonly DnsRecord[];
  readonly verifiedAt: Date | null;
}

/**
 * Another store already has this domain verified. Thrown by `SenderDomainRepository.save` when the
 * database refuses a second verified owner (partial unique index `sender_domains_verified_domain_key`).
 */
export class SenderDomainTakenError extends Error {
  constructor() {
    super("Another store has already verified this domain");
    this.name = "SenderDomainTakenError";
  }
}

const DOMAIN_PATTERN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function isValidDomainName(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain);
}

/** Reads records out of a provider response or a stored JSON column, dropping anything malformed. */
export function parseDnsRecords(value: unknown): readonly DnsRecord[] {
  if (!Array.isArray(value)) return [];
  const records: DnsRecord[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const name = row["name"];
    const type = row["type"];
    const recordValue = row["value"];
    if (typeof name !== "string" || typeof type !== "string" || typeof recordValue !== "string") {
      continue;
    }
    const ttl = row["ttl"];
    const priority = row["priority"];
    records.push({
      record: typeof row["record"] === "string" ? row["record"] : "",
      name,
      type,
      value: recordValue,
      ttl: typeof ttl === "string" || typeof ttl === "number" ? String(ttl) : "Auto",
      status: typeof row["status"] === "string" ? row["status"] : "not_started",
      priority: typeof priority === "number" ? priority : null,
    });
  }
  return records;
}
