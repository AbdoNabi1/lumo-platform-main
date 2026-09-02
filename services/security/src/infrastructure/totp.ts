import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 §6 base32 encode, unpadded (standard authenticator-app secret representation). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/** Inverse of {@link base32Encode}. Case-insensitive; ignores `=` padding if present. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface TotpOptions {
  readonly digits?: number;
  readonly periodSeconds?: number;
}

/** RFC 4226 HOTP over HMAC-SHA1, dynamically truncated to `digits` decimal digits. */
function hotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const code = (binary % 10 ** digits).toString();
  return code.padStart(digits, "0");
}

/** RFC 6238 TOTP: HOTP over the time-step counter `floor(unixSeconds / periodSeconds)`. */
export function totp(secret: Buffer, unixSeconds: number, options: TotpOptions = {}): string {
  const digits = options.digits ?? 6;
  const period = options.periodSeconds ?? 30;
  const counter = Math.floor(unixSeconds / period);
  return hotp(secret, counter, digits);
}
