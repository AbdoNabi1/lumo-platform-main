import { describe, expect, it } from "vitest";
import { applyFieldUpdate, createEmptyProfile, type CustomerProfile } from "./customer-profile";
import { mergeProfiles, profileCompleteness, staleFields } from "./profile-views";

/**
 * Property-style tests over `domain/`'s pure functions. No property-testing library is a workspace
 * dependency (checked before adding one — none of the ~80 packages use one), so this hand-rolls the
 * same shape (seeded PRNG → many trials → assert an invariant, not a specific value) rather than
 * introducing a new devDependency for a handful of properties. Deterministic seed so a failure is
 * always reproducible from the printed seed, not a flake.
 */

const IDENTIFIER = { type: "customer_id" as const, value: "cust-prop" };
const FIELD_NAMES = ["email", "phone", "name", "city", "postal_code"] as const;
const SOURCES = ["orders", "loyalty", "reviews", "enrichment"] as const;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUpdateSequence(rng: () => number, count: number) {
  let cursorMs = Date.parse("2026-07-21T00:00:00.000Z");
  const updates: {
    field: string;
    occurredAt: string;
    confidence: "verified" | "inferred";
    source: string;
  }[] = [];
  for (let i = 0; i < count; i += 1) {
    cursorMs += Math.floor(rng() * 5000); // strictly non-decreasing wall clock
    updates.push({
      field: FIELD_NAMES[Math.floor(rng() * FIELD_NAMES.length)] as string,
      occurredAt: new Date(cursorMs).toISOString(),
      confidence: rng() < 0.5 ? "verified" : "inferred",
      source: SOURCES[Math.floor(rng() * SOURCES.length)] as string,
    });
  }
  return updates;
}

describe("CustomerProfile domain — property tests", () => {
  it("profile.version never decreases across any sequence of applied updates (50 random trials)", () => {
    for (let trial = 0; trial < 50; trial += 1) {
      const rng = mulberry32(trial + 1);
      let profile: CustomerProfile = createEmptyProfile(
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-21T00:00:00.000Z",
      );
      let previousVersion = 0;

      for (const update of randomUpdateSequence(rng, 30)) {
        const result = applyFieldUpdate(profile, update.field, {
          value: `value-${update.field}-${update.occurredAt}`,
          source: update.source,
          confidence: update.confidence,
          occurredAt: update.occurredAt,
        });
        // The clock in this generator is non-decreasing and each field's own updatedAt only ever
        // moves forward, so every update here is expected to apply — a `false` would itself be a
        // property violation worth failing loudly on (seed printed for reproduction).
        expect(result.applied, `trial ${trial} unexpectedly rejected an update`).toBe(true);
        expect(result.profile.version).toBeGreaterThanOrEqual(previousVersion);
        previousVersion = result.profile.version;
        profile = result.profile;
      }
    }
  });

  it("applyFieldUpdate never mutates its input profile, applied or not (40 random trials)", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const rng = mulberry32(trial + 1000);
      let profile: CustomerProfile = createEmptyProfile(
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-21T00:00:00.000Z",
      );

      for (const update of randomUpdateSequence(rng, 20)) {
        const beforeFieldCount = profile.fields.size;
        const beforeVersion = profile.version;
        const result = applyFieldUpdate(profile, update.field, {
          value: "x",
          source: update.source,
          confidence: update.confidence,
          occurredAt: update.occurredAt,
        });
        expect(profile.fields.size, `trial ${trial} mutated the input profile's field count`).toBe(
          beforeFieldCount,
        );
        expect(profile.version, `trial ${trial} mutated the input profile's version`).toBe(
          beforeVersion,
        );
        profile = result.profile;
      }
    }
  });

  it("mergeProfiles is idempotent under duplication: merging [p, p] equals merging [p] (30 random trials)", () => {
    for (let trial = 0; trial < 30; trial += 1) {
      const rng = mulberry32(trial + 2000);
      let profile: CustomerProfile = createEmptyProfile(
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-21T00:00:00.000Z",
      );
      for (const update of randomUpdateSequence(rng, 10)) {
        profile = applyFieldUpdate(profile, update.field, {
          value: "x",
          source: update.source,
          confidence: update.confidence,
          occurredAt: update.occurredAt,
        }).profile;
      }

      const once = mergeProfiles(
        [profile],
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-22T00:00:00.000Z",
      );
      const twice = mergeProfiles(
        [profile, profile],
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-22T00:00:00.000Z",
      );
      expect(twice.fields.size).toBe(once.fields.size);
      expect([...twice.fields.keys()].sort()).toEqual([...once.fields.keys()].sort());
      for (const [name, field] of once.fields) {
        expect(twice.fields.get(name)).toEqual(field);
      }
    }
  });

  it("profileCompleteness always stays within [0, 1] regardless of profile/expectation shape (40 random trials)", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const rng = mulberry32(trial + 3000);
      let profile: CustomerProfile = createEmptyProfile(
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-21T00:00:00.000Z",
      );
      for (const update of randomUpdateSequence(rng, Math.floor(rng() * 10))) {
        profile = applyFieldUpdate(profile, update.field, {
          value: "x",
          source: update.source,
          confidence: update.confidence,
          occurredAt: update.occurredAt,
        }).profile;
      }
      const expectedCount = Math.floor(rng() * 8);
      const expectedFields = Array.from({ length: expectedCount }, () => {
        const idx = Math.floor(rng() * FIELD_NAMES.length);
        return FIELD_NAMES[idx] as string;
      });

      const completeness = profileCompleteness(profile, expectedFields);
      expect(completeness).toBeGreaterThanOrEqual(0);
      expect(completeness).toBeLessThanOrEqual(1);
    }
  });

  it("staleFields is always a subset of the profile's own field names (30 random trials)", () => {
    for (let trial = 0; trial < 30; trial += 1) {
      const rng = mulberry32(trial + 4000);
      let profile: CustomerProfile = createEmptyProfile(
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-21T00:00:00.000Z",
      );
      for (const update of randomUpdateSequence(rng, 15)) {
        profile = applyFieldUpdate(profile, update.field, {
          value: "x",
          source: update.source,
          confidence: update.confidence,
          occurredAt: update.occurredAt,
        }).profile;
      }
      const now = new Date(
        Date.parse(profile.updatedAt) + Math.floor(rng() * 1_000_000),
      ).toISOString();
      const stale = staleFields(profile, now, Math.floor(rng() * 500_000));
      for (const name of stale) {
        expect(profile.fields.has(name)).toBe(true);
      }
    }
  });
});
