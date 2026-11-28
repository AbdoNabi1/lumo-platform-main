import { describe, expect, it } from "vitest";
import {
  compileIpMatcher,
  formatCidr,
  ipPrefixKey,
  normalizeCidr,
  parseCidr,
  parseIp,
} from "./ip-cidr";

describe("parseIp", () => {
  it("parses IPv4 and IPv6", () => {
    expect(parseIp("203.0.113.7")).toEqual({ family: 4, value: 0xcb007107n });
    expect(parseIp("2001:db8::1")?.family).toBe(6);
    expect(parseIp("::1")?.family).toBe(6);
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(parseIp("::ffff:203.0.113.7")).toEqual(parseIp("203.0.113.7"));
    expect(parseIp("::ffff:cb00:7107")).toEqual(parseIp("203.0.113.7"));
  });

  it.each([
    "",
    "   ",
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4",
    "1.2.3.4:80",
    "abc",
    "2001:db8::1::2",
    "2001:db8:::1",
    "12345::1",
    "fe80::1%eth0",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    "::ffff:300.1.1.1",
  ])("rejects %j", (text) => {
    expect(parseIp(text)).toBeNull();
  });
});

describe("parseCidr / normalizeCidr", () => {
  it("clears host bits so one range has one spelling", () => {
    expect(normalizeCidr("203.0.113.77/24")).toBe("203.0.113.0/24");
    expect(normalizeCidr("203.0.113.0/24")).toBe("203.0.113.0/24");
    expect(normalizeCidr(" 203.0.113.0/24 ")).toBe("203.0.113.0/24");
  });

  it("takes a bare address as a single host", () => {
    expect(normalizeCidr("203.0.113.7")).toBe("203.0.113.7/32");
    expect(normalizeCidr("2001:db8::1")).toBe("2001:db8::1/128");
  });

  it("spells IPv6 canonically (RFC 5952) whatever the input spelling", () => {
    expect(normalizeCidr("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1/128");
    expect(normalizeCidr("2001:DB8::/32")).toBe("2001:db8::/32");
    expect(normalizeCidr("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1/128");
    expect(normalizeCidr("2001:db8::ffff:0:0:1/64")).toBe("2001:db8::/64");
  });

  it("holds one canonical spelling for an IPv4-mapped host", () => {
    expect(normalizeCidr("::ffff:203.0.113.7")).toBe("203.0.113.7/32");
  });

  it("refuses ranges wide enough to switch tracking off for a whole shop", () => {
    expect(normalizeCidr("0.0.0.0/0")).toBeNull();
    expect(normalizeCidr("10.0.0.0/8")).toBeNull();
    expect(normalizeCidr("::/0")).toBeNull();
    expect(normalizeCidr("2001:db8::/16")).toBeNull();
    expect(normalizeCidr("10.1.0.0/16")).toBe("10.1.0.0/16");
    expect(normalizeCidr("2001:db8::/32")).toBe("2001:db8::/32");
  });

  it.each(["203.0.113.0/33", "2001:db8::/129", "203.0.113.0/", "203.0.113.0/-1", "203.0.113.0/a"])(
    "rejects a bad prefix %j",
    (text) => {
      expect(parseCidr(text)).toBeNull();
    },
  );

  it("formats a parsed range back to the same text", () => {
    const parsed = parseCidr("198.51.100.0/22");
    expect(parsed === null ? null : formatCidr(parsed)).toBe("198.51.100.0/22");
  });
});

describe("compileIpMatcher", () => {
  const matches = compileIpMatcher(["203.0.113.0/24", "198.51.100.9", "2001:db8:abcd::/48"]);

  it("matches addresses inside a range, a host entry and an IPv6 range", () => {
    expect(matches("203.0.113.1")).toBe(true);
    expect(matches("203.0.113.254")).toBe(true);
    expect(matches("198.51.100.9")).toBe(true);
    expect(matches("2001:db8:abcd:1::5")).toBe(true);
  });

  it("does not match neighbours", () => {
    expect(matches("203.0.114.1")).toBe(false);
    expect(matches("203.0.112.255")).toBe(false);
    expect(matches("198.51.100.8")).toBe(false);
    expect(matches("2001:db8:abce::1")).toBe(false);
  });

  it("matches an IPv4 block when the visitor arrives IPv4-mapped", () => {
    expect(matches("::ffff:203.0.113.77")).toBe(true);
  });

  it("never matches across families, a missing address or garbage", () => {
    expect(matches(null)).toBe(false);
    expect(matches(undefined)).toBe(false);
    expect(matches("not-an-ip")).toBe(false);
    expect(compileIpMatcher(["203.0.113.0/24"])("2001:db8::1")).toBe(false);
  });

  it("an empty list blocks nothing, and a corrupt stored entry is skipped, not fatal", () => {
    expect(compileIpMatcher([])("203.0.113.1")).toBe(false);
    expect(compileIpMatcher(["garbage", "203.0.113.0/24"])("203.0.113.1")).toBe(true);
  });
});

describe("ipPrefixKey", () => {
  it("is the /24 of an IPv4 address and the /48 of an IPv6 address", () => {
    expect(ipPrefixKey("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefixKey("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd::/48");
    expect(ipPrefixKey("::ffff:203.0.113.77")).toBe("203.0.113.0/24");
  });

  it("is null for nothing usable", () => {
    expect(ipPrefixKey(undefined)).toBeNull();
    expect(ipPrefixKey("nope")).toBeNull();
  });
});
