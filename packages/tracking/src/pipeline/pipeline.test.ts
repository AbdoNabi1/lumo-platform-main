import { describe, expect, it } from "vitest";

import {
  normalizeBirthDate,
  normalizeCountry,
  normalizeEmail,
  normalizeGender,
  normalizeIdentity,
  normalizeName,
  normalizePhone,
  normalizePostalCode,
} from "./normalization";
import {
  combineValidation,
  validateDeduplication,
  validateEnvelope,
  type ValidationResult,
} from "./validation";
import type { TrackingEnvelope } from "../envelope/envelope";
import { DENY_ALL_CONSENT } from "../envelope/consent";

function violationsOf(result: ValidationResult): readonly string[] {
  return result.valid ? [] : result.violations.map((v) => `${v.rule}:${v.field}`);
}

const NOW = new Date("2026-07-19T12:00:00.000Z");

function envelope(overrides: Partial<TrackingEnvelope> = {}): TrackingEnvelope {
  return {
    eventId: "01919d1e-0000-7000-8000-000000000001",
    eventName: "purchase",
    eventVersion: 1,
    timestamp: "2026-07-19T11:59:00.000Z",
    source: "web",
    consent: DENY_ALL_CONSENT,
    context: {},
    properties: {},
    tenancy: { tenantId: "t-1" },
    ...overrides,
  };
}

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ali@Example.COM ")).toBe("ali@example.com");
  });

  it("preserves dots and sub-addressing, which platforms match verbatim", () => {
    expect(normalizeEmail("a.b+tag@gmail.com")).toBe("a.b+tag@gmail.com");
  });

  it("drops values that cannot be an address rather than forwarding noise", () => {
    expect(normalizeEmail("not-an-email")).toBeUndefined();
    expect(normalizeEmail("a@b")).toBeUndefined();
    expect(normalizeEmail("   ")).toBeUndefined();
  });
});

describe("normalizePhone (E.164)", () => {
  it("strips separators from an international number", () => {
    expect(normalizePhone("+20 (100) 123-4567")).toBe("+201001234567");
  });

  it("upgrades a national number using the default country code, dropping the trunk prefix", () => {
    expect(normalizePhone("0100 123 4567", "20")).toBe("+201001234567");
    expect(normalizePhone("0100 123 4567", "+20")).toBe("+201001234567");
  });

  it("drops a national number when no country is known rather than guessing", () => {
    // A wrong country code produces a confident match against the wrong person.
    expect(normalizePhone("01001234567")).toBeUndefined();
  });

  it("rejects implausible lengths", () => {
    expect(normalizePhone("+1")).toBeUndefined();
    expect(normalizePhone(`+${"9".repeat(20)}`)).toBeUndefined();
  });
});

describe("field normalization", () => {
  it("strips punctuation and case from names and cities", () => {
    expect(normalizeName("  O'Brien-Smith ")).toBe("obriensmith");
    expect(normalizeName("Ahmed")).toBe("ahmed");
  });

  it("accepts only two-letter country codes", () => {
    expect(normalizeCountry("EG")).toBe("eg");
    expect(normalizeCountry("Egypt")).toBeUndefined();
  });

  it("truncates US ZIP+4 to five digits and passes other systems through", () => {
    expect(normalizePostalCode("12345-6789", "US")).toBe("12345");
    expect(normalizePostalCode("SW1A 1AA", "GB")).toBe("sw1a1aa");
    expect(normalizePostalCode("123", "US")).toBeUndefined();
  });

  it("reduces gender to m/f and drops anything ambiguous", () => {
    expect(normalizeGender("Male")).toBe("m");
    expect(normalizeGender("F")).toBe("f");
    expect(normalizeGender("prefer not to say")).toBeUndefined();
  });

  it("renders birth dates as YYYYMMDD and rejects impossible ones", () => {
    expect(normalizeBirthDate("1990-05-04")).toBe("19900504");
    expect(normalizeBirthDate("19900504")).toBe("19900504");
    expect(normalizeBirthDate("1990-13-04")).toBeUndefined();
    expect(normalizeBirthDate("90-05-04")).toBeUndefined();
  });
});

describe("normalizeIdentity", () => {
  it("canonicalises every matchable field and marks the block raw (pre-hash)", () => {
    const result = normalizeIdentity(
      {
        email: " Ali@Example.COM ",
        phone: "0100 123 4567",
        firstName: " Ahmed ",
        city: "New  York",
        country: "EG",
        postalCode: "12345-6789",
        customerId: "c-1",
      },
      { defaultCountryCode: "20" },
    );

    expect(result).toMatchObject({
      email: "ali@example.com",
      phone: "+201001234567",
      firstName: "ahmed",
      city: "newyork",
      country: "eg",
      hashStatus: "raw",
      customerId: "c-1",
    });
  });

  it("omits unnormalizable fields instead of passing them through dirty", () => {
    const result = normalizeIdentity({ email: "bad", gender: "unknown" });
    expect(result.email).toBeUndefined();
    expect(result.gender).toBeUndefined();
    expect("email" in result).toBe(false);
  });

  it("is idempotent — re-normalizing an already-clean block changes nothing", () => {
    const once = normalizeIdentity({ email: " A@B.com ", city: "Cairo" });
    expect(normalizeIdentity(once)).toEqual(once);
  });
});

describe("validateEnvelope", () => {
  it("accepts a well-formed envelope", () => {
    expect(validateEnvelope(envelope(), { now: NOW }).valid).toBe(true);
  });

  it("rejects a missing tenant (ADR-0008)", () => {
    const result = validateEnvelope(envelope({ tenancy: {} }), { now: NOW });
    expect(violationsOf(result)).toContain("tenancy:tenancy.tenantId");
  });

  it("rejects a non-snake_case event name", () => {
    const result = validateEnvelope(envelope({ eventName: "Purchase-Event" }), { now: NOW });
    expect(violationsOf(result)).toContain("schema:eventName");
  });

  it("rejects a future timestamp as a clock fault", () => {
    const result = validateEnvelope(envelope({ timestamp: "2026-07-19T12:30:00.000Z" }), {
      now: NOW,
    });
    expect(violationsOf(result)).toContain("timestamp:timestamp");
  });

  it("rejects a timestamp beyond the accepted past skew", () => {
    const result = validateEnvelope(envelope({ timestamp: "2026-07-17T12:00:00.000Z" }), {
      now: NOW,
    });
    expect(violationsOf(result)).toContain("timestamp:timestamp");
  });

  it("requires a currency whenever a value is present", () => {
    const result = validateEnvelope(envelope({ payload: { valueMinor: 1000 } }), { now: NOW });
    expect(violationsOf(result)).toContain("currency:payload.currency");
  });

  it("rejects a non-integer value and a malformed currency", () => {
    const result = validateEnvelope(envelope({ payload: { valueMinor: 10.5, currency: "usd" } }), {
      now: NOW,
    });
    expect(violationsOf(result)).toEqual(
      expect.arrayContaining(["value:payload.valueMinor", "currency:payload.currency"]),
    );
  });

  it("reports every violation at once rather than stopping at the first", () => {
    const result = validateEnvelope(
      envelope({ eventName: "Bad Name", eventVersion: 0, tenancy: {} }),
      { now: NOW },
    );
    expect(violationsOf(result).length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateDeduplication", () => {
  it("refuses delivery without a dedupId, which would double-count revenue", () => {
    expect(validateDeduplication(envelope()).valid).toBe(false);
    expect(validateDeduplication(envelope({ dedupId: "  " })).valid).toBe(false);
  });

  it("passes once a dedupId is present", () => {
    expect(validateDeduplication(envelope({ dedupId: "d-1" })).valid).toBe(true);
  });
});

describe("combineValidation", () => {
  it("preserves violations across stages", () => {
    const combined = combineValidation(
      validateEnvelope(envelope({ tenancy: {} }), { now: NOW }),
      validateDeduplication(envelope()),
    );
    expect(violationsOf(combined)).toEqual(
      expect.arrayContaining(["tenancy:tenancy.tenantId", "deduplication:dedupId"]),
    );
  });

  it("is valid only when every stage is valid", () => {
    expect(combineValidation({ valid: true }, { valid: true }).valid).toBe(true);
  });
});
