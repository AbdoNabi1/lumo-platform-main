import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, totp } from "./totp";

describe("base32Encode / base32Decode", () => {
  // RFC 4648 §10 test vectors, unpadded.
  const vectors: readonly [string, string][] = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];

  it.each(vectors)("encodes %j to %j", (input, expected) => {
    expect(base32Encode(Buffer.from(input, "ascii"))).toBe(expected);
  });

  it.each(vectors)("decodes %j back to %j", (expected, input) => {
    expect(base32Decode(input).toString("ascii")).toBe(expected);
  });
});

describe("totp", () => {
  // RFC 6238 Appendix B test vectors (SHA1, 8-digit, secret = ASCII "12345678901234567890",
  // T0=0, step=30s). A 6-digit code is `code mod 10^6` — the low 6 digits of the 8-digit vector,
  // since truncation is `binary mod 10^Digit` and 10^6 divides 10^8.
  const secret = Buffer.from("12345678901234567890", "ascii");
  const vectors: readonly [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  it.each(vectors)("produces %s's known code at time %s", (time, expected) => {
    expect(totp(secret, time)).toBe(expected);
  });
});
