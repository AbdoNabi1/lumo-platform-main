/**
 * The business/transport split (M5 amendment 1).
 *
 * A stored event carries an **immutable business payload** — what happened, in the vendor's
 * vocabulary. It must never carry **transport metadata** — how a particular HTTP request was
 * authenticated and identified. The two have opposite lifetimes:
 *
 * | | Business payload | Transport envelope |
 * |---|---|---|
 * | Lifetime | permanent | one request |
 * | On replay | reused verbatim | **regenerated** |
 * | Stored | yes | never |
 *
 * The replay guarantee is therefore: **historical business payload, freshly generated transport
 * envelope.** Replaying a stored bearer token would send a credential that is very likely revoked,
 * and replaying a stored signature or nonce would be rejected outright by any vendor doing replay
 * protection — so a "perfectly deterministic" replay that reused them would fail 100% of the time.
 *
 * ## The one subtlety
 *
 * `event_time` is **business**, not transport: it is when the customer acted, and it must survive
 * replay unchanged or the conversion lands in the wrong attribution window. A *request* timestamp
 * is transport and is regenerated. Confusing the two silently corrupts attribution, so they are
 * classified explicitly below rather than pattern-matched on the word "time".
 */

/**
 * Keys that must never appear in a stored business payload. Matched case-insensitively against
 * every key at every depth.
 */
export const TRANSPORT_METADATA_KEYS: readonly string[] = [
  "authorization",
  "access_token",
  "accesstoken",
  "api_secret",
  "apisecret",
  "bearer",
  "signature",
  "hmac",
  "nonce",
  "request_id",
  "requestid",
  "correlation_id",
  "correlationid",
  "idempotency_key",
  "sent_at",
  "sentat",
  "request_timestamp",
  "requesttimestamp",
];

/**
 * Business-semantic keys that superficially resemble transport metadata but must be preserved.
 * Checked first, so an allow-listed key is never stripped.
 */
export const BUSINESS_TIME_KEYS: readonly string[] = [
  "event_time",
  "eventtime",
  "event_timestamp",
  "timestamp_micros",
  "occurred_at",
];

function isBusinessKey(key: string): boolean {
  return BUSINESS_TIME_KEYS.includes(key.toLowerCase());
}

function isTransportKey(key: string): boolean {
  return TRANSPORT_METADATA_KEYS.includes(key.toLowerCase());
}

export interface BusinessPayloadResult {
  readonly payload: Readonly<Record<string, unknown>>;
  /** Dot-paths removed, recorded so stripping is visible in the inspector rather than silent. */
  readonly stripped: readonly string[];
}

/**
 * Strips transport metadata from a payload before it is stored.
 *
 * Applied at record time, not replay time: the stored artefact is clean by construction, so a
 * replay cannot resurrect a credential that was never persisted in the first place.
 */
export function toBusinessPayload(
  payload: Readonly<Record<string, unknown>>,
): BusinessPayloadResult {
  const stripped: string[] = [];

  function walk(node: Readonly<Record<string, unknown>>, path: string): Record<string, unknown> {
    const clean: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node)) {
      const here = path === "" ? key : `${path}.${key}`;

      if (!isBusinessKey(key) && isTransportKey(key)) {
        stripped.push(here);
        continue;
      }

      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        clean[key] = walk(value as Record<string, unknown>, here);
        continue;
      }

      clean[key] = value;
    }

    return clean;
  }

  return { payload: walk(payload, ""), stripped };
}

/** Transport-metadata paths present in a payload. Empty means the payload is storable as-is. */
export function findTransportMetadata(
  payload: Readonly<Record<string, unknown>>,
): readonly string[] {
  return toBusinessPayload(payload).stripped;
}

/** True when a payload is safe to persist as an immutable business artefact. */
export function isBusinessPayloadClean(payload: Readonly<Record<string, unknown>>): boolean {
  return findTransportMetadata(payload).length === 0;
}

/**
 * The per-request envelope. Regenerated immediately before every transmission — including every
 * retry and every replay — and never stored.
 */
export interface TransportEnvelope {
  readonly requestId: string;
  readonly sentAtMs: number;
  readonly nonce?: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Mints a fresh envelope. Injected at the composition root so tests are deterministic and so a
 * future vendor needing HMAC signing can supply it without touching the adapter.
 */
export interface TransportEnvelopeFactory {
  create(input: {
    readonly destination: string;
    readonly eventId: string;
    readonly credential?: string;
  }): TransportEnvelope;
}
