import { timingSafeEqual, createHmac } from "node:crypto";

/**
 * Pure verification of Stripe's webhook signing scheme (`Stripe-Signature: t=<ts>,v1=<hex-hmac>`,
 * possibly several `v1=` entries during a secret rotation window). Split out from
 * `StripePaymentProvider` so the crypto itself is unit-testable without an HTTP layer (C2-2 Task 3/4).
 *
 * Every rejection path returns `false` rather than throwing — `PaymentProvider.verifyWebhook`'s
 * contract is a boolean answer the webhook route turns into a 401; a malformed header is exactly as
 * invalid as a wrong signature, not a distinct error class.
 */
export interface VerifyStripeSignatureOptions {
  readonly payload: Uint8Array;
  readonly signatureHeader: string;
  readonly secret: string;
  /** Replay-protection window in seconds (Stripe's own default is 300). */
  readonly toleranceSeconds?: number;
  /** Injectable for deterministic tests; defaults to the real clock. */
  readonly now?: () => number;
}

export function verifyStripeSignature(options: VerifyStripeSignatureOptions): boolean {
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const now = options.now ?? Date.now;

  const parsed = parseSignatureHeader(options.signatureHeader);
  if (parsed === null) return false;

  const nowSeconds = Math.floor(now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return false; // replay protection: signature too old (or clock-skewed into the future)
  }

  const expected = createHmac("sha256", options.secret)
    .update(`${parsed.timestamp}.`)
    .update(options.payload)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  // Stripe sends one `v1=` per active signing secret during a rotation window — a match against
  // ANY of them is valid. Every comparison is constant-time; a length mismatch is rejected without
  // ever calling `timingSafeEqual` (which throws on unequal-length buffers rather than returning false).
  return parsed.v1Signatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, "utf8");
    if (candidateBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}

interface ParsedSignatureHeader {
  readonly timestamp: number;
  readonly v1Signatures: readonly string[];
}

function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | null = null;
  const v1Signatures: string[] = [];

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === undefined || value === undefined) continue;
    if (key === "t") {
      const parsedTimestamp = Number.parseInt(value, 10);
      if (Number.isFinite(parsedTimestamp)) timestamp = parsedTimestamp;
    } else if (key === "v1") {
      v1Signatures.push(value);
    }
  }

  if (timestamp === null || v1Signatures.length === 0) return null;
  return { timestamp, v1Signatures };
}
