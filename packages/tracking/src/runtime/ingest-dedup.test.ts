import { beforeEach, describe, expect, it } from "vitest";

import { collect, type CollectorDeps } from "../collector/collector";
import type { TrackingEnvelope } from "../envelope/envelope";
import { ingestTrackingEvent, type IngestRuntimeDeps } from "./ingest-runtime";

/**
 * Tracking P2-D10: with no natural key the dedup id is `explicit:<eventId>`, never a session + minute bucket, and a
 * browser-provided dedup id is only trusted when `checkProvidedDedupId` accepts it. The hasher is the identity, so the
 * dedup id IS the key material and every assertion reads as the key.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const AT = new Date("2026-11-28T12:00:30.000Z");
const TENANT = "t-1";
const UUID_A = "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b";
const UUID_B = "0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7c";

const collectorDeps: CollectorDeps = {
  writeKeys: { resolve: () => ({ tenantId: TENANT }) },
  idGenerator: { generate: () => "gen-1" },
  clock: { now: () => AT },
  ipPolicy: { trustedProxyCount: 0 },
};

/** Collects a browser beacon of one session; every call is a distinct occurrence. */
function browserEvent(event: Record<string, unknown>) {
  const outcome = collect(
    {
      body: {
        writeKey: "wk",
        event: {
          eventName: "page_view",
          eventVersion: 1,
          timestamp: AT.toISOString(),
          environment: "production",
          context: { page: { url: "https://shop.example/" } },
          properties: {},
          ...event,
        },
      },
      headers: () => undefined,
      cookies: (name) => (name === "morbeh_sid" ? "session-1" : undefined),
      remoteAddress: "203.0.113.7",
    },
    collectorDeps,
  );
  if (outcome.status !== "accepted") throw new Error("expected the beacon to be collected");
  return outcome;
}

/** Ingests with no destination: the profile stub sees the completed envelope, nothing is recorded. */
async function dedupIdOf(envelope: TrackingEnvelope): Promise<string> {
  let seen: string | undefined;
  const deps: IngestRuntimeDeps = {
    recording: {} as never,
    destinations: { listActive: () => [] } as never,
    ruleSets: { resolve: () => null } as never,
    ruleSetKey: "default",
    hasher: { sha256Hex: (input) => Promise.resolve(input) },
    clock: { now: () => AT },
    profiles: {
      enrich: (completed) => {
        seen = completed.dedupId;
        return Promise.resolve({ envelope: completed, matchKeys: {} } as never);
      },
    },
  };
  const outcome = await ingestTrackingEvent(deps, { envelope });
  if (outcome.status === "refused") throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  if (seen === undefined) throw new Error("the profile stub did not see the envelope");
  return seen;
}

describe("ingest dedup id without a natural key (P2-D10)", () => {
  it("keeps two page views of one session in one minute distinct", async () => {
    const first = browserEvent({ eventId: `mb_${UUID_A}` }).envelope;
    const second = browserEvent({ eventId: `mb_${UUID_B}` }).envelope;
    expect(first.context.session?.sessionId).toBe(second.context.session?.sessionId);

    const [a, b] = [await dedupIdOf(first), await dedupIdOf(second)];

    expect(a).toBe(`${TENANT}|page_view|v1|explicit:mb_${UUID_A}`);
    expect(b).toBe(`${TENANT}|page_view|v1|explicit:mb_${UUID_B}`);
    expect(a).not.toBe(b);
    expect(a).not.toContain("session:");
  });

  it("derives the same id when one occurrence is replayed", async () => {
    const envelope = browserEvent({ eventId: `mb_${UUID_A}` }).envelope;
    expect(await dedupIdOf(envelope)).toBe(await dedupIdOf(envelope));
  });

  it("still keys an event with an order id by the order", async () => {
    const one = browserEvent({ eventId: `mb_${UUID_A}`, payload: { orderId: "o-1" } }).envelope;
    const two = browserEvent({ eventId: `mb_${UUID_B}`, payload: { orderId: "o-1" } }).envelope;

    expect(await dedupIdOf(one)).toBe(`${TENANT}|page_view|v1|order:o-1`);
    expect(await dedupIdOf(two)).toBe(await dedupIdOf(one));
  });

  it("replaces an invalid browser dedup id with explicit:eventId and reports it", async () => {
    const out = browserEvent({ eventId: `mb_${UUID_A}`, dedupId: "undefined" });

    expect(out.dedupIdReplaced).toBe(true);
    expect(out.envelope.dedupId).toBeUndefined();
    expect(await dedupIdOf(out.envelope)).toBe(`${TENANT}|page_view|v1|explicit:mb_${UUID_A}`);
  });

  it("collapses a browser copy and a server copy that share a valid dedup id", async () => {
    const browser = browserEvent({ eventId: `mb_${UUID_A}`, dedupId: "ord_o-1" });
    const server: TrackingEnvelope = {
      ...browserEvent({ eventId: `mb_${UUID_B}` }).envelope,
      eventOrigin: "server",
      dedupId: "ord_o-1",
    };

    expect(browser.dedupIdReplaced).toBeUndefined();
    expect(await dedupIdOf(browser.envelope)).toBe("ord_o-1");
    expect(await dedupIdOf(server)).toBe("ord_o-1");
  });

  it.each(["ord_o-1", "dlv_o-1", "cnl_o-1", "lead_l-1"])(
    "passes the server business id %s through unchanged",
    async (businessId) => {
      const server: TrackingEnvelope = {
        ...browserEvent({ eventId: `mb_${UUID_A}` }).envelope,
        eventOrigin: "server",
        dedupId: businessId,
      };
      expect(await dedupIdOf(server)).toBe(businessId);
    },
  );
});
