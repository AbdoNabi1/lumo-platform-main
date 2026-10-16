import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paymob's CARD-TOKEN callback signing scheme — a DIFFERENT scheme from the transaction-processed
 * callback in `webhook-signature.ts`, under the same provider and the same HMAC secret. Source:
 * Paymob developer docs, "HMAC Card Token Callback"
 * (`developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-for-card-tokens`,
 * read 2026-09-24), which publishes a worked example this package pins in its tests:
 *
 *   1. take these 8 keys from the callback's `obj`, in LEXICOGRAPHICAL order (the transaction
 *      callback instead signs 20 fields in a fixed, non-alphabetical order);
 *   2. concatenate their VALUES with no separator;
 *   3. HMAC-SHA512 that string, keyed with the merchant's HMAC secret, hex-encoded;
 *   4. compare with the `hmac` query parameter the callback URL carries.
 *
 * Reusing `verifyPaymobSignature` for this callback would verify nothing: a token body has none of
 * that scheme's fields, so it can only ever fail closed — and a "fix" that loosened it to pass would
 * accept an attacker-supplied card token. The two verifiers are deliberately separate, and a test
 * proves each rejects a signature computed under the other.
 *
 * The HMAC covers ONLY these 8 fields. Everything else in the body (`user_added`, `cardholder_name`,
 * `expiry_*`, `next_payment_intention`, and `type`) is unauthenticated, so
 * {@link extractSignedCardToken} returns signed values only.
 */
export const PAYMOB_CARD_TOKEN_HMAC_FIELDS = [
  "card_subtype",
  "created_at",
  "email",
  "id",
  "masked_pan",
  "merchant_id",
  "order_id",
  "token",
] as const;

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strings and finite numbers are rendered as-is (the docs' example has numeric `id`/`merchant_id` and
 * string `order_id`). `null`, missing, boolean and structured values return `undefined`: the docs do
 * not say how Paymob renders them, so this refuses to guess and the callback fails closed.
 */
function render(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Step 2: the concatenation Paymob signs, or `undefined` if any signed field is absent/unrenderable. */
export function concatenateCardTokenFields(obj: JsonObject): string | undefined {
  let out = "";
  for (const field of PAYMOB_CARD_TOKEN_HMAC_FIELDS) {
    const rendered = render(obj[field]);
    if (rendered === undefined) return undefined;
    out += rendered;
  }
  return out;
}

/** The callback's `obj`, only if the body is a well-formed `{ "type": "TOKEN", "obj": {…} }`. */
function parseTokenCallback(payload: Uint8Array): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed["type"] !== "TOKEN" || !isObject(parsed["obj"])) return null;
  return parsed["obj"];
}

export interface VerifyPaymobCardTokenSignatureOptions {
  /** The callback's RAW request body bytes. */
  readonly payload: Uint8Array;
  /** The `hmac` query parameter (lower- or upper-case hex). */
  readonly signature: string;
  /** The HMAC secret of the Paymob account the token was issued under. */
  readonly secret: string;
}

/**
 * Every rejection path returns `false` rather than throwing. There is no timestamp/replay window:
 * Paymob's scheme carries none. Replay safety is the recording use case's job (a token id already
 * stored is a no-op), keyed on the signed token id.
 */
export function verifyPaymobCardTokenSignature(
  options: VerifyPaymobCardTokenSignatureOptions,
): boolean {
  if (options.secret.length === 0) return false;
  const obj = parseTokenCallback(options.payload);
  if (obj === null) return false;
  const signed = concatenateCardTokenFields(obj);
  if (signed === undefined) return false;

  const expected = createHmac("sha512", options.secret).update(signed).digest();
  // SHA-512 = 64 bytes = 128 hex chars; `timingSafeEqual` throws on unequal lengths, so reject first.
  if (!/^[0-9a-fA-F]{128}$/.test(options.signature)) return false;
  return timingSafeEqual(Buffer.from(options.signature, "hex"), expected);
}

/**
 * The signed subset of a card-token callback — the only values safe to act on after verification.
 * `token` is a SECRET (it charges the card): callers seal it immediately and never log it.
 */
export interface SignedCardToken {
  /** Paymob's card-token record id (`id`) — stable across redeliveries of the same callback. */
  readonly tokenId: string;
  readonly token: string;
  /** Paymob's order id — equals the `intention_order_id` returned when the intention was created. */
  readonly orderId: string;
  readonly maskedPan: string;
  readonly cardSubtype: string;
}

/**
 * Extracts {@link SignedCardToken} from raw callback bytes, reading nothing outside the 8 signed
 * fields. `null` if the body is not a well-formed token callback. This does NOT verify the signature
 * — call {@link verifyPaymobCardTokenSignature} on the same bytes first.
 */
export function extractSignedCardToken(payload: Uint8Array): SignedCardToken | null {
  const obj = parseTokenCallback(payload);
  if (obj === null) return null;
  const signed = concatenateCardTokenFields(obj);
  if (signed === undefined) return null;
  const token = render(obj["token"]);
  const orderId = render(obj["order_id"]);
  const tokenId = render(obj["id"]);
  const maskedPan = render(obj["masked_pan"]);
  const cardSubtype = render(obj["card_subtype"]);
  if (
    token === undefined ||
    token.length === 0 ||
    orderId === undefined ||
    orderId.length === 0 ||
    tokenId === undefined ||
    maskedPan === undefined ||
    cardSubtype === undefined
  ) {
    return null;
  }
  return { tokenId, token, orderId, maskedPan, cardSubtype };
}
