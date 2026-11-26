import type { ProviderDomain, SenderDomainProvider } from "../application/sender-domain-ports";
import { SenderDomainProviderError } from "../application/sender-domain-ports";
import type { DnsRecord, SenderDomainStatus } from "../domain/messaging/sender-domain";

function recordsFor(domain: string): readonly DnsRecord[] {
  return [
    {
      record: "DKIM",
      name: `resend._domainkey.${domain}`,
      type: "TXT",
      value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ",
      ttl: "Auto",
      status: "not_started",
      priority: null,
    },
    {
      record: "SPF",
      name: `send.${domain}`,
      type: "MX",
      value: "feedback-smtp.us-east-1.amazonses.com",
      ttl: "Auto",
      status: "not_started",
      priority: 10,
    },
    {
      record: "SPF",
      name: `send.${domain}`,
      type: "TXT",
      value: "v=spf1 include:amazonses.com ~all",
      ttl: "Auto",
      status: "not_started",
      priority: null,
    },
  ];
}

/**
 * In-memory twin of the provider's Domains API for tests and offline wiring. Domains start
 * `not_started`; `verify` moves them to `pending`; a test calls `setStatus` to play the provider's
 * answer (`verified`, `failed` ...). `failNext` makes the next call throw a provider error.
 */
export class InMemorySenderDomainProvider implements SenderDomainProvider {
  private readonly domains = new Map<string, { domain: string; status: SenderDomainStatus }>();
  private failure: SenderDomainProviderError | null = null;
  private counter = 0;
  readonly calls: string[] = [];

  failNext(failure: "rejected" | "unavailable" | "timeout"): void {
    this.failure = new SenderDomainProviderError(failure);
  }

  setStatus(providerDomainId: string, status: SenderDomainStatus): void {
    const entry = this.domains.get(providerDomainId);
    if (entry !== undefined) entry.status = status;
  }

  /** Test helper: the provider id of a domain created here. */
  idOf(domain: string): string | undefined {
    return [...this.domains.entries()].find(([, entry]) => entry.domain === domain)?.[0];
  }

  create(domain: string): Promise<ProviderDomain> {
    this.calls.push(`create:${domain}`);
    const failed = this.takeFailure();
    if (failed !== null) return Promise.reject(failed);
    this.counter += 1;
    const providerDomainId = `dom_${this.counter}`;
    this.domains.set(providerDomainId, { domain, status: "not_started" });
    return Promise.resolve({
      providerDomainId,
      status: "not_started",
      records: recordsFor(domain),
    });
  }

  verify(providerDomainId: string): Promise<void> {
    this.calls.push(`verify:${providerDomainId}`);
    const failed = this.takeFailure();
    if (failed !== null) return Promise.reject(failed);
    const entry = this.domains.get(providerDomainId);
    if (entry === undefined) return Promise.reject(new SenderDomainProviderError("rejected"));
    if (entry.status === "not_started") entry.status = "pending";
    return Promise.resolve();
  }

  get(providerDomainId: string): Promise<ProviderDomain> {
    this.calls.push(`get:${providerDomainId}`);
    const failed = this.takeFailure();
    if (failed !== null) return Promise.reject(failed);
    const entry = this.domains.get(providerDomainId);
    if (entry === undefined) return Promise.reject(new SenderDomainProviderError("rejected"));
    return Promise.resolve({
      providerDomainId,
      status: entry.status,
      records: recordsFor(entry.domain).map((record) => ({
        ...record,
        status: entry.status === "verified" ? "verified" : "pending",
      })),
    });
  }

  private takeFailure(): SenderDomainProviderError | null {
    const failure = this.failure;
    this.failure = null;
    return failure;
  }
}
