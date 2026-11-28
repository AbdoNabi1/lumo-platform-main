import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { EnrichedEnvelope } from "../envelope/envelope";
import type { HashPort } from "../ids/dedup-id";
import { FINGERPRINT_MATCH_WINDOW_MS, TrackingProfileService } from "./profile-service";
import { InMemoryTrackingProfileStore } from "./profile-store";

beforeEach(() => {
  expect.hasAssertions();
});

const hasher: HashPort = {
  sha256Hex: (value) => Promise.resolve(createHash("sha256").update(value, "utf8").digest("hex")),
};

const T0 = new Date("2026-11-27T10:00:00.000Z");
const FP = "a".repeat(32);

interface Options {
  readonly tenantId?: string;
  readonly at?: Date;
  readonly visitorId?: string | null;
  readonly customerId?: string;
  readonly phone?: string;
  readonly fingerprintId?: string;
  readonly eventName?: string;
  readonly technical?: Record<string, unknown>;
  readonly attribution?: Record<string, unknown>;
}

function event(options: Options = {}): EnrichedEnvelope {
  const receivedAt = (options.at ?? T0).toISOString();
  return {
    eventId: `evt-${Math.random().toString(16).slice(2)}`,
    eventName: options.eventName ?? "page_viewed",
    eventVersion: 1,
    dedupId: `mb_${Math.random().toString(16).slice(2)}`,
    timestamp: receivedAt,
    receivedAt,
    eventTimestampMs: Date.parse(receivedAt),
    source: "web",
    environment: "production",
    consent: { analytics: true, marketing: true, personalization: true },
    tenancy: { tenantId: options.tenantId ?? "t-1" },
    context: {
      ...(options.visitorId === null
        ? {}
        : { session: { visitorId: options.visitorId ?? "v-1", sessionId: "s-1" } }),
      ...(options.customerId === undefined && options.phone === undefined
        ? {}
        : {
            identity: {
              hashStatus: "raw",
              ...(options.customerId === undefined ? {} : { customerId: options.customerId }),
              ...(options.phone === undefined ? {} : { phone: options.phone }),
            },
          }),
      technical: {
        ...(options.fingerprintId === undefined ? {} : { fingerprintId: options.fingerprintId }),
        ...options.technical,
      },
      ...(options.attribution === undefined ? {} : { attribution: options.attribution }),
    },
    properties: {},
  } as unknown as EnrichedEnvelope;
}

function build() {
  const store = new InMemoryTrackingProfileStore();
  let current = T0;
  const service = new TrackingProfileService({
    store,
    hasher,
    clock: { now: () => current },
    defaultCountryCode: "20",
  });
  return {
    store,
    service,
    setNow: (date: Date) => {
      current = date;
    },
  };
}

describe("collect-time facts on the profile (P1-D8)", () => {
  it("stores geo, bot score, fingerprint and the AI source of the landing", async () => {
    const { service, store } = build();
    await service.enrich(
      event({
        fingerprintId: FP,
        technical: { countryDetected: "EG", cityDetected: "Cairo", botScore: 12 },
        attribution: { aiSource: "chatgpt", utmSource: "chatgpt.com" },
      }),
    );
    const [profile] = store.all("t-1");
    expect(profile).toMatchObject({
      geo: { country: "EG", city: "Cairo" },
      botScore: 12,
      fingerprintId: FP,
      landing: { aiSource: "chatgpt" },
    });
  });

  it("an AI referral with no utm still counts as a landing touch", async () => {
    const { service, store } = build();
    await service.enrich(event({ attribution: { aiSource: "perplexity" } }));
    expect(store.all("t-1")[0]?.landing?.aiSource).toBe("perplexity");
  });

  it("a later event without the fields leaves them in place; a newer one replaces them", async () => {
    const { service, store, setNow } = build();
    await service.enrich(
      event({ fingerprintId: FP, technical: { countryDetected: "EG", botScore: 5 } }),
    );
    setNow(new Date(T0.getTime() + 60_000));
    await service.enrich(event({ at: new Date(T0.getTime() + 60_000) }));
    expect(store.all("t-1")[0]).toMatchObject({
      geo: { country: "EG" },
      botScore: 5,
      fingerprintId: FP,
    });
    await service.enrich(
      event({
        at: new Date(T0.getTime() + 120_000),
        fingerprintId: "b".repeat(32),
        technical: { countryDetected: "SA", botScore: 80 },
      }),
    );
    expect(store.all("t-1")[0]).toMatchObject({
      geo: { country: "SA" },
      botScore: 80,
      fingerprintId: "b".repeat(32),
    });
  });
});

describe("the cookieless id as identity's last resort (owner Q6)", () => {
  async function seeded() {
    const ctx = build();
    // The browser visit: cookie v-1 on a device whose fingerprint is FP.
    await ctx.service.enrich(
      event({
        fingerprintId: FP,
        technical: { clientUserAgent: "ua" },
        attribution: { utmSource: "meta" },
      }),
    );
    return ctx;
  }

  const lead = (extra: Options = {}) =>
    event({
      visitorId: null,
      phone: "+201001234567",
      eventName: "form_submitted",
      fingerprintId: FP,
      at: new Date(T0.getTime() + 3600_000),
      ...extra,
    });

  it("joins a cookieless server event to the one recent profile with the same fingerprint", async () => {
    const { service, store } = await seeded();
    const result = await service.enrich(lead());
    expect(store.all("t-1")).toHaveLength(1);
    // The event inherited what that visitor's landing left behind.
    expect(result.envelope.context.attribution?.utmSource).toBe("meta");
    // …and the device's profile learned the phone number the lead carried.
    expect(store.all("t-1")[0]).toMatchObject({
      visitorId: "v-1",
      hashes: { phoneE164: expect.any(String) },
    });
  });

  it("is never used when the event carries a visitor cookie, even an unknown one", async () => {
    const { service, store } = await seeded();
    await service.enrich(lead({ visitorId: "v-other" }));
    expect(store.all("t-1")).toHaveLength(2);
    expect(store.all("t-1").find((p) => p.visitorId === "v-1")?.lastSeenAt).toBe(T0.toISOString());
  });

  it("is never used when an identity key already found a profile", async () => {
    const { service, store } = await seeded();
    // A customer profile (found by customer id) is the answer; the fingerprint's profile is not folded in.
    await service.enrich(
      event({ visitorId: "v-cust", customerId: "c-1", at: new Date(T0.getTime() + 1000) }),
    );
    await service.enrich(lead({ customerId: "c-1" }));
    expect(
      store
        .all("t-1")
        .map((p) => p.visitorId)
        .sort(),
    ).toEqual(["v-1", "v-cust"]);
  });

  it("is ambiguous when two profiles share the fingerprint (one carrier cell, one phone model): no match", async () => {
    const { service, store } = await seeded();
    await service.enrich(
      event({ visitorId: "v-2", fingerprintId: FP, at: new Date(T0.getTime() + 10_000) }),
    );
    await service.enrich(lead());
    // A third, anonymous profile was created rather than guessing between v-1 and v-2.
    expect(store.all("t-1")).toHaveLength(3);
  });

  it("does not match a profile last seen outside the window", async () => {
    const { service, store } = await seeded();
    await service.enrich(
      lead({ at: new Date(T0.getTime() + FINGERPRINT_MATCH_WINDOW_MS + 60_000) }),
    );
    expect(store.all("t-1")).toHaveLength(2);
  });

  it("is per store: the same fingerprint value in another tenant matches nothing", async () => {
    const { service, store } = await seeded();
    await service.enrich(lead({ tenantId: "t-2" }));
    expect(store.all("t-1")).toHaveLength(1);
    expect(store.all("t-2")).toHaveLength(1);
    expect(store.all("t-2")[0]?.visitorId).not.toBe("v-1");
  });

  it("never merges profiles of different customers through a shared fingerprint", async () => {
    const { service, store } = build();
    await service.enrich(event({ visitorId: "v-a", customerId: "c-1", fingerprintId: FP }));
    await service.enrich(lead({ customerId: "c-2" }));
    const owners = store
      .all("t-1")
      .map((p) => `${p.visitorId}:${p.customerId ?? ""}`)
      .sort();
    expect(owners).toHaveLength(2);
    expect(owners).toContain("v-a:c-1");
    expect(owners.some((owner) => /^srv_[0-9a-f]+:c-2$/u.test(owner))).toBe(true);
  });
});
