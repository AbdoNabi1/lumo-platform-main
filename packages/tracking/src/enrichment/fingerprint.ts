/**
 * The cookieless visitor id (Tracking P1-D8, gap A4): `HMAC-SHA256(per-store key, ip-network ‖ user agent ‖ host)`.
 *
 * It exists for one job — tying a server-side event that arrives with no visitor cookie (a lead saved from a form,
 * an order) back to the profile the same device produced a moment earlier — and it is the LAST thing identity
 * resolution tries, after customer id, email, phone and the visitor cookie (owner decision Q6).
 *
 * ## Properties that are deliberate
 *
 * - **Per store.** The key is derived from the platform secret AND the tenant id, so one device visiting two shops
 *   has two unrelated ids; an id from shop A can never match shop B, and leaking one shop's ids reveals nothing
 *   about another's.
 * - **Keyed, not hashed.** Without the secret an id cannot be recomputed from a guessed IP + UA, so the stored value
 *   is not a reversible fingerprint of anyone's address.
 * - **Coarse.** The address contributes only its network (IPv4 /24, IPv6 /48), so a phone that moves between
 *   towers of one carrier keeps its id — and, by the same token, so do the other phones of the same model on the
 *   same cell. That is why a match is only ever trusted when it is UNIQUE and RECENT (`profile-service.ts`), and why
 *   the id is never offered as an anonymous identity.
 *
 * `hmacSha256Hex` is injected (Node's `createHmac` in the runtime) so this module stays free of runtime globals.
 */

import { ipPrefixKey } from "./ip-cidr";

export type HmacSha256Hex = (key: string, data: string) => string;

/** Domain-separation labels: the per-store key and the id itself can never collide with another HMAC use. */
const KEY_LABEL = "morbeh-fingerprint-key-v1";
const ID_LABEL = "morbeh-fingerprint-id-v1";

export interface FingerprintInput {
  readonly secret: string;
  readonly tenantId: string;
  /** The trusted client IP (P1-D7); `null` ⇒ no id (an id from the UA alone would be one id per phone model). */
  readonly ip: string | null | undefined;
  readonly userAgent: string | null | undefined;
  /** The store's host (lower-cased by the caller or here). */
  readonly host: string | null | undefined;
}

/** The per-store key: `HMAC(secret, label ‖ tenant)`. Exported so a test can pin that two stores differ. */
export function fingerprintKeyFor(
  hmacSha256Hex: HmacSha256Hex,
  secret: string,
  tenantId: string,
): string {
  return hmacSha256Hex(secret, `${KEY_LABEL}\u0000${tenantId}`);
}

/**
 * The id, or `null` when it cannot be formed honestly (no usable IP or no user agent). 32 hex characters (128 bits):
 * long enough that a collision is the real-world shared-cell case and never chance.
 */
export function computeFingerprintId(
  hmacSha256Hex: HmacSha256Hex,
  input: FingerprintInput,
): string | null {
  const network = ipPrefixKey(input.ip);
  const userAgent = (input.userAgent ?? "").trim();
  if (network === null || userAgent === "") return null;
  const host = (input.host ?? "").trim().toLowerCase();
  const key = fingerprintKeyFor(hmacSha256Hex, input.secret, input.tenantId);
  return hmacSha256Hex(key, `${ID_LABEL}\u0000${network}\u0000${userAgent}\u0000${host}`).slice(
    0,
    32,
  );
}
