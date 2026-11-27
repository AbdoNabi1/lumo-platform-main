import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tracking P1-D3: how the storefront SERVER proves a `POST /public/tracking/collect` is its own.
 *
 * `x-mb-sig` = lowercase hex of HMAC-SHA256(TRACKING_EDGE_SECRET, `<x-mb-ts>.<raw body bytes>`), where
 * `x-mb-ts` is the signing time in whole Unix seconds. The signature covers the exact wire bytes
 * (`context.rawBody`), never a re-serialisation, and binds the timestamp so an old capture cannot be
 * replayed after the skew window. Inside the window a replay re-sends the same event id, which the
 * outbox (deterministic message id) and the ingest inbox collapse into one record.
 *
 * Mirrored by `apps/storefront/src/lib/tracking-edge.ts` (`signTrackingRequest`); both tests pin the
 * same construction, so the two cannot drift apart silently.
 */
export const EDGE_SIGNATURE_HEADER = "x-mb-sig";
export const EDGE_TIMESTAMP_HEADER = "x-mb-ts";
/** A request signed more than this long ago, or this far in the future, is refused. */
export const EDGE_MAX_SKEW_SECONDS = 300;

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const UNIX_SECONDS = /^\d{1,12}$/;

export function signEdgeRequest(
  secret: string,
  timestampSeconds: number,
  rawBody: Uint8Array | string,
): string {
  return createHmac("sha256", secret)
    .update(`${String(timestampSeconds)}.`)
    .update(rawBody)
    .digest("hex");
}

export type EdgeVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Counts-only diagnostics: never the signature, the secret or the body. */
      readonly reason: "missing" | "malformed_timestamp" | "skew" | "bad_signature";
    };

export interface VerifyEdgeInput {
  readonly secret: string;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly rawBody: Uint8Array | string;
  readonly nowMs: number;
}

export function verifyEdgeRequest(input: VerifyEdgeInput): EdgeVerdict {
  if (input.signature === undefined || input.timestamp === undefined) {
    return { ok: false, reason: "missing" };
  }
  if (!UNIX_SECONDS.test(input.timestamp)) return { ok: false, reason: "malformed_timestamp" };

  const timestamp = Number(input.timestamp);
  if (Math.abs(Math.floor(input.nowMs / 1000) - timestamp) > EDGE_MAX_SKEW_SECONDS) {
    return { ok: false, reason: "skew" };
  }

  // Length is checked first: `timingSafeEqual` throws on unequal lengths, and a signature that is
  // not 64 lowercase hex characters can never match anyway.
  if (!HEX_SHA256.test(input.signature)) return { ok: false, reason: "bad_signature" };

  const expected = Buffer.from(signEdgeRequest(input.secret, timestamp, input.rawBody), "hex");
  const presented = Buffer.from(input.signature, "hex");
  return timingSafeEqual(expected, presented)
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}
