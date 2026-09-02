/**
 * Production adapters for `@platform/tracking` (M6.2).
 *
 * The tracking package defines ports and stays free of I/O so it runs unchanged in a browser, in
 * Node and at the edge. Every port it declares is bound here, once, to a real implementation. Test
 * doubles live in unit tests and nowhere else — in particular, none of these are optional at the
 * composition root: a missing hasher or version resolver would degrade silently into unverifiable
 * records rather than failing the boot, and an unverifiable record is indistinguishable from a
 * corrupted one at replay time.
 */

import { createHash } from "node:crypto";

import type { SecretProvider } from "@platform/secrets";
import type {
  HashPort,
  HttpTransportPort,
  CredentialResolverPort,
  TransportEnvelope,
  TransportEnvelopeFactory,
} from "@platform/tracking";
import type { IdGenerator } from "@platform/contracts";

/**
 * SHA-256 over UTF-8, lowercase hex.
 *
 * Uses `node:crypto` rather than WebCrypto because it is synchronous under the hood and this is on
 * the per-event hot path — every event digests its payload once per destination.
 */
export class NodeHashPort implements HashPort {
  sha256Hex(input: string): Promise<string> {
    return Promise.resolve(createHash("sha256").update(input, "utf8").digest("hex"));
  }
}

// `VersionResolverPort` is served by `TrackingRegistrySnapshot` (M6.6.2), from the same loaded
// registry that serves the definitions themselves. A separate resolver used to live here, reading
// versions through its own interface; it was removed rather than kept, because two independent
// paths to "which version is current" are two answers that can disagree, and the record would then
// pin a version that did not produce its payload.

/**
 * Resolves `vault://` credential references to values.
 *
 * Definitions hold references, never secrets, so a destination configuration is safe to log, export
 * and store in the registry. Resolution happens per attempt and the value is never written to the
 * event record.
 */
export class SecretCredentialResolver implements CredentialResolverPort {
  constructor(private readonly secrets: SecretProvider) {}

  /** Strips the `vault://` scheme; anything else is passed through as a bare key. */
  private static toKey(ref: string): string {
    return ref.startsWith("vault://") ? ref.slice("vault://".length) : ref;
  }

  resolve(ref: string): Promise<string | null> {
    const value = this.secrets.get(SecretCredentialResolver.toKey(ref));
    return Promise.resolve(value === undefined || value === "" ? null : value);
  }

  /**
   * Whether a credential still resolves — checked at replay **plan** time so a revoked credential
   * shows up in the dry run rather than as a wave of delivery failures an operator has to diagnose
   * mid-recovery.
   */
  isAvailable(ref: string): boolean {
    const value = this.secrets.get(SecretCredentialResolver.toKey(ref));
    return value !== undefined && value !== "";
  }
}

/**
 * Mints the per-request transport envelope.
 *
 * Called immediately before **every** transmission, including every retry and every replay, and its
 * output is never persisted. This is the concrete half of the guarantee "historical business
 * payload, freshly generated transport envelope": a replayed event carries a request id and
 * timestamp minted now, not the ones from months ago that a vendor's replay protection would reject.
 */
export class RuntimeTransportEnvelopeFactory implements TransportEnvelopeFactory {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly now: () => number = () => Date.now(),
  ) {}

  create(input: { destination: string; eventId: string; credential?: string }): TransportEnvelope {
    const requestId = this.idGenerator.generate();
    const sentAtMs = this.now();

    return {
      requestId,
      sentAtMs,
      headers: {
        "x-request-id": requestId,
        // Vendors that reject stale requests read this; it must be minted per attempt, so it is
        // deliberately derived from the clock here rather than from anything on the record.
        "x-request-timestamp": String(sentAtMs),
        "x-destination": input.destination,
      },
    };
  }
}

/**
 * `fetch`-backed HTTP transport.
 *
 * Deliberately **not** built on the Security context's `JsonHttpClient`: that client throws
 * `HttpError` on any non-2xx response, but tracking's retry policy is driven by the status code
 * (429/5xx retryable, 4xx permanent). Reconstructing a status from a thrown error to decide
 * retryability would be strictly worse than reading it directly, so this returns the status rather
 * than throwing on it. Genuine transport failures (DNS, socket, timeout) still surface as errors,
 * which the adapter treats as retryable.
 */
export class FetchHttpTransport implements HttpTransportPort {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(input: {
    url: string;
    method: string;
    headers: Readonly<Record<string, string>>;
    body?: string;
    timeoutMs: number;
  }): Promise<{ status: number; body?: Readonly<Record<string, unknown>>; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => void controller.abort(), input.timeoutMs);

    try {
      const response = await this.fetchImpl(input.url, {
        method: input.method,
        headers: { ...input.headers },
        ...(input.body === undefined ? {} : { body: input.body }),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: Readonly<Record<string, unknown>> | undefined;

      try {
        const value: unknown = text === "" ? {} : JSON.parse(text);
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>;
        }
      } catch {
        // A non-JSON body is not a transport failure — the status still decides the outcome, and
        // the body is only diagnostic. Swallowing the parse error here loses nothing.
        parsed = undefined;
      }

      return {
        status: response.status,
        ...(parsed === undefined ? {} : { body: parsed }),
        ...(response.ok ? {} : { error: text.slice(0, 200) }),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
