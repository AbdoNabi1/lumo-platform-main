import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { CapturedClickId } from "../envelope/click-ids";
import type { EnrichedEnvelope } from "../envelope/envelope";
import type { HashPort } from "../ids/dedup-id";
import { InMemoryTrackingProfileStore, type TrackingProfileStore } from "./profile-store";
import { TrackingProfileService, resolveProfile } from "./profile-service";

beforeEach(() => {
  expect.hasAssertions();
});

const sha = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const hasher: HashPort = { sha256Hex: (value) => Promise.resolve(sha(value)) };

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-27T10:00:00.000Z");
const at = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

interface EventOptions {
  readonly tenantId?: string;
  readonly eventName?: string;
  readonly source?: "web" | "server";
  readonly receivedAt?: string;
  readonly visitorId?: string | null;
  readonly customerId?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly clickIds?: readonly CapturedClickId[];
  readonly meta?: { fbp?: string; fbc?: string };
  readonly browserIds?: { ttp?: string; scid?: string; gaClientId?: string; gaSessionId?: string };
  readonly ip?: string;
  readonly userAgent?: string;
  readonly pageUrl?: string;
  readonly utmSource?: string;
  readonly orderId?: string;
  readonly dedupId?: string;
}

function event(options: EventOptions = {}): EnrichedEnvelope {
  const receivedAt = options.receivedAt ?? NOW.toISOString();
  const identity =
    options.phone !== undefined || options.email !== undefined || options.customerId !== undefined
      ? {
          hashStatus: "raw" as const,
          ...(options.phone === undefined ? {} : { phone: options.phone }),
          ...(options.email === undefined ? {} : { email: options.email }),
          ...(options.customerId === undefined ? {} : { customerId: options.customerId }),
        }
      : undefined;
  const hasAttribution =
    options.clickIds !== undefined ||
    options.meta !== undefined ||
    options.browserIds !== undefined ||
    options.utmSource !== undefined;
  return {
    eventId: `evt-${Math.random().toString(16).slice(2)}`,
    eventName: options.eventName ?? "page_viewed",
    eventVersion: 1,
    dedupId: options.dedupId ?? `mb_${Math.random().toString(16).slice(2)}`,
    timestamp: receivedAt,
    receivedAt,
    eventTimestampMs: Date.parse(receivedAt),
    source: options.source ?? "web",
    environment: "production",
    consent: { analytics: true, marketing: true, personalization: true },
    tenancy: { tenantId: options.tenantId ?? "t-1" },
    context: {
      ...(options.visitorId === null
        ? {}
        : { session: { visitorId: options.visitorId ?? "v-1", sessionId: "s-1" } }),
      ...(identity === undefined ? {} : { identity }),
      ...(options.ip === undefined && options.userAgent === undefined
        ? {}
        : {
            technical: {
              ...(options.ip === undefined ? {} : { clientIpAddress: options.ip }),
              ...(options.userAgent === undefined ? {} : { clientUserAgent: options.userAgent }),
            },
          }),
      ...(options.pageUrl === undefined ? {} : { page: { url: options.pageUrl } }),
      ...(hasAttribution
        ? {
            attribution: {
              ...(options.clickIds === undefined ? {} : { clickIds: options.clickIds }),
              ...(options.meta === undefined ? {} : { meta: options.meta }),
              ...(options.browserIds === undefined ? {} : { browserIds: options.browserIds }),
              ...(options.utmSource === undefined ? {} : { utmSource: options.utmSource }),
            },
          }
        : {}),
    },
    properties: {},
    ...(options.orderId === undefined ? {} : { payload: { orderId: options.orderId } }),
  } as unknown as EnrichedEnvelope;
}

function click(name: CapturedClickId["name"], value: string, daysAgo: number): CapturedClickId {
  return { name, value, capturedAt: at(daysAgo) };
}

function build(
  overrides: { store?: TrackingProfileStore; onError?: (error: unknown) => void } = {},
): {
  readonly service: TrackingProfileService;
  readonly store: InMemoryTrackingProfileStore;
  readonly errors: unknown[];
  /** Moves the service's clock (profiles are stamped with the time they were created). */
  readonly setNow: (iso: string) => void;
} {
  const store = new InMemoryTrackingProfileStore();
  const errors: unknown[] = [];
  let current = NOW;
  const service = new TrackingProfileService({
    store: overrides.store ?? store,
    hasher,
    clock: { now: () => current },
    defaultCountryCode: "20",
    onError: overrides.onError ?? ((error) => errors.push(error)),
  });
  return {
    service,
    store,
    errors,
    setNow: (iso) => {
      current = new Date(iso);
    },
  };
}

describe("enrichment: a later server event completed from an earlier browser event", () => {
  it("gets fbc, ttclid, browser ids, phone hashes, IP, user agent and page from the same visitor", async () => {
    const { service, store } = build();

    await service.enrich(
      event({
        receivedAt: at(2),
        visitorId: "v-1",
        phone: "01012345678",
        email: "Jane.Doe@Gmail.com",
        clickIds: [click("ttclid", "tt-click-1", 2), click("gclid", "g-click-1", 2)],
        meta: { fbp: "fb.1.1795000000000.111", fbc: "fb.1.1795300000000.AbCdEf" },
        browserIds: { ttp: "ttp-1", scid: "scid-1", gaClientId: "111.222", gaSessionId: "333" },
        ip: "203.0.113.7",
        userAgent: "Mozilla/5.0 (test)",
        pageUrl: "https://shop.example/p/1?ttclid=tt-click-1",
        utmSource: "tiktok",
      }),
    );

    const later = event({ eventName: "form_submitted", source: "server", visitorId: "v-1" });
    const result = await service.enrich(later);

    const attribution = result.envelope.context.attribution;
    expect(attribution?.clickIds?.map((c) => `${c.name}:${c.value}`).sort()).toEqual([
      "gclid:g-click-1",
      "ttclid:tt-click-1",
    ]);
    expect(attribution?.meta).toEqual({
      fbp: "fb.1.1795000000000.111",
      fbc: "fb.1.1795300000000.AbCdEf",
    });
    expect(attribution?.browserIds).toEqual({
      ttp: "ttp-1",
      scid: "scid-1",
      gaClientId: "111.222",
      gaSessionId: "333",
    });
    expect(attribution?.utmSource).toBe("tiktok");
    expect(result.envelope.context.technical).toEqual({
      clientIpAddress: "203.0.113.7",
      clientUserAgent: "Mozilla/5.0 (test)",
    });
    expect(result.envelope.context.page?.eventSourceUrl).toBe(
      "https://shop.example/p/1?ttclid=tt-click-1",
    );

    // The phone / email hashes come back per platform, in each platform's own form.
    expect(result.matchKeys?.meta.ph).toBe(sha("201012345678"));
    expect(result.matchKeys?.snap.ph).toBe(sha("201012345678"));
    expect(result.matchKeys?.tiktok.ph).toBe(sha("+201012345678"));
    expect(result.matchKeys?.ga4.ph).toBe(sha("+201012345678"));
    expect(result.matchKeys?.google_ads.ph).toBe(sha("+201012345678"));
    expect(result.matchKeys?.meta.em).toBe(sha("jane.doe@gmail.com"));
    expect(result.matchKeys?.tiktok.em).toBe(sha("jane.doe@gmail.com")); // TikTok: trim + lowercase only
    expect(result.matchKeys?.ga4.em).toBe(sha("janedoe@gmail.com")); // GA4: gmail dots stripped
    expect(result.matchKeys?.google_ads.em).toBe(sha("janedoe@gmail.com")); // Google: dots (and +suffix)

    // The stored profile holds hashes, never the raw phone or email.
    const stored = JSON.stringify(store.all("t-1"));
    expect(stored).not.toContain("01012345678");
    expect(stored).not.toContain("201012345678");
    expect(stored.toLowerCase()).not.toContain("jane.doe");
  });

  it("an event keeps what it carries itself; the profile only fills the gaps", async () => {
    const { service } = build();
    await service.enrich(
      event({
        receivedAt: at(2),
        clickIds: [click("ttclid", "tt-old", 2)],
        meta: { fbp: "fb.1.1.old" },
        ip: "203.0.113.7",
        userAgent: "Old/1",
        pageUrl: "https://shop.example/old",
      }),
    );

    const result = await service.enrich(
      event({
        clickIds: [click("ttclid", "tt-fresh", 0)],
        meta: { fbp: "fb.1.1.fresh" },
        ip: "198.51.100.9",
        pageUrl: "https://shop.example/now",
      }),
    );

    expect(
      result.envelope.context.attribution?.clickIds?.find((c) => c.name === "ttclid")?.value,
    ).toBe("tt-fresh");
    expect(result.envelope.context.attribution?.meta?.fbp).toBe("fb.1.1.fresh");
    expect(result.envelope.context.technical?.clientIpAddress).toBe("198.51.100.9");
    expect(result.envelope.context.technical?.clientUserAgent).toBe("Old/1"); // gap filled
    expect(result.envelope.context.page?.eventSourceUrl).toBeUndefined(); // it has its own url
    expect(result.envelope.context.page?.url).toBe("https://shop.example/now");
  });

  it("a server event with no cookie is found by the phone number and gets the visitor's click ids", async () => {
    const { service, store } = build();
    await service.enrich(
      event({
        receivedAt: at(3),
        visitorId: "v-1",
        phone: "+201012345678",
        clickIds: [click("ttclid", "tt-click-1", 3)],
        meta: { fbc: "fb.1.1795300000000.AbCdEf" },
      }),
    );

    const lead = event({
      eventName: "form_submitted",
      source: "server",
      visitorId: null,
      phone: "٠١٠١٢٣٤٥٦٧٨", // Arabic-Indic digits, national format
    });
    const result = await service.enrich(lead);

    expect(result.envelope.context.attribution?.clickIds?.[0]?.value).toBe("tt-click-1");
    expect(result.envelope.context.attribution?.meta?.fbc).toBe("fb.1.1795300000000.AbCdEf");
    expect(store.all("t-1")).toHaveLength(1); // one person, one profile
  });

  it("completes the customer id and the lead id the profile produced", async () => {
    const { service, store } = build();
    await service.enrich(event({ visitorId: "v-1", phone: "01012345678" }));
    await service.enrich(
      event({
        visitorId: "v-1",
        eventName: "form_submitted",
        dedupId: "lead_abc",
        customerId: "c-7",
        orderId: "o-9",
      }),
    );

    const profile = store.all("t-1")[0];
    expect(profile?.customerId).toBe("c-7");
    expect(profile?.leadIds).toEqual(["abc"]);
    expect(profile?.orderIds).toEqual(["o-9"]);

    const anonymous = await service.enrich(event({ visitorId: "v-1" }));
    expect(anonymous.envelope.context.user?.customerId).toBe("c-7");
  });

  it("gives an event with no identity block a block of hashes when the profile knows the visitor's phone; never when it knows nothing", async () => {
    const { service } = build();
    await service.enrich(event({ receivedAt: at(1), visitorId: "v-1", phone: "+201012345678" }));
    await service.enrich(event({ receivedAt: at(1), visitorId: "v-anon" }));

    const known = await service.enrich(event({ source: "server", visitorId: "v-1" }));
    expect(known.envelope.context.identity).toEqual({
      hashStatus: "sha256",
      visitorId: "v-1",
      phone: sha("+201012345678"),
    });

    const anonymous = await service.enrich(event({ source: "server", visitorId: "v-anon" }));
    expect(anonymous.envelope.context.identity).toBeUndefined();

    // an event's own identity block is never replaced
    const own = await service.enrich(event({ visitorId: "v-1", email: "a@b.co" }));
    expect(own.envelope.context.identity?.hashStatus).toBe("raw");
  });

  it("an event with nothing to key a profile on is returned untouched and stores nothing", async () => {
    const { service, store } = build();
    const bare = event({ visitorId: null });
    const result = await service.enrich(bare);
    expect(result.envelope).toBe(bare);
    expect(result.matchKeys).toBeUndefined();
    expect(store.all("t-1")).toHaveLength(0);
  });
});

describe("click-id windows", () => {
  it("drops an expired click id from the profile and from the event; keeps one still in its window", async () => {
    const { service, store } = build();
    await service.enrich(
      event({
        receivedAt: at(40),
        visitorId: "v-1",
        clickIds: [
          click("scclid", "sc-old", 40), // Snap: 28 days
          click("ttclid", "tt-ok", 40), // TikTok: 90 days
        ],
      }),
    );

    // Today: Snap's click (40 d) is out of its window, TikTok's (40 d) is not.
    const later = await service.enrich(event({ source: "server", visitorId: "v-1" }));
    const names = (later.envelope.context.attribution?.clickIds ?? []).map((c) => c.name);
    expect(names).toEqual(["ttclid"]);
    expect(Object.keys(store.all("t-1")[0]?.clickIds ?? {})).toEqual(["ttclid"]);
  });

  it("an event's own expired click id is dropped, not forwarded", async () => {
    const { service } = build();
    const result = await service.enrich(
      event({
        visitorId: "v-1",
        clickIds: [click("gclid", "g-ancient", 120), click("fbclid", "fb-ok", 5)],
      }),
    );
    expect((result.envelope.context.attribution?.clickIds ?? []).map((c) => c.name)).toEqual([
      "fbclid",
    ]);
  });

  it("an fbc older than Meta's 90 days is not handed to a later event", async () => {
    const { service } = build();
    const stale = `fb.1.${String(NOW.getTime() - 120 * DAY)}.OldClick`;
    await service.enrich(
      event({ receivedAt: at(1), visitorId: "v-1", meta: { fbp: "fb.1.1.fbp", fbc: stale } }),
    );
    const later = await service.enrich(event({ source: "server", visitorId: "v-1" }));
    expect(later.envelope.context.attribution?.meta?.fbc).toBeUndefined();
    expect(later.envelope.context.attribution?.meta?.fbp).toBe("fb.1.1.fbp");
  });
});

describe("tenant isolation", () => {
  it("two tenants with the same cookie id, phone and customer id never share a profile", async () => {
    const { service, store } = build();
    await service.enrich(
      event({
        tenantId: "t-1",
        visitorId: "v-1",
        phone: "01012345678",
        customerId: "c-1",
        clickIds: [click("ttclid", "tt-of-t1", 1)],
        ip: "203.0.113.7",
      }),
    );

    const other = await service.enrich(
      event({
        tenantId: "t-2",
        source: "server",
        visitorId: "v-1",
        phone: "01012345678",
        customerId: "c-1",
      }),
    );

    expect(other.envelope.context.attribution?.clickIds).toBeUndefined();
    expect(other.envelope.context.technical?.clientIpAddress).toBeUndefined();
    expect(store.all("t-1")).toHaveLength(1);
    expect(store.all("t-2")).toHaveLength(1);
    expect(store.all("t-2")[0]?.clickIds).toEqual({});
    expect(store.all("t-2")[0]?.lastIp).toBeUndefined();
  });
});

describe("identity resolution", () => {
  it("folds a second cookie of the same person into one profile via the phone hash, keeping both cookies resolvable", async () => {
    const { service, store, setNow } = build();
    setNow(at(10));
    await service.enrich(
      event({
        receivedAt: at(10),
        visitorId: "v-phone",
        phone: "01012345678",
        clickIds: [click("ttclid", "tt-1", 10)],
      }),
    );
    setNow(at(5));
    await service.enrich(
      event({
        receivedAt: at(5),
        visitorId: "v-other-device",
        clickIds: [click("gclid", "g-1", 5)],
      }),
    );
    expect(store.all("t-1")).toHaveLength(2);

    // The other device identifies itself with the same phone: the two profiles become one.
    setNow(at(1));
    await service.enrich(
      event({ receivedAt: at(1), visitorId: "v-other-device", phone: "01012345678" }),
    );
    setNow(NOW.toISOString());

    const profiles = store.all("t-1");
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.visitorId).toBe("v-phone"); // the oldest survives
    expect(Object.keys(profiles[0]?.clickIds ?? {}).sort()).toEqual(["gclid", "ttclid"]);
    expect(store.aliases("t-1").get("v-other-device")).toBe("v-phone");

    // Either cookie, on its own, now gets everything.
    const viaOld = await service.enrich(event({ source: "server", visitorId: "v-other-device" }));
    expect(viaOld.envelope.context.attribution?.clickIds?.map((c) => c.name).sort()).toEqual([
      "gclid",
      "ttclid",
    ]);
  });

  it("tries customer id, then email hash, then phone hash, then the cookie", async () => {
    const calls: string[] = [];
    const store = new InMemoryTrackingProfileStore();
    const spy: TrackingProfileStore = {
      findByCustomerId: (t, k) => (calls.push("customer"), store.findByCustomerId(t, k)),
      findByEmailHash: (t, k) => (calls.push("email"), store.findByEmailHash(t, k)),
      findByPhoneHash: (t, k) => (calls.push("phone"), store.findByPhoneHash(t, k)),
      findByVisitorId: (t, k) => (calls.push("visitor"), store.findByVisitorId(t, k)),
      persist: (c) => store.persist(c),
      eraseCustomer: (t, c) => store.eraseCustomer(t, c),
      deleteExpiredAnonymous: (t, n) => store.deleteExpiredAnonymous(t, n),
    };
    await resolveProfile(spy, "t-1", {
      customerId: "c-1",
      emailStd: "e",
      phoneE164: "p",
      visitorId: "v",
    });
    expect(calls).toEqual(["customer", "email", "phone", "visitor"]);
  });

  it("never merges two different customers, even on a shared phone", async () => {
    const { service, store } = build();
    await service.enrich(
      event({
        receivedAt: at(4),
        visitorId: "v-1",
        phone: "01012345678",
        customerId: "c-1",
        clickIds: [click("ttclid", "tt-of-c1", 4)],
      }),
    );
    const second = await service.enrich(
      event({ visitorId: "v-2", phone: "01012345678", customerId: "c-2" }),
    );

    expect(store.all("t-1")).toHaveLength(2);
    expect(second.envelope.context.attribution?.clickIds).toBeUndefined();
    expect(store.all("t-1").find((p) => p.customerId === "c-2")?.clickIds).toEqual({});
  });

  it("a customer's login on a new device attaches that cookie to the customer's profile", async () => {
    const { service, store } = build();
    await service.enrich(
      event({
        receivedAt: at(9),
        visitorId: "v-1",
        customerId: "c-1",
        clickIds: [click("fbclid", "fb-1", 9)],
      }),
    );
    const onNewDevice = await service.enrich(
      event({ visitorId: "v-2", customerId: "c-1", source: "server" }),
    );
    expect(store.all("t-1")).toHaveLength(1);
    expect(store.aliases("t-1").get("v-2")).toBe("v-1");
    expect(onNewDevice.envelope.context.attribution?.clickIds?.[0]?.value).toBe("fb-1");
  });

  it("ignores an absurdly long cookie id instead of keying a profile on it", async () => {
    const { service, store } = build();
    await service.enrich(event({ visitorId: "x".repeat(500) }));
    expect(store.all("t-1")).toHaveLength(0);
  });
});

describe("a profile never stands between an event and its delivery", () => {
  it("a failing store returns the event unchanged and reports the failure without any event data", async () => {
    const failing: TrackingProfileStore = {
      findByCustomerId: () => Promise.reject(new Error("db down")),
      findByEmailHash: () => Promise.reject(new Error("db down")),
      findByPhoneHash: () => Promise.reject(new Error("db down")),
      findByVisitorId: () => Promise.reject(new Error("db down")),
      persist: () => Promise.reject(new Error("db down")),
      eraseCustomer: () => Promise.resolve(0),
      deleteExpiredAnonymous: () => Promise.resolve(0),
    };
    const { service, errors } = build({ store: failing });
    const original = event({ visitorId: "v-1", phone: "01012345678" });
    const result = await service.enrich(original);
    expect(result.envelope).toBe(original);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).not.toContain("01012345678");
  });

  it("a write that lost a race is re-read and re-applied; a visitor that keeps colliding still gets the event through", async () => {
    const real = new InMemoryTrackingProfileStore();
    let losses = 1;
    const racing: TrackingProfileStore = {
      findByCustomerId: (t, k) => real.findByCustomerId(t, k),
      findByEmailHash: (t, k) => real.findByEmailHash(t, k),
      findByPhoneHash: (t, k) => real.findByPhoneHash(t, k),
      findByVisitorId: (t, k) => real.findByVisitorId(t, k),
      persist: (c) => {
        if (losses > 0) {
          losses -= 1;
          return Promise.resolve(false);
        }
        return real.persist(c);
      },
      eraseCustomer: (t, c) => real.eraseCustomer(t, c),
      deleteExpiredAnonymous: (t, n) => real.deleteExpiredAnonymous(t, n),
    };
    const first = build({ store: racing });
    await first.service.enrich(event({ visitorId: "v-1", clickIds: [click("gclid", "g-1", 0)] }));
    expect(real.all("t-1")).toHaveLength(1);
    expect(first.errors).toHaveLength(0);

    losses = Number.POSITIVE_INFINITY;
    const second = build({ store: racing });
    const result = await second.service.enrich(
      event({ visitorId: "v-2", clickIds: [click("gclid", "g-2", 0)] }),
    );
    expect(result.envelope.context.attribution?.clickIds?.[0]?.value).toBe("g-2");
    expect(second.errors).toHaveLength(1);
  });
});
