import { describe, expect, it } from "vitest";
import { applyFieldUpdate, createEmptyProfile, type CustomerProfile } from "./customer-profile";
import {
  mergeProfiles,
  profileCompleteness,
  profileConfidenceSummary,
  profileFieldSources,
  profileFreshness,
  staleFields,
} from "./profile-views";

const identifier = { type: "customer_id" as const, value: "cust-1" };
const other = { type: "email_hash" as const, value: "hash-1" };

describe("applyFieldUpdate", () => {
  it("appends a new field without mutating the input profile", () => {
    const profile = createEmptyProfile(
      identifier.type,
      identifier.value,
      "2026-07-21T00:00:00.000Z",
    );
    const result = applyFieldUpdate(profile, "email", {
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:01.000Z",
    });

    expect(result.applied).toBe(true);
    expect(profile.fields.size).toBe(0); // original untouched
    expect(result.profile.fields.size).toBe(1);
    expect(result.profile.fields.get("email")).toMatchObject({
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      version: 1,
    });
    expect(result.profile.version).toBe(1);
  });

  it("bumps the field's own version on a subsequent, fresher update to the same field", () => {
    const profile = createEmptyProfile(
      identifier.type,
      identifier.value,
      "2026-07-21T00:00:00.000Z",
    );
    const first = applyFieldUpdate(profile, "email", {
      value: "old@example.com",
      source: "orders",
      confidence: "inferred",
      occurredAt: "2026-07-21T00:00:01.000Z",
    });
    const second = applyFieldUpdate(first.profile, "email", {
      value: "new@example.com",
      source: "loyalty",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:02.000Z",
    });

    expect(second.applied).toBe(true);
    expect(second.profile.fields.get("email")).toMatchObject({
      value: "new@example.com",
      version: 2,
    });
    expect(second.profile.version).toBe(2);
  });

  it("rejects a stale update (occurredAt at or before the field's current updatedAt) as a no-op", () => {
    const profile = createEmptyProfile(
      identifier.type,
      identifier.value,
      "2026-07-21T00:00:00.000Z",
    );
    const first = applyFieldUpdate(profile, "email", {
      value: "current@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:05.000Z",
    });

    const stale = applyFieldUpdate(first.profile, "email", {
      value: "late-arriving@example.com",
      source: "loyalty",
      confidence: "inferred",
      occurredAt: "2026-07-21T00:00:03.000Z", // earlier than the stored fact
    });

    expect(stale.applied).toBe(false);
    expect(stale.profile).toBe(first.profile); // unchanged reference, not just unchanged value
    expect(stale.profile.fields.get("email")?.value).toBe("current@example.com");
  });

  it("never decreases the profile version across any sequence of applied updates", () => {
    let profile: CustomerProfile = createEmptyProfile(
      identifier.type,
      identifier.value,
      "2026-07-21T00:00:00.000Z",
    );
    const fieldNames = ["email", "phone", "name", "city"];
    let previousVersion = 0;

    for (let i = 0; i < 50; i += 1) {
      const field = fieldNames[i % fieldNames.length] as string;
      const occurredAt = new Date(Date.parse("2026-07-21T00:00:00.000Z") + i * 1000).toISOString();
      const result = applyFieldUpdate(profile, field, {
        value: `v${i}`,
        source: "test",
        confidence: i % 2 === 0 ? "verified" : "inferred",
        occurredAt,
      });
      expect(result.applied).toBe(true);
      expect(result.profile.version).toBeGreaterThanOrEqual(previousVersion);
      previousVersion = result.profile.version;
      profile = result.profile;
    }
  });
});

describe("mergeProfiles", () => {
  it("merging a profile with itself produces the same field set", () => {
    const base = createEmptyProfile(identifier.type, identifier.value, "2026-07-21T00:00:00.000Z");
    const withField = applyFieldUpdate(base, "email", {
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:01.000Z",
    }).profile;

    const merged = mergeProfiles(
      [withField, withField],
      identifier.type,
      identifier.value,
      "2026-07-21T00:00:02.000Z",
    );
    expect(merged.fields.size).toBe(1);
    expect(merged.fields.get("email")).toEqual(withField.fields.get("email"));
  });

  it("picks the higher field-level version when two members disagree on the same field", () => {
    const a = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "old@example.com",
        source: "orders",
        confidence: "inferred",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    let b = applyFieldUpdate(createEmptyProfile(other.type, other.value, "t0"), "email", {
      value: "mid@example.com",
      source: "orders",
      confidence: "inferred",
      occurredAt: "2026-07-21T00:00:02.000Z",
    }).profile;
    b = applyFieldUpdate(b, "email", {
      value: "newest@example.com",
      source: "loyalty",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:03.000Z",
    }).profile;

    const merged = mergeProfiles(
      [a, b],
      identifier.type,
      identifier.value,
      "2026-07-21T00:00:04.000Z",
    );
    expect(merged.fields.get("email")).toMatchObject({ value: "newest@example.com", version: 2 });
  });

  it("returns an empty profile for an empty input list rather than throwing", () => {
    const merged = mergeProfiles([], identifier.type, identifier.value, "2026-07-21T00:00:00.000Z");
    expect(merged.fields.size).toBe(0);
    expect(merged.version).toBe(0);
    expect(merged.updatedAt).toBe("2026-07-21T00:00:00.000Z");
  });
});

describe("profileCompleteness", () => {
  it("is vacuously complete (1) when no fields are expected", () => {
    const profile = createEmptyProfile(identifier.type, identifier.value, "t0");
    expect(profileCompleteness(profile, [])).toBe(1);
  });

  it("is the fraction of expected fields present", () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    expect(profileCompleteness(profile, ["email", "phone"])).toBe(0.5);
  });
});

describe("profileFreshness / staleFields", () => {
  it("reports zero age for a field updated exactly at now, and flags fields past the threshold", () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:00.000Z",
      },
    ).profile;

    const freshness = profileFreshness(profile, "2026-07-21T00:00:00.000Z");
    expect(freshness.get("email")).toBe(0);

    const later = profileFreshness(profile, "2026-07-21T01:00:00.000Z");
    expect(later.get("email")).toBe(60 * 60 * 1000);
    expect(staleFields(profile, "2026-07-21T01:00:00.000Z", 30 * 60 * 1000)).toEqual(["email"]);
    expect(staleFields(profile, "2026-07-21T01:00:00.000Z", 2 * 60 * 60 * 1000)).toEqual([]);
  });
});

describe("profileFieldSources", () => {
  it("maps each field to the source that asserted it", () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    expect(profileFieldSources(profile)).toEqual(new Map([["email", "orders"]]));
  });
});

describe("profileConfidenceSummary", () => {
  it("reports inferred (not verified) for an empty profile — no evidence is not the same as trusted", () => {
    const profile = createEmptyProfile(identifier.type, identifier.value, "t0");
    expect(profileConfidenceSummary(profile).overall).toBe("inferred");
  });

  it("is verified only when every field is verified (weakest-link, not strongest-evidence)", () => {
    let profile = createEmptyProfile(identifier.type, identifier.value, "t0");
    profile = applyFieldUpdate(profile, "email", {
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:01.000Z",
    }).profile;
    expect(profileConfidenceSummary(profile).overall).toBe("verified");

    profile = applyFieldUpdate(profile, "phone", {
      value: "555-0100",
      source: "enrichment",
      confidence: "inferred",
      occurredAt: "2026-07-21T00:00:02.000Z",
    }).profile;
    const summary = profileConfidenceSummary(profile);
    expect(summary.overall).toBe("inferred");
    expect(summary.verified).toBe(1);
    expect(summary.inferred).toBe(1);
  });
});
