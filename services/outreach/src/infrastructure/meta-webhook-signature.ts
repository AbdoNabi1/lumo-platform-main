import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify Meta's SHA-256 signature against the unmodified request bytes. */
export function verifyMetaSignature(
  rawBody: Uint8Array,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (header === undefined || !/^sha256=[a-fA-F0-9]{64}$/.test(header)) return false;
  const actual = Buffer.from(header.slice(7), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
