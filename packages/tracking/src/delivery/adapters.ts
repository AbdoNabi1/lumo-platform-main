/**
 * Destination adapters (directive §Destination Adapters).
 *
 * There is **one** adapter per *transport*, not per platform. Meta, Google, TikTok, Snap,
 * Pinterest, LinkedIn, Microsoft and X all speak CAPI-shaped HTTP/JSON, so all nine are served by
 * `HttpJsonAdapter` plus their own mapping profile and endpoint descriptor — configuration, not
 * code. That is what makes "no platform-specific code inside the Event Engine" literally true
 * rather than aspirational.
 *
 * The adapter performs no I/O itself: it delegates to an injected `HttpTransportPort`, so the
 * package stays browser- and server-compatible and every adapter is testable without a network.
 */

import type {
  DeliveryRequest,
  DeliveryResponse,
  DestinationAdapter,
  DestinationTransport,
} from "./destination";
import { findTransportMetadata, type TransportEnvelopeFactory } from "./transport-envelope";

/** Minimal HTTP surface. The concrete client (fetch/undici) is wired at the composition root. */
export interface HttpTransportPort {
  send(input: {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly timeoutMs: number;
  }): Promise<{
    readonly status: number;
    readonly body?: Readonly<Record<string, unknown>>;
    readonly error?: string;
  }>;
}

/** Resolves a Vault reference to a credential. Secrets are never held in a definition. */
export interface CredentialResolverPort {
  resolve(ref: string): Promise<string | null>;
}

/**
 * HTTP status codes worth retrying. 429 and 5xx are transient; 4xx (bad payload, revoked token,
 * unknown pixel) will fail identically forever, so retrying them only burns rate limit and delays
 * the dead-letter a human must act on.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export interface HttpJsonAdapterDeps {
  readonly http: HttpTransportPort;
  readonly credentials?: CredentialResolverPort;
  /**
   * Mints the per-request transport envelope. Supplied for vendors needing request ids, nonces or
   * signatures; omitted, only the credential header is generated.
   */
  readonly envelopes?: TransportEnvelopeFactory;
  readonly now?: () => number;
}

/** The generic CAPI-shaped adapter every HTTP/JSON destination uses. */
export class HttpJsonAdapter implements DestinationAdapter {
  readonly transport: DestinationTransport = "http_json";

  constructor(private readonly deps: HttpJsonAdapterDeps) {}

  async send(request: DeliveryRequest): Promise<DeliveryResponse> {
    const clock = this.deps.now ?? ((): number => Date.now());
    const startedAt = clock();

    // Defence in depth: a payload carrying transport metadata means something stored a credential
    // or a nonce as if it were business data. Refuse rather than transmit it — non-retryable,
    // because the payload will be just as wrong on the next attempt.
    const contraband = findTransportMetadata(request.payload);
    if (contraband.length > 0) {
      return {
        ok: false,
        retryable: false,
        error: `payload carries transport metadata: ${contraband.join(",")}`,
        latencyMs: clock() - startedAt,
      };
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...request.endpoint.headers,
    };

    let credential: string | undefined;

    if (request.endpoint.credentialRef !== undefined) {
      const resolved = await this.deps.credentials?.resolve(request.endpoint.credentialRef);

      // A missing credential is NOT retryable: retrying cannot conjure one, and the attempt would
      // otherwise be sent unauthenticated.
      if (resolved === null || resolved === undefined) {
        return {
          ok: false,
          retryable: false,
          error: `credential ${request.endpoint.credentialRef} unresolved`,
          latencyMs: clock() - startedAt,
        };
      }
      credential = resolved;
      headers.authorization = `Bearer ${resolved}`;
    }

    // The transport envelope is minted here, per attempt — never read from storage. This is what
    // makes "historical business payload, freshly generated transport envelope" structural.
    const envelope = this.deps.envelopes?.create({
      destination: request.destination,
      eventId: request.eventId,
      ...(credential === undefined ? {} : { credential }),
    });

    if (envelope !== undefined) {
      Object.assign(headers, envelope.headers);
    }

    try {
      const response = await this.deps.http.send({
        url: request.endpoint.url,
        method: request.endpoint.method,
        headers,
        body: JSON.stringify(request.payload),
        timeoutMs: request.endpoint.timeoutMs,
      });

      const ok = response.status >= 200 && response.status < 300;

      return {
        ok,
        statusCode: response.status,
        retryable: !ok && isRetryableStatus(response.status),
        ...(ok ? {} : { error: response.error ?? `status ${String(response.status)}` }),
        latencyMs: clock() - startedAt,
        ...(response.body === undefined ? {} : { vendorResponse: response.body }),
      };
    } catch (error) {
      // A transport-level throw (DNS, socket, timeout) is transient by nature.
      return {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : "transport error",
        latencyMs: clock() - startedAt,
      };
    }
  }
}

/**
 * A no-op adapter used for dry runs and for a destination that is registered but intentionally not
 * transmitting. It reports success without contacting anyone, which keeps "disabled" observable in
 * the pipeline rather than silently absent.
 */
export class NoopAdapter implements DestinationAdapter {
  readonly transport: DestinationTransport = "noop";

  send(_request: DeliveryRequest): Promise<DeliveryResponse> {
    return Promise.resolve({ ok: true, retryable: false, latencyMs: 0, statusCode: 204 });
  }
}
