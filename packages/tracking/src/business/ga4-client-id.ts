/**
 * A deterministic stand-in GA4 `client_id` for a server event whose visitor has no `_ga` cookie (P2-D7).
 *
 * GA4's Measurement Protocol refuses a request without a `client_id`. A random one would split one visitor into a
 * new GA user on every event; a derived one is stable: the same seed (the visitor id, or for a visitor we do not
 * know the `ord_`/`lead_` business id) always yields the same id, different seeds yield different ids. The shape is
 * GA's own, `<10 digits>.<10 digits>`, so `GA1.1.<id>` would be a valid cookie value.
 *
 * It is a fallback only: a real `_ga` client id (from the snapshot or the visitor's profile) always wins, and the
 * synthetic one is never written into the envelope's browser ids, so it is never learned by a profile.
 */

import { sha256Bytes } from "./sha256";

const SPAN = BigInt(9_000_000_000); // 10-digit numbers: 1_000_000_000 .. 9_999_999_999
const BASE = BigInt(1_000_000_000);
const EIGHT = BigInt(8);

function tenDigits(bytes: Uint8Array, offset: number): string {
  let value = BigInt(0);
  for (let i = 0; i < 8; i += 1) value = (value << EIGHT) | BigInt(bytes[offset + i]!);
  return String(BASE + (value % SPAN));
}

export function syntheticGaClientId(seed: string): string {
  const digest = sha256Bytes(`ga4-client-id\u0000${seed}`);
  return `${tenDigits(digest, 0)}.${tenDigits(digest, 8)}`;
}
