// @vitest-environment node
import { describe, expect, it } from "vitest";
import { signAccessCookie, verifyAccessCookie } from "./access-cookie";

const secret = "k".repeat(32);
const now = 1_800_000_000;

describe("unlock cookie (spec 1.5)", () => {
  it("is v1.<version>.<exp>.<base64url hmac> and verifies for the same shop, version and time", async () => {
    const value = await signAccessCookie({
      secret,
      shopId: "shop-a",
      accessVersion: 3,
      expUnix: now + 60,
    });
    expect(value).toMatch(/^v1\.3\.1800000060\.[A-Za-z0-9_-]{43}$/);
    expect(
      await verifyAccessCookie(value, { secret, shopId: "shop-a", accessVersion: 3, nowUnix: now }),
    ).toBe(true);
  });

  it("a cookie for shop A never verifies for shop B (Review Focus 2)", async () => {
    const value = await signAccessCookie({
      secret,
      shopId: "shop-a",
      accessVersion: 3,
      expUnix: now + 60,
    });
    expect(
      await verifyAccessCookie(value, { secret, shopId: "shop-b", accessVersion: 3, nowUnix: now }),
    ).toBe(false);
  });

  it("refuses expired, old-version, tampered, malformed, and any cookie without a usable secret", async () => {
    const value = await signAccessCookie({
      secret,
      shopId: "s",
      accessVersion: 3,
      expUnix: now + 60,
    });
    const ok = { secret, shopId: "s", accessVersion: 3, nowUnix: now };
    expect(await verifyAccessCookie(value, { ...ok, nowUnix: now + 61 })).toBe(false);
    expect(await verifyAccessCookie(value, { ...ok, accessVersion: 4 })).toBe(false);
    expect(
      await verifyAccessCookie(
        value.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
        ok,
      ),
    ).toBe(false);
    expect(
      await verifyAccessCookie(value.replace("v1.3.", "v1.4."), { ...ok, accessVersion: 4 }),
    ).toBe(false);
    for (const bad of [undefined, "", "v1", "v2.3.1.x", "v1.x.y.z", "v1.3.1800000060"]) {
      expect(await verifyAccessCookie(bad, ok)).toBe(false);
    }
    expect(await verifyAccessCookie(value, { ...ok, secret: null })).toBe(false);
    await expect(
      signAccessCookie({ secret: "short", shopId: "s", accessVersion: 1, expUnix: now }),
    ).rejects.toThrow();
  });

  it("refuses a cookie signed with another secret (forged)", async () => {
    const forged = await signAccessCookie({
      secret: "f".repeat(32),
      shopId: "s",
      accessVersion: 3,
      expUnix: now + 60,
    });
    expect(
      await verifyAccessCookie(forged, { secret, shopId: "s", accessVersion: 3, nowUnix: now }),
    ).toBe(false);
  });

  it("accepts only the one canonical spelling of a valid cookie (preflight 13)", async () => {
    const value = await signAccessCookie({
      secret,
      shopId: "s",
      accessVersion: 3,
      expUnix: now + 60,
    });
    const ok = { secret, shopId: "s", accessVersion: 3, nowUnix: now };
    const [, , exp, mac] = value.split(".");
    for (const variant of [
      `v1.03.${exp}.${mac}`, // leading zero: same number, other text
      `v1.3.0${exp}.${mac}`,
      `v1.3.${Number(exp) / 10}e1.${mac}`, // exponent form of the same number
      `v1.3.${exp}.${mac}=`, // padding
      `v1.3.${exp}.${mac}.x`, // extra part
      `v1.+3.${exp}.${mac}`,
      ` ${value}`,
    ]) {
      expect(await verifyAccessCookie(variant, ok), variant).toBe(false);
    }
    // Every other last character (the padding bits) is a different, refused text.
    const last = mac?.at(-1) ?? "";
    for (const c of "AEIMQUYcgkosw048") {
      if (c === last) continue;
      expect(await verifyAccessCookie(`${value.slice(0, -1)}${c}`, ok)).toBe(false);
    }
  });

  it("refuses a well-formed cookie whose signature is not 32 bytes", async () => {
    const ok = { secret, shopId: "s", accessVersion: 3, nowUnix: now };
    expect(await verifyAccessCookie(`v1.3.${now + 60}.AAAA`, ok)).toBe(false);
    expect(await verifyAccessCookie(`v1.3.${now + 60}.${"A".repeat(43)}`, ok)).toBe(false);
  });
});
