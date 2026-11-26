import type { DnsRecord, SenderDomainStatus } from "../domain/messaging/sender-domain";

/** What the email provider knows about one domain. */
export interface ProviderDomain {
  readonly providerDomainId: string;
  readonly status: SenderDomainStatus;
  readonly records: readonly DnsRecord[];
}

/**
 * The email provider's domain API (Resend Domains, D43). `create` registers the domain and returns
 * the DNS records to add; `verify` asks the provider to check them (asynchronous: the answer comes
 * from a later `get`); `get` reads the current status. Every failure is a `SenderDomainProviderError`.
 */
export interface SenderDomainProvider {
  create(domain: string): Promise<ProviderDomain>;
  verify(providerDomainId: string): Promise<void>;
  get(providerDomainId: string): Promise<ProviderDomain>;
}

export type SenderDomainProviderFailure = "rejected" | "unavailable" | "timeout";

/**
 * A provider failure with a message that is safe to show: never the key, the provider's own text
 * or any part of its response.
 */
export class SenderDomainProviderError extends Error {
  readonly failure: SenderDomainProviderFailure;

  constructor(failure: SenderDomainProviderFailure, options: { cause?: unknown } = {}) {
    super(
      failure === "rejected"
        ? "The email provider didn't accept this request. Check the domain and try again."
        : "We couldn't reach the email provider. Try again in a moment.",
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "SenderDomainProviderError";
    this.failure = failure;
  }
}
