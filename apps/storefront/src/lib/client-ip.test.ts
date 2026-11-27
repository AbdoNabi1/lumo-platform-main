import { describe, expect, it } from "vitest";
import {
  clientIpFromForwardedFor,
  DEFAULT_TRUSTED_PROXIES,
  trustedClientIp,
  trustedProxyCount,
} from "./client-ip";

describe("clientIpFromForwardedFor — Railway (one trusted proxy)", () => {
  it("takes the right-most entry: the address the edge appended", () => {
    expect(clientIpFromForwardedFor("203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("ignores every spoofed value the visitor put to the left", () => {
    expect(clientIpFromForwardedFor("1.1.1.1, 8.8.8.8, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(clientIpFromForwardedFor("127.0.0.1,203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("never returns the left-most value when it differs from the edge's", () => {
    expect(clientIpFromForwardedFor("198.51.100.99, 203.0.113.7", 1)).not.toBe("198.51.100.99");
  });

  it("defaults to the Railway edge: one proxy", () => {
    expect(DEFAULT_TRUSTED_PROXIES).toBe(1);
    expect(clientIpFromForwardedFor("9.9.9.9, 203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("clientIpFromForwardedFor — other chains", () => {
  it("skips one more trusted hop per configured proxy (CDN in front of the edge)", () => {
    // forged, real client (written by the CDN), CDN (written by the edge)
    expect(clientIpFromForwardedFor("6.6.6.6, 203.0.113.7, 104.16.0.1", 2)).toBe("203.0.113.7");
    expect(clientIpFromForwardedFor("6.6.6.6, 203.0.113.7, 104.16.0.1", 3)).toBe("6.6.6.6");
  });

  it("with no trusted proxy the header is all client-controlled: no address", () => {
    expect(clientIpFromForwardedFor("203.0.113.7", 0)).toBeNull();
  });

  it("with fewer entries than proxies, uses the first (still written by one of ours)", () => {
    expect(clientIpFromForwardedFor("203.0.113.7", 3)).toBe("203.0.113.7");
  });

  it("null for an absent or empty header", () => {
    expect(clientIpFromForwardedFor(null, 1)).toBeNull();
    expect(clientIpFromForwardedFor(undefined, 1)).toBeNull();
    expect(clientIpFromForwardedFor("", 1)).toBeNull();
    expect(clientIpFromForwardedFor("203.0.113.7,", 1)).toBeNull();
  });
});

describe("clientIpFromForwardedFor — what counts as an address", () => {
  it("accepts IPv4, IPv6 (brackets and :port removed)", () => {
    expect(clientIpFromForwardedFor("203.0.113.7:51234", 1)).toBe("203.0.113.7");
    expect(clientIpFromForwardedFor("2001:db8::1", 1)).toBe("2001:db8::1");
    expect(clientIpFromForwardedFor("[2001:db8::1]:443", 1)).toBe("2001:db8::1");
    expect(clientIpFromForwardedFor("::ffff:203.0.113.7", 1)).toBe("::ffff:203.0.113.7");
    expect(clientIpFromForwardedFor("2001:0db8:0000:0000:0000:0000:0000:0001", 1)).toBe(
      "2001:0db8:0000:0000:0000:0000:0000:0001",
    );
  });

  it.each([
    "evil.example",
    "999.1.1.1",
    "1.2.3",
    "01.2.3.4",
    "1.2.3.4.5",
    "2001:db8::g",
    "2001:db8:::1",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "fe80::1%eth0",
    "<script>alert(1)</script>",
    "1.2.3.4; DROP TABLE",
    "a".repeat(200),
  ])("rejects %j", (value) => {
    expect(clientIpFromForwardedFor(value, 1)).toBeNull();
  });

  it("rejects an absurdly long chain instead of walking it", () => {
    expect(clientIpFromForwardedFor(Array(500).fill("1.1.1.1").join(","), 1)).toBeNull();
  });
});

describe("trustedProxyCount / trustedClientIp", () => {
  it("reads STOREFRONT_TRUSTED_PROXIES; anything unusable falls back to the Railway default", () => {
    expect(trustedProxyCount({})).toBe(1);
    expect(trustedProxyCount({ STOREFRONT_TRUSTED_PROXIES: "2" })).toBe(2);
    expect(trustedProxyCount({ STOREFRONT_TRUSTED_PROXIES: "0" })).toBe(0);
    expect(trustedProxyCount({ STOREFRONT_TRUSTED_PROXIES: " 3 " })).toBe(3);
    expect(trustedProxyCount({ STOREFRONT_TRUSTED_PROXIES: "-1" })).toBe(1);
    expect(trustedProxyCount({ STOREFRONT_TRUSTED_PROXIES: "many" })).toBe(1);
    expect(trustedProxyCount({ STOREFRONT_TRUSTED_PROXIES: "" })).toBe(1);
    expect(trustedProxyCount({ STOREFRONT_TRUSTED_PROXIES: "99" })).toBe(8);
  });

  it("applies the configured count to a request's headers", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 104.16.0.1" });
    expect(trustedClientIp(headers, {})).toBe("104.16.0.1");
    expect(trustedClientIp(headers, { STOREFRONT_TRUSTED_PROXIES: "2" })).toBe("203.0.113.7");
    expect(trustedClientIp(headers, { STOREFRONT_TRUSTED_PROXIES: "0" })).toBeNull();
    expect(trustedClientIp(new Headers(), {})).toBeNull();
  });
});
