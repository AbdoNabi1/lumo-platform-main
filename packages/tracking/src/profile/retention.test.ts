import { beforeEach, describe, expect, it } from "vitest";

import { createProfile } from "./profile-merge";
import { InMemoryTrackingProfileStore } from "./profile-store";
import {
  eraseCustomerProfiles,
  redactDestinationEntries,
  redactEnvelopeNetwork,
  redactPayloadNetwork,
  runTrackingRetention,
  type EventNetworkRedactionPort,
} from "./retention";

beforeEach(() => {
  expect.hasAssertions();
});

const NOW = new Date("2026-11-27T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("redaction of IP and user agent", () => {
  const envelope = {
    eventId: "e-1",
    context: {
      page: { url: "https://shop.example/" },
      technical: {
        clientIpAddress: "203.0.113.7",
        clientUserAgent: "Mozilla/5.0",
        deviceType: "mobile",
        countryDetected: "EG",
      },
      identity: { hashStatus: "sha256", email: "abc" },
    },
  };

  it("removes only the two network fields from the envelope and keeps the rest", () => {
    const redacted = redactEnvelopeNetwork(envelope) as typeof envelope;
    expect(redacted.context.technical).toEqual({ deviceType: "mobile", countryDetected: "EG" });
    expect(redacted.context.page).toEqual(envelope.context.page);
    expect(redacted.context.identity).toEqual(envelope.context.identity);
    expect(redacted.eventId).toBe("e-1");
    // the input was not mutated
    expect(envelope.context.technical.clientIpAddress).toBe("203.0.113.7");
  });

  it("returns the very same object when there is nothing to remove", () => {
    const clean = { context: { technical: { deviceType: "mobile" } } };
    expect(redactEnvelopeNetwork(clean)).toBe(clean);
    expect(redactEnvelopeNetwork(null)).toBeNull();
    expect(redactEnvelopeNetwork({ context: {} })).toEqual({ context: {} });
  });

  it("removes the IP and user agent from every vendor payload shape, at any depth", () => {
    const meta = {
      data: [
        {
          event_name: "Lead",
          user_data: { em: ["h"], client_ip_address: "203.0.113.7", client_user_agent: "UA" },
        },
      ],
    };
    const tiktok = {
      data: [
        { event: "Lead", context: { ip: "203.0.113.7", user_agent: "UA", user: { email: "h" } } },
      ],
    };

    expect(redactPayloadNetwork(meta)).toEqual({
      data: [{ event_name: "Lead", user_data: { em: ["h"] } }],
    });
    expect(redactPayloadNetwork(tiktok)).toEqual({
      data: [{ event: "Lead", context: { user: { email: "h" } } }],
    });
    const clean = { data: [{ event_name: "x", user_data: { em: ["h"] } }] };
    expect(redactPayloadNetwork(clean)).toBe(clean);
  });

  it("redacts the rendered payload inside destination entries and nothing else of the entry", () => {
    const entries = [
      {
        destination: "meta.capi",
        status: "delivered",
        payloadDigest: "d",
        renderedPayload: { data: [{ user_data: { client_ip_address: "203.0.113.7", em: ["h"] } }] },
      },
      { destination: "blocked.one", status: "blocked", renderedPayload: {} },
    ];
    const redacted = redactDestinationEntries(entries) as typeof entries;
    expect(redacted[0]).toEqual({
      destination: "meta.capi",
      status: "delivered",
      payloadDigest: "d",
      renderedPayload: { data: [{ user_data: { em: ["h"] } }] },
    });
    expect(redacted[1]).toBe(entries[1]);
  });
});

function eventsPort(initial: Record<string, number>): EventNetworkRedactionPort & {
  readonly pending: Record<string, number>;
} {
  const pending = { ...initial };
  return {
    pending,
    tenantsWithUnredactedEvents: () =>
      Promise.resolve(Object.keys(pending).filter((tenant) => (pending[tenant] ?? 0) > 0)),
    redactBatch: (tenantId, _cutoff, limit) => {
      const take = Math.min(limit, pending[tenantId] ?? 0);
      pending[tenantId] = (pending[tenantId] ?? 0) - take;
      return Promise.resolve(take);
    },
  };
}

describe("runTrackingRetention", () => {
  it("deletes expired anonymous profiles and redacts old events, tenant by tenant, in batches", async () => {
    const profiles = new InMemoryTrackingProfileStore();
    const stale = createProfile({
      tenantId: "t-1",
      visitorId: "v-1",
      at: "2025-01-01T00:00:00.000Z",
      now: "2025-01-01T00:00:00.000Z",
    });
    await profiles.persist({ profile: stale, aliases: [], absorbed: [] });
    await profiles.persist({
      profile: createProfile({
        tenantId: "t-1",
        visitorId: "v-fresh",
        at: "2026-11-20T00:00:00.000Z",
        now: "2026-11-20T00:00:00.000Z",
      }),
      aliases: [],
      absorbed: [],
    });
    const events = eventsPort({ "t-1": 450, "t-2": 10 });

    const report = await runTrackingRetention({
      profiles,
      events,
      clock: { now: () => NOW },
      batchSize: 200,
    });

    expect(report).toEqual({
      profilesDeleted: 1,
      eventsRedacted: 460,
      tenantsVisited: 2,
      errored: 0,
    });
    expect(profiles.all("t-1").map((p) => p.visitorId)).toEqual(["v-fresh"]);
    expect(events.pending).toEqual({ "t-1": 0, "t-2": 0 });
  });

  it("cuts event records off 90 days back from now", async () => {
    const cutoffs: Date[] = [];
    const events: EventNetworkRedactionPort = {
      tenantsWithUnredactedEvents: (cutoff) => {
        cutoffs.push(cutoff);
        return Promise.resolve([]);
      },
      redactBatch: () => Promise.resolve(0),
    };
    await runTrackingRetention({
      profiles: new InMemoryTrackingProfileStore(),
      events,
      clock: { now: () => NOW },
    });
    expect(cutoffs[0]?.getTime()).toBe(NOW.getTime() - 90 * DAY);
  });

  it("one failing tenant is counted and does not stop the others", async () => {
    const events: EventNetworkRedactionPort = {
      tenantsWithUnredactedEvents: () => Promise.resolve(["t-bad", "t-good"]),
      redactBatch: (tenantId) =>
        tenantId === "t-bad" ? Promise.reject(new Error("boom")) : Promise.resolve(3),
    };
    const report = await runTrackingRetention({
      profiles: new InMemoryTrackingProfileStore(),
      events,
      clock: { now: () => NOW },
    });
    expect(report.errored).toBe(1);
    expect(report.eventsRedacted).toBe(3);
  });

  it("stops starting new batches once its budget is spent", async () => {
    let tick = 0;
    const clock = { now: () => new Date(NOW.getTime() + (tick += 1_000)) };
    const events = eventsPort({ "t-1": 10_000 });
    const report = await runTrackingRetention({
      profiles: new InMemoryTrackingProfileStore(),
      events,
      clock,
      batchSize: 100,
      budgetMs: 3_000,
    });
    expect(report.eventsRedacted).toBeLessThan(10_000);
    expect(report.eventsRedacted).toBeGreaterThan(0);
  });
});

describe("eraseCustomerProfiles", () => {
  it("erases the customer's profiles and refuses an empty tenant or customer id", async () => {
    const store = new InMemoryTrackingProfileStore();
    await store.persist({
      profile: {
        ...createProfile({
          tenantId: "t-1",
          visitorId: "v-1",
          at: "2026-11-01T00:00:00.000Z",
          now: "2026-11-01T00:00:00.000Z",
        }),
        customerId: "c-1",
      },
      aliases: ["v-1b"],
      absorbed: [],
    });
    expect(await eraseCustomerProfiles(store, "t-1", "c-1")).toBe(2);
    expect(store.all("t-1")).toHaveLength(0);
    await expect(eraseCustomerProfiles(store, "", "c-1")).rejects.toThrow();
    await expect(eraseCustomerProfiles(store, "t-1", " ")).rejects.toThrow();
  });
});
