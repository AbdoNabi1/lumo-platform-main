import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { callingCodeForCurrency, DEFAULT_CALLING_CODE } from "./calling-code";
import { contentIdOf } from "./content-id";
import { businessMessageId } from "./event-uuid";
import { syntheticGaClientId } from "./ga4-client-id";
import { sha256Hex } from "./sha256";
import { businessValueMinor } from "./value";

const nodeSha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

describe("sha256Hex (pure, synchronous)", () => {
  it("matches node:crypto for empty, short, block-boundary, long and non-ASCII input", () => {
    expect.hasAssertions();
    const inputs = [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(65),
      "a".repeat(1000),
      "ord_0193a1b2-0000-7000-8000-000000000001",
      "مرحبا بالعالم — نسيج",
    ];
    for (const input of inputs) expect(sha256Hex(input)).toBe(nodeSha(input));
  });
});

describe("businessMessageId", () => {
  // The same algorithm `trackingMessageId` in apps/admin uses for the outbox row id and the inbox key.
  function adminCopy(tenantId: string, eventId: string): string {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      return eventId.toLowerCase();
    }
    const bytes = createHash("sha256")
      .update(`${tenantId}\u0000${eventId}`)
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  it("equals the admin trackingMessageId, is stable, and is tenant- and id-scoped", () => {
    expect.hasAssertions();
    const id = "ord_0193a1b2-0000-7000-8000-000000000001";
    expect(businessMessageId("t-1", id)).toBe(adminCopy("t-1", id));
    expect(businessMessageId("t-1", id)).toBe(businessMessageId("t-1", id));
    expect(businessMessageId("t-1", id)).not.toBe(businessMessageId("t-2", id));
    expect(businessMessageId("t-1", id)).not.toBe(businessMessageId("t-1", "ord_other"));
    expect(businessMessageId("t-1", id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("passes a UUID through lowercased", () => {
    expect.hasAssertions();
    const uuid = "0193A1B2-0000-7000-8000-000000000001";
    expect(businessMessageId("t-1", uuid)).toBe(uuid.toLowerCase());
  });
});

describe("contentIdOf", () => {
  it("is the variant when there is one, else the product (the catalog id browser pixels must match)", () => {
    expect.hasAssertions();
    expect(contentIdOf({ productRef: "prod-1", variantRef: "var-9" })).toBe("var-9");
    expect(contentIdOf({ productRef: "prod-1" })).toBe("prod-1");
    expect(contentIdOf({ productRef: "prod-1", variantRef: undefined })).toBe("prod-1");
    expect(contentIdOf({ productRef: "prod-1", variantRef: "  " })).toBe("prod-1");
  });
});

describe("businessValueMinor (P2-D4)", () => {
  it("is subtotal minus discount; shipping is never part of it", () => {
    expect.hasAssertions();
    expect(
      businessValueMinor({
        subtotalMinor: 100_000,
        discountMinor: 10_000,
        taxMinor: 0,
        shippingMinor: 5_000,
        taxIncluded: false,
      }),
    ).toBe(90_000);
  });

  it("does not subtract tax again: tax on top is never inside the subtotal, tax included is inside the price", () => {
    expect.hasAssertions();
    const base = { subtotalMinor: 114_000, discountMinor: 0, shippingMinor: 5_000 };
    const onTop = businessValueMinor({ ...base, taxMinor: 14_000, taxIncluded: false });
    const included = businessValueMinor({ ...base, taxMinor: 14_000, taxIncluded: true });
    expect(onTop).toBe(114_000);
    expect(included).toBe(114_000);
  });

  it("never goes below zero", () => {
    expect.hasAssertions();
    expect(
      businessValueMinor({
        subtotalMinor: 1_000,
        discountMinor: 5_000,
        taxMinor: 0,
        shippingMinor: 0,
        taxIncluded: false,
      }),
    ).toBe(0);
  });
});

describe("callingCodeForCurrency (P2-D7)", () => {
  it("maps the MENA currencies and defaults to Egypt", () => {
    expect.hasAssertions();
    const table: Record<string, string> = {
      EGP: "20",
      SAR: "966",
      AED: "971",
      KWD: "965",
      QAR: "974",
      BHD: "973",
      OMR: "968",
      JOD: "962",
    };
    for (const [currency, code] of Object.entries(table)) {
      expect(callingCodeForCurrency(currency)).toBe(code);
    }
    expect(callingCodeForCurrency("sar")).toBe("966");
    expect(callingCodeForCurrency("USD")).toBe(DEFAULT_CALLING_CODE);
    expect(callingCodeForCurrency(undefined)).toBe("20");
    expect(callingCodeForCurrency(null)).toBe("20");
  });
});

describe("syntheticGaClientId (P2-D7)", () => {
  it("is <10 digits>.<10 digits>, stable across calls and different per seed", () => {
    expect.hasAssertions();
    const a = syntheticGaClientId("visitor-a");
    expect(a).toMatch(/^[1-9]\d{9}\.[1-9]\d{9}$/);
    expect(syntheticGaClientId("visitor-a")).toBe(a);
    expect(syntheticGaClientId("visitor-b")).not.toBe(a);
    expect(syntheticGaClientId("ord_1")).toMatch(/^\d{10}\.\d{10}$/);
  });
});
