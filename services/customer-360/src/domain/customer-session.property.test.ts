import { describe, expect, it } from "vitest";
import { openSession, recordActivity, type CustomerSession } from "./customer-session";

/**
 * Property-style tests over `domain/`'s pure session functions — same hand-rolled seeded-PRNG shape
 * `customer-profile.property.test.ts` already established for this package (no property-testing
 * library is a workspace dependency).
 */
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

function randomActivityTimestamps(rng: () => number, count: number): string[] {
  let cursorMs = Date.parse("2026-07-21T00:00:00.000Z");
  const stamps: string[] = [];
  for (let i = 0; i < count; i += 1) {
    cursorMs += Math.floor(rng() * 5000); // strictly non-decreasing wall clock
    stamps.push(new Date(cursorMs).toISOString());
  }
  return stamps;
}

describe("CustomerSession domain — property tests", () => {
  it("version and pageCount never decrease across any sequence of applied activity (50 trials)", () => {
    for (let trial = 0; trial < 50; trial += 1) {
      const rng = mulberry32(trial + 1);
      let session: CustomerSession = openSession({
        sessionId: "sess-prop",
        visitorId: "visitor-prop",
        startedAt: "2026-07-21T00:00:00.000Z",
      });
      let previousVersion = session.version;
      let previousPageCount = session.pageCount;

      for (const occurredAt of randomActivityTimestamps(rng, 30)) {
        const result = recordActivity(session, occurredAt);
        // The generator's clock is non-decreasing, so every call here is expected to apply.
        expect(result.applied, `trial ${trial} unexpectedly rejected an activity`).toBe(true);
        expect(result.session.version).toBeGreaterThanOrEqual(previousVersion);
        expect(result.session.pageCount).toBeGreaterThanOrEqual(previousPageCount);
        previousVersion = result.session.version;
        previousPageCount = result.session.pageCount;
        session = result.session;
      }
    }
  });

  it("recordActivity never mutates its input session, applied or not (40 trials)", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const rng = mulberry32(trial + 1000);
      let session: CustomerSession = openSession({
        sessionId: "sess-prop",
        visitorId: "visitor-prop",
        startedAt: "2026-07-21T00:00:00.000Z",
      });

      for (const occurredAt of randomActivityTimestamps(rng, 20)) {
        const beforeVersion = session.version;
        const beforePageCount = session.pageCount;
        const result = recordActivity(session, occurredAt);
        expect(session.version, `trial ${trial} mutated the input session's version`).toBe(
          beforeVersion,
        );
        expect(session.pageCount, `trial ${trial} mutated the input session's pageCount`).toBe(
          beforePageCount,
        );
        session = result.session;
      }
    }
  });

  it("lastActivityAt never moves backwards regardless of out-of-order input (40 trials)", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const rng = mulberry32(trial + 2000);
      let session: CustomerSession = openSession({
        sessionId: "sess-prop",
        visitorId: "visitor-prop",
        startedAt: "2026-07-21T00:00:00.000Z",
      });

      // Mix forward and backward jumps — some out of order, testing the freshness guard holds.
      const timestamps = randomActivityTimestamps(rng, 20).flatMap((stamp, i) =>
        i % 3 === 0 ? [stamp, "2026-07-20T00:00:00.000Z"] : [stamp],
      );

      for (const occurredAt of timestamps) {
        const before = session.lastActivityAt;
        const result = recordActivity(session, occurredAt);
        expect(
          result.session.lastActivityAt >= before,
          `trial ${trial} moved lastActivityAt backwards`,
        ).toBe(true);
        session = result.session;
      }
    }
  });
});
