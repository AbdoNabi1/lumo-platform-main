import {
  normalizeDomainStatus,
  parseDnsRecords,
  SenderDomainProviderError,
  type ProviderDomain,
  type SenderDomainProvider,
} from "@platform/notifications";

const DOMAINS_URL = "https://api.resend.com/domains";
const TIMEOUT_MS = 10_000;

/**
 * Wave 2b (D43): Resend's Domains API over plain HTTP (https://resend.com/docs/api-reference/domains).
 * Needs a FULL-ACCESS key (a sending-only key cannot manage domains). The key goes only into the
 * Authorization header; no failure carries the key, the request body or any part of the provider's
 * answer, so nothing here can leak into a log or a response.
 */
export class ResendSenderDomainProvider implements SenderDomainProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: { readonly apiKey: string; readonly fetchImpl?: typeof fetch }) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl;
  }

  async create(domain: string): Promise<ProviderDomain> {
    return this.toDomain(await this.call("POST", DOMAINS_URL, { name: domain }));
  }

  async verify(providerDomainId: string): Promise<void> {
    await this.call("POST", `${DOMAINS_URL}/${encodeURIComponent(providerDomainId)}/verify`);
  }

  async get(providerDomainId: string): Promise<ProviderDomain> {
    return this.toDomain(
      await this.call("GET", `${DOMAINS_URL}/${encodeURIComponent(providerDomainId)}`),
    );
  }

  private async call(method: "GET" | "POST", url: string, body?: unknown): Promise<unknown> {
    const doFetch = this.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // A hung provider must not hold the merchant's request open.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      // The cause is NOT attached: a fetch error can name the URL or headers.
      throw new SenderDomainProviderError(timedOut ? "timeout" : "unavailable");
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new SenderDomainProviderError(retryable ? "unavailable" : "rejected");
    }
    try {
      return await response.json();
    } catch {
      throw new SenderDomainProviderError("unavailable");
    }
  }

  private toDomain(payload: unknown): ProviderDomain {
    if (typeof payload !== "object" || payload === null) {
      throw new SenderDomainProviderError("unavailable");
    }
    const row = payload as Record<string, unknown>;
    const id = row["id"];
    if (typeof id !== "string" || id === "") throw new SenderDomainProviderError("unavailable");
    return {
      providerDomainId: id,
      status: normalizeDomainStatus(row["status"]),
      records: parseDnsRecords(row["records"]),
    };
  }
}
