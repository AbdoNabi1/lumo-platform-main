import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeFingerprintId, fingerprintKeyFor, type FingerprintInput } from "./fingerprint";

const hmac = (key: string, data: string): string =>
  createHmac("sha256", key).update(data).digest("hex");

const SECRET = "edge-secret-for-tests-".padEnd(40, "0");
const UA =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

const base: FingerprintInput = {
  secret: SECRET,
  tenantId: "tenant-a",
  ip: "203.0.113.20",
  userAgent: UA,
  host: "shop-a.example.com",
};

describe("computeFingerprintId", () => {
  it("is stable for the same store, address network, user agent and host", () => {
    const first = computeFingerprintId(hmac, base);
    expect(first).toMatch(/^[0-9a-f]{32}$/u);
    expect(computeFingerprintId(hmac, { ...base })).toBe(first);
  });

  it("is different across tenants, even for the identical device and host", () => {
    const a = computeFingerprintId(hmac, base);
    const b = computeFingerprintId(hmac, { ...base, tenantId: "tenant-b" });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    expect(fingerprintKeyFor(hmac, SECRET, "tenant-a")).not.toBe(
      fingerprintKeyFor(hmac, SECRET, "tenant-b"),
    );
  });

  it("is different under a different platform secret (it is keyed, not a bare hash)", () => {
    expect(computeFingerprintId(hmac, { ...base, secret: `${SECRET}-rotated` })).not.toBe(
      computeFingerprintId(hmac, base),
    );
  });

  it("is not a plain digest of the inputs anyone could recompute without the secret", () => {
    const id = computeFingerprintId(hmac, base) as string;
    const unkeyed = createHmac("sha256", "")
      .update(`203.0.113.0/24\u0000${UA}\u0000shop-a.example.com`)
      .digest("hex")
      .slice(0, 32);
    expect(id).not.toBe(unkeyed);
  });

  it("holds across the addresses of one /24 (a phone moving between towers) and splits across networks", () => {
    const a = computeFingerprintId(hmac, base);
    expect(computeFingerprintId(hmac, { ...base, ip: "203.0.113.201" })).toBe(a);
    expect(computeFingerprintId(hmac, { ...base, ip: "203.0.114.20" })).not.toBe(a);
  });

  it("uses the /48 for IPv6 and treats an IPv4-mapped address as the IPv4 one", () => {
    const v6 = computeFingerprintId(hmac, { ...base, ip: "2001:db8:abcd:1::7" });
    expect(computeFingerprintId(hmac, { ...base, ip: "2001:db8:abcd:99::1" })).toBe(v6);
    expect(computeFingerprintId(hmac, { ...base, ip: "2001:db8:abce:1::7" })).not.toBe(v6);
    expect(computeFingerprintId(hmac, { ...base, ip: "::ffff:203.0.113.77" })).toBe(
      computeFingerprintId(hmac, base),
    );
  });

  it("changes with the user agent and with the host", () => {
    const a = computeFingerprintId(hmac, base);
    expect(computeFingerprintId(hmac, { ...base, userAgent: `${UA} extra` })).not.toBe(a);
    expect(computeFingerprintId(hmac, { ...base, host: "other.example.com" })).not.toBe(a);
    expect(computeFingerprintId(hmac, { ...base, host: "SHOP-A.example.com" })).toBe(a);
  });

  it("is null rather than a weak id when there is no usable address or no user agent", () => {
    expect(computeFingerprintId(hmac, { ...base, ip: null })).toBeNull();
    expect(computeFingerprintId(hmac, { ...base, ip: "garbage" })).toBeNull();
    expect(computeFingerprintId(hmac, { ...base, userAgent: "  " })).toBeNull();
    expect(computeFingerprintId(hmac, { ...base, userAgent: undefined })).toBeNull();
  });
});
