import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paymob's transaction-callback signing scheme — NOT Stripe's. Source: Paymob developer docs,
 * "HMAC Transaction Callback" (`developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-
 * hmac/hmac/hmac-transaction-callback`, last updated 2026-06-01). The four steps it publishes:
 *
 *   1. take these 20 keys from the callback, IN THIS ORDER (spelled below relative to the
 *      callback's `obj`; the doc spells the transaction id `obj.id` and the order id `order.id`
 *      for the POST "Processed" callback, and `id` / `order_id` for the GET "Response" one);
 *   2. concatenate their VALUES with no separator;
 *   3. HMAC-SHA512 that string, keyed with the merchant's HMAC secret, hex-encoded;
 *   4. compare with the `hmac` query parameter the callback URL carries.
 *
 * Only the POST "Processed" callback (server-to-server, JSON body) is supported. The GET "Response"
 * callback is a browser redirect — client-side, spoofable by whoever holds the URL — and must never
 * drive a payment-state change, so it is deliberately not parsed here.
 *
 * The HMAC covers ONLY these 20 fields. Everything else in the body — including
 * `order.merchant_order_id` (our `special_reference`) and `payment_key_claims.extra` — is
 * unauthenticated. A caller correlating a webhook to one of our intents MUST use a signed field
 * (`order.id`) and never an unsigned one, or a valid callback for one payment could be replayed
 * against another. {@link extractSignedTransaction} therefore returns signed values only.
 */
export const PAYMOB_HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "obj.id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolves one signed field against the callback's `obj`. `obj.id` is `obj`'s own `id`. */
function resolve(obj: JsonObject, path: string): unknown {
  const segments = path === "obj.id" ? ["id"] : path.split(".");
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (!isObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/**
 * Renders one value the way Paymob's worked example does: booleans as `true`/`false`, numbers and
 * strings as-is. `null`, missing and structured values return `undefined`: the docs do not say how
 * Paymob renders them, so this refuses to guess — a callback with such a field is treated as
 * unverifiable (fail closed) rather than verified against an invented rendering.
 */
function render(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Step 2: the concatenation Paymob signs, or `undefined` if any signed field is absent/unrenderable. */
export function concatenateSignedFields(obj: JsonObject): string | undefined {
  let out = "";
  for (const path of PAYMOB_HMAC_FIELDS) {
    const rendered = render(resolve(obj, path));
    if (rendered === undefined) return undefined;
    out += rendered;
  }
  return out;
}

function parseTransaction(payload: Uint8Array): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (!isObject(parsed) || !isObject(parsed["obj"])) return null;
  return parsed["obj"];
}

export interface VerifyPaymobSignatureOptions {
  /** The callback's RAW request body bytes. */
  readonly payload: Uint8Array;
  /** The `hmac` query parameter (lower- or upper-case hex). */
  readonly signature: string;
  /** The merchant's HMAC secret from the Paymob dashboard. */
  readonly secret: string;
}

/**
 * Every rejection path returns `false` rather than throwing — `PaymentProvider.verifyWebhook`'s
 * contract is a boolean the webhook route turns into a 401 (same as `verifyStripeSignature`).
 * There is no timestamp/replay window: Paymob's scheme carries none. Replay safety is the
 * webhook use case's job (`RecordWebhook`'s processed-event store), keyed on the signed
 * transaction id.
 */
export function verifyPaymobSignature(options: VerifyPaymobSignatureOptions): boolean {
  if (options.secret.length === 0) return false;
  const obj = parseTransaction(options.payload);
  if (obj === null) return false;
  const signed = concatenateSignedFields(obj);
  if (signed === undefined) return false;

  const expected = createHmac("sha512", options.secret).update(signed).digest();
  // A SHA-512 digest is 64 bytes = 128 hex chars. Anything else (or non-hex) cannot match; reject
  // before `timingSafeEqual`, which throws on unequal-length buffers instead of returning false.
  if (!/^[0-9a-fA-F]{128}$/.test(options.signature)) return false;
  return timingSafeEqual(Buffer.from(options.signature, "hex"), expected);
}

/** The signed subset of a transaction callback — the only values safe to act on after verification. */
export interface SignedTransaction {
  /** Paymob's transaction id (`obj.id`) — the id refunds/voids/captures address. */
  readonly transactionId: string;
  /** Paymob's order id (`order.id`) — equals the `intention_order_id` returned at intention creation. */
  readonly orderId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly success: boolean;
  readonly pending: boolean;
  readonly isAuth: boolean;
  readonly isCapture: boolean;
  readonly isVoided: boolean;
  readonly isRefunded: boolean;
  readonly hasParentTransaction: boolean;
  readonly errorOccured: boolean;
}

/**
 * Extracts {@link SignedTransaction} from raw callback bytes, reading nothing outside the 20
 * signed fields. Returns `null` if the body is not a well-formed transaction callback. This does
 * NOT verify the signature — call {@link verifyPaymobSignature} on the same bytes first.
 */
export function extractSignedTransaction(payload: Uint8Array): SignedTransaction | null {
  const obj = parseTransaction(payload);
  if (obj === null) return null;
  const bool = (path: string): boolean | undefined => {
    const value = resolve(obj, path);
    return typeof value === "boolean" ? value : undefined;
  };
  const transactionId = resolve(obj, "obj.id");
  const orderId = resolve(obj, "order.id");
  const amountCents = resolve(obj, "amount_cents");
  const currency = resolve(obj, "currency");
  const flags = {
    success: bool("success"),
    pending: bool("pending"),
    isAuth: bool("is_auth"),
    isCapture: bool("is_capture"),
    isVoided: bool("is_voided"),
    isRefunded: bool("is_refunded"),
    hasParentTransaction: bool("has_parent_transaction"),
    errorOccured: bool("error_occured"),
  };
  if (
    (typeof transactionId !== "number" && typeof transactionId !== "string") ||
    (typeof orderId !== "number" && typeof orderId !== "string") ||
    typeof amountCents !== "number" ||
    typeof currency !== "string" ||
    Object.values(flags).some((flag) => flag === undefined)
  ) {
    return null;
  }
  return {
    transactionId: String(transactionId),
    orderId: String(orderId),
    amountCents,
    currency,
    ...(flags as Record<keyof typeof flags, boolean>),
  };
}
