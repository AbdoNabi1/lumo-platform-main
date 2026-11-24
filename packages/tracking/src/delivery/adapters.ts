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

const REDACTED = "[redacted]";
const MAX_VENDOR_RESPONSE_DEPTH = 8;
const MAX_VENDOR_RESPONSE_BYTES = 16 * 1024;

/** Every spelling a secret can take on its way through a URL, an error message or a JSON body. */
function secretNeedles(secret: string): readonly string[] {
  const forms = new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]);
  // Longest first, so a form that contains another is replaced whole.
  return [...forms].filter((form) => form !== "").sort((a, b) => b.length - a.length);
}

function redactString(value: string, needles: readonly string[]): string {
  let out = value;
  for (const needle of needles) out = out.split(needle).join(REDACTED);
  return out;
}

/**
 * Walks the **decoded** value and replaces every occurrence of each needle in strings, array items
 * and object keys and values. It never does string replacement over serialized JSON — that would
 * miss a secret split across an escape and could corrupt the structure.
 */
export function redactSecrets(value: unknown, needles: readonly string[]): unknown {
  const active = needles.filter((needle) => needle !== "");
  if (active.length === 0) return value;

  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === "string") return redactString(node, active);
    if (depth > MAX_VENDOR_RESPONSE_DEPTH + 1) return REDACTED;
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    if (typeof node === "object" && node !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(node)) {
        out[redactString(key, active)] = walk(inner, depth + 1);
      }
      return out;
    }
    return node;
  };

  return walk(value, 1);
}

/** Nesting depth of a decoded value; stops counting once it passes `limit`. */
function exceedsDepth(node: unknown, limit: number, depth = 1): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (depth > limit) return true;
  const children = Array.isArray(node) ? node : Object.values(node);
  return children.some((child) => exceedsDepth(child, limit, depth + 1));
}

/**
 * The vendor body that may be recorded: redacted, and dropped entirely (fail closed) when it is too
 * deep or too large to have been inspected with confidence.
 */
function safeVendorResponse(
  body: Readonly<Record<string, unknown>>,
  needles: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (needles.length === 0) return body;
  if (exceedsDepth(body, MAX_VENDOR_RESPONSE_DEPTH)) return undefined;

  const redacted = redactSecrets(body, needles) as Readonly<Record<string, unknown>>;
  // Bytes, not UTF-16 code units: a multibyte body is larger on the wire than `.length` says.
  const bytes = new TextEncoder().encode(JSON.stringify(redacted)).length;
  return bytes > MAX_VENDOR_RESPONSE_BYTES ? undefined : redacted;
}

/**
 * Recorded text for a failed attempt. When a credential was used nothing is derived from vendor or
 * transport text — it can carry the credential in a spelling no needle anticipates (JSON escapes,
 * encodings) — so only fixed, trusted diagnostics are kept. Vendor detail stays available through
 * the recursively sanitized decoded `vendorResponse`.
 */
function trustedHttpError(status: number): string {
  return `vendor responded ${String(status)}`;
}

function trustedTransportError(error: unknown, credential: string): string {
  const name = error instanceof Error ? error.name : "";
  const safe = /^[A-Za-z]{1,40}$/.test(name) && !name.includes(credential) ? name : "Error";
  return `transport error (${safe})`;
}

/** Appends `param=<secret>` to a URL; the result is local to the send and never recorded. */
function withQueryCredential(url: string, param: string, secret: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${param}=${encodeURIComponent(secret)}`;
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
    // The endpoint descriptor is never mutated: the authenticated URL exists only in this scope.
    let url = request.endpoint.url;

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

      const auth = request.endpoint.auth;
      if (auth?.kind === "query") {
        url = withQueryCredential(url, auth.param, resolved);
      } else if (auth?.kind === "header") {
        headers[auth.name] = resolved;
      } else {
        headers.authorization = `Bearer ${resolved}`;
      }
    }

    const needles = credential === undefined ? [] : secretNeedles(credential);

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
        url,
        method: request.endpoint.method,
        headers,
        body: JSON.stringify(request.payload),
        timeoutMs: request.endpoint.timeoutMs,
      });

      const ok = response.status >= 200 && response.status < 300;

      const vendorResponse =
        response.body === undefined ? undefined : safeVendorResponse(response.body, needles);

      return {
        ok,
        statusCode: response.status,
        retryable: !ok && isRetryableStatus(response.status),
        ...(ok
          ? {}
          : {
              error:
                credential === undefined
                  ? (response.error ?? `status ${String(response.status)}`)
                  : trustedHttpError(response.status),
            }),
        latencyMs: clock() - startedAt,
        ...(vendorResponse === undefined ? {} : { vendorResponse }),
      };
    } catch (error) {
      // A transport-level throw (DNS, socket, timeout) is transient by nature.
      return {
        ok: false,
        retryable: true,
        error:
          credential !== undefined
            ? trustedTransportError(error, credential)
            : error instanceof Error
              ? error.message
              : "transport error",
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
