/**
 * `receiveAndDeliver` with vendor-builder destinations (lead-site plan D1, Task 3): per-destination
 * match keys, builder refusals recorded as `blocked`, and secrets that never reach a record.
 *
 * Lives in `runtime/` because FF-ARCH-09 keeps the identifier `receiveAndDeliver` inside this
 * directory.
 */

import { createHash } from "node:crypto";

import { RetryPolicy } from "@platform/messaging";
import { beforeEach, describe, expect, it } from "vitest";

import { HttpJsonAdapter, type HttpTransportPort } from "../delivery/adapters";
import type { DeliveryDeps } from "../delivery/delivery-pipeline";
import type { DestinationDefinition } from "../delivery/destination";
import type { MappingProfile } from "../delivery/mapping";
import { STANDARD_RETRY } from "../delivery/platform-profiles";
import type { RoutingDecision } from "../delivery/router";
import type { EnrichedEnvelope } from "../envelope/envelope";
import type { IdentityContext } from "../envelope/identity-context";
import type { HashPort } from "../ids/dedup-id";
import type { EventRecord, EventRecordWriterPort } from "../inspector/event-record";
import {
  InMemoryDestinationState,
  receiveAndDeliver,
  type RecordingRuntimeDeps,
} from "./delivery-runtime";

const nodeSha256: HashPort = {
  sha256Hex: async (s) => createHash("sha256").update(s, "utf8").digest("hex"),
};
const sha = (s: string): Promise<string> => nodeSha256.sha256Hex(s);

// Built from parts so a masking display layer can never turn the fixture into something else.
const PHONE_DIGITS = "20" + "1012345678";
const PHONE_E164 = `+${PHONE_DIGITS}`;

const EVENT_TIME_MS = 1764000000123;
const NOW = new Date(EVENT_TIME_MS + 1_000);
const URL_ = "https://clinic.example/offers?utm_source=meta";
// Contains every character a URL or JSON encoding would change: `+ / = : |`.
const SECRET = "se+cr/et=:|proof1234";

const RAW_IDENTITY: IdentityContext = {
  email: "Jane.Doe+x@gmail.com",
  phone: PHONE_E164,
  firstName: "Ahmed",
  lastName: "Ali",
  country: "EG",
  city: "Cairo",
  hashStatus: "raw",
};

function envelope(
  overrides: Partial<EnrichedEnvelope> = {},
  identity: IdentityContext | undefined = RAW_IDENTITY,
): EnrichedEnvelope {
  return {
    eventId: "01919d1e-0000-7000-8000-000000000001",
    eventName: "form_submitted",
    eventVersion: 1,
    dedupId: "lead_0193a1b2-0000-7000-8000-000000000001",
    timestamp: new Date(EVENT_TIME_MS).toISOString(),
    receivedAt: NOW.toISOString(),
    eventTimestampMs: EVENT_TIME_MS,
    source: "server",
    environment: "production",
    consent: {
      analytics: true,
      marketing: true,
      personalization: true,
      grants: { ad_storage: true, ad_user_data: true, ad_personalization: true },
    },
    context: {
      page: { url: URL_ },
      technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 (test)" },
      attribution: {
        meta: { fbp: "fb.1.1764000000000.123456789" },
        browserIds: { ttp: "ttp-abc", gaClientId: "111111111.1764000000" },
      },
      ...(identity === undefined ? {} : { identity }),
    },
    properties: {},
    tenancy: { tenantId: "t-1" },
    ...overrides,
  } as EnrichedEnvelope;
}

function destination(
  key: string,
  platform: string,
  builderKey: DestinationDefinition["builderKey"],
  target: string,
  auth: NonNullable<DestinationDefinition["endpoint"]["auth"]>,
  url: string,
): DestinationDefinition {
  return {
    key,
    platform,
    transport: "http_json",
    channel: "server",
    consentPurpose: "marketing",
    mappingProfileKey: `${key}.stub`,
    endpoint: {
      url,
      method: "POST",
      credentialRef: `conn://t-1/${platform}`,
      auth,
      timeoutMs: 5_000,
    },
    retry: STANDARD_RETRY,
    enabled: true,
    ...(builderKey === undefined ? {} : { builderKey, vendorTarget: { id: target } }),
  };
}

const META = destination(
  "meta.capi.shop",
  "meta",
  "meta.capi.v27",
  "123456789012345",
  { kind: "query", param: "access_token" },
  "https://graph.facebook.com/v27.0/123456789012345/events",
);
const TIKTOK = destination(
  "tiktok.events.shop",
  "tiktok",
  "tiktok.events.v1_3",
  "CABCDE1234567890",
  { kind: "header", name: "Access-Token" },
  "https://business-api.tiktok.com/open_api/v1.3/event/track/",
);
const SNAP = destination(
  "snap.capi.shop",
  "snap",
  "snap.capi.v3",
  "0b8f1c7e-1a2b-4c3d-8e9f-0123456789ab",
  { kind: "query", param: "access_token" },
  "https://tr.snapchat.com/v3/0b8f1c7e-1a2b-4c3d-8e9f-0123456789ab/events",
);
const GA4 = destination(
  "ga4.mp.shop",
  "ga4",
  "ga4.mp",
  "G-ABCD1234",
  { kind: "query", param: "api_secret" },
  "https://www.google-analytics.com/mp/collect?measurement_id=G-ABCD1234",
);

interface HttpCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

function world(
  destinations: readonly DestinationDefinition[],
  options: {
    readonly respond?: () => Promise<{
      status: number;
      body?: Record<string, unknown>;
      error?: string;
    }>;
    readonly maxAttempts?: number;
  } = {},
) {
  const calls: HttpCall[] = [];
  const order: string[] = [];
  const appended: EventRecord[] = [];
  const histories: unknown[] = [];
  const deadLetters: unknown[] = [];

  const http: HttpTransportPort = {
    send: (input) => {
      order.push("http");
      calls.push({
        url: input.url,
        headers: input.headers,
        body: input.body === undefined ? undefined : JSON.parse(input.body),
      });
      return (options.respond ?? (() => Promise.resolve({ status: 200 })))();
    },
  };
  const adapter = new HttpJsonAdapter({
    http,
    credentials: { resolve: () => Promise.resolve(SECRET) },
    now: () => 0,
  });

  const delivery: DeliveryDeps = {
    adapters: { resolve: () => adapter },
    mappings: {
      resolve: (): MappingProfile => ({
        key: "stub",
        version: 1,
        destination: "stub",
        fields: [{ target: "event_name", source: "event.name" }],
      }),
      resolveVersion: (): null => null,
    },
    retryPolicy: new RetryPolicy({
      maxAttempts: options.maxAttempts ?? 1,
      baseDelayMs: 1,
      factor: 2,
      maxDelayMs: 4,
      jitter: () => 0,
    }),
    processed: { recordIfNew: () => Promise.resolve(true) },
    deadLetters: {
      add: (entry) => {
        deadLetters.push(entry);
        return Promise.resolve();
      },
    },
    sleep: () => Promise.resolve(),
    now: () => NOW,
  };

  const records: EventRecordWriterPort = {
    append: (record) => {
      order.push("append");
      appended.push(record);
      return Promise.resolve();
    },
    appendHistory: (input) => {
      histories.push(input);
      return Promise.resolve();
    },
  };

  const deps: RecordingRuntimeDeps = {
    delivery,
    records,
    hasher: nodeSha256,
    versions: { destinationVersion: () => 1, mappingVersion: () => 1, ruleSet: () => null },
    destinationState: new InMemoryDestinationState(),
    clock: { now: () => NOW },
  };

  const routing: RoutingDecision = {
    routed: destinations.map((d) => ({ destination: d })),
    excluded: [],
    evaluation: {} as RoutingDecision["evaluation"],
    degraded: false,
  };

  return { deps, routing, calls, order, appended, histories, deadLetters };
}

describe("receiveAndDeliver: vendor builder destinations", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("gives each routed destination its own phone hash from one raw identity", async () => {
    const w = world([META, TIKTOK]);
    const out = await receiveAndDeliver(w.deps, { envelope: envelope(), routing: w.routing });

    expect(out.renderFailures).toEqual([]);
    expect(w.calls).toHaveLength(2);

    const meta = w.calls[0]?.body as { data: { user_data: { ph: string[]; em: string[] } }[] };
    const tiktok = w.calls[1]?.body as { data: { user: { phone: string; email: string } }[] };
    expect(meta.data[0]?.user_data.ph).toEqual([await sha(PHONE_DIGITS)]);
    expect(tiktok.data[0]?.user.phone).toBe(await sha(PHONE_E164));
    expect(meta.data[0]?.user_data.em).toEqual([await sha("jane.doe+x@gmail.com")]);
    expect(tiktok.data[0]?.user.email).toBe(await sha("jane.doe+x@gmail.com"));

    // The recorded identity stays the one shared, hashed block.
    expect(out.record.identitySnapshot).toMatchObject({
      hashStatus: "sha256",
      phone: await sha(PHONE_E164),
      email: await sha("jane.doe+x@gmail.com"),
    });
    expect(out.record.hashStatus).toBe("sha256");
    expect(w.appended[0]?.identitySnapshot.phone).toBe(await sha(PHONE_E164));
  });

  it("sends the builder output as the recorded payload, byte for byte", async () => {
    const w = world([TIKTOK]);
    const out = await receiveAndDeliver(w.deps, { envelope: envelope(), routing: w.routing });

    const recorded = w.appended[0]?.destinationHistory[0]?.renderedPayload;
    expect(recorded).toEqual(w.calls[0]?.body);
    expect(recorded).toMatchObject({ event_source: "web", event_source_id: "CABCDE1234567890" });
    expect(out.results[0]?.result.outcome.status).toBe("delivered");
  });

  it("an identity that arrives already hashed yields no per-platform keys", async () => {
    const w = world([META]);
    await receiveAndDeliver(w.deps, {
      envelope: envelope({}, { email: "h-em", phone: "h-ph", hashStatus: "sha256" }),
      routing: w.routing,
    });
    expect(w.calls[0]?.body).toEqual({
      data: [
        {
          event_name: "Lead",
          event_time: 1764000000,
          event_id: "lead_0193a1b2-0000-7000-8000-000000000001",
          action_source: "website",
          event_source_url: URL_,
          user_data: {
            client_ip_address: "203.0.113.7",
            client_user_agent: "Mozilla/5.0 (test)",
            fbp: "fb.1.1764000000000.123456789",
          },
        },
      ],
    });
  });

  it("destinations without a builderKey keep using the mapper", async () => {
    const plain: DestinationDefinition = {
      ...destination(
        "plain.capi",
        "plain",
        undefined,
        "",
        { kind: "bearer" },
        "https://vendor.test/events",
      ),
    };
    const w = world([plain]);
    await receiveAndDeliver(w.deps, { envelope: envelope(), routing: w.routing });
    expect(w.calls[0]?.body).toEqual({ event_name: "form_submitted" });
    expect(w.calls[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });
});

describe("receiveAndDeliver: builder refusals are recorded as blocked", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  async function refused(
    dest: DestinationDefinition,
    env: EnrichedEnvelope,
    detail: string,
  ): Promise<void> {
    const w = world([dest]);
    const out = await receiveAndDeliver(w.deps, { envelope: env, routing: w.routing });

    expect(w.calls).toHaveLength(0);
    expect(out.results).toHaveLength(0);
    expect(out.renderFailures).toEqual([{ destination: dest.key, detail }]);

    const entry = out.record.destinationHistory.find((e) => e.destination === dest.key);
    expect(entry?.status).toBe("blocked");
    expect(entry?.attempts[0]?.error).toBe(`mapping: ${detail}`);
    expect(out.record.state).toBe("failed");
  }

  it("tiktok page_viewed", async () => {
    await refused(
      TIKTOK,
      envelope({ eventName: "page_viewed" }),
      "event not supported by tiktok.events.v1_3",
    );
  });

  it("ga4 without a client id", async () => {
    const base = envelope();
    await refused(
      GA4,
      envelope({
        context: {
          ...base.context,
          attribution: { ...base.context.attribution, browserIds: {} },
        },
      }),
      "ga4 client_id unavailable",
    );
  });

  it.each([
    ["meta", META],
    ["tiktok", TIKTOK],
    ["snap", SNAP],
    ["ga4", GA4],
  ] as const)("%s without an http(s) event source url", async (_name, dest) => {
    const base = envelope();
    await refused(
      dest,
      envelope({ context: { ...base.context, page: { url: "ftp://clinic.example/x" } } }),
      "event source url missing",
    );
  });

  it("snap without email, phone, or ip and user agent", async () => {
    await refused(
      SNAP,
      envelope({
        context: { page: { url: URL_ }, identity: { country: "EG", hashStatus: "raw" } },
      }),
      "snap matching data missing",
    );
  });

  it("snap purchase without a value", async () => {
    await refused(
      SNAP,
      envelope({ eventName: "purchase", payload: { orderId: "o-1" } }),
      "snap purchase value missing",
    );
  });

  it("a builder destination without a vendor target", async () => {
    const { vendorTarget: _target, ...noTarget } = META;
    await refused(noTarget, envelope(), "vendor target missing");
  });
});

describe("receiveAndDeliver: secrets never reach a record", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("query auth is added after the record is appended and never recorded", async () => {
    const w = world([META]);
    const out = await receiveAndDeliver(w.deps, { envelope: envelope(), routing: w.routing });

    expect(w.order).toEqual(["append", "http"]);
    expect(w.calls[0]?.url).toBe(
      `https://graph.facebook.com/v27.0/123456789012345/events?access_token=${encodeURIComponent(SECRET)}`,
    );
    expect(META.endpoint.url).not.toContain("access_token");

    const everything = JSON.stringify([out.record, w.appended, w.histories, w.deadLetters]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(encodeURIComponent(SECRET));
  });

  it("header auth sends Access-Token and nothing else carries the secret", async () => {
    const w = world([TIKTOK]);
    const out = await receiveAndDeliver(w.deps, { envelope: envelope(), routing: w.routing });

    expect(w.calls[0]?.headers["Access-Token"]).toBe(SECRET);
    expect(w.calls[0]?.headers.authorization).toBeUndefined();
    expect(w.calls[0]?.url).toBe("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    expect(JSON.stringify([out.record, w.histories, w.deadLetters])).not.toContain(SECRET);
  });

  it("an error echoing the url and a vendor body echoing the token are redacted everywhere", async () => {
    const encoded = encodeURIComponent(SECRET);
    let first = true;
    const w = world([META], {
      maxAttempts: 2,
      respond: () => {
        if (first) {
          first = false;
          return Promise.reject(
            new Error(`connect failed https://x.test/events?access_token=${SECRET}`),
          );
        }
        return Promise.resolve({
          status: 400,
          body: {
            error: { message: `bad token ${SECRET}`, trace: [`?access_token=${encoded}`] },
            [SECRET]: "key",
          },
        });
      },
    });

    const out = await receiveAndDeliver(w.deps, { envelope: envelope(), routing: w.routing });

    const outcome = out.results[0]?.result.outcome;
    expect(outcome?.status).toBe("dead_lettered");
    const deadLetterText = w.deadLetters.map((entry) =>
      Buffer.from((entry as { value: Uint8Array }).value).toString("utf8"),
    );
    const everything = JSON.stringify([
      out.record,
      w.appended,
      w.histories,
      w.deadLetters,
      deadLetterText,
      outcome,
    ]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(encoded);
    expect(META.endpoint.url).toBe("https://graph.facebook.com/v27.0/123456789012345/events");
  });
});

// ---------------------------------------------------------------------------
// Lead-site plan D1, Task 3 fix round 1.
// ---------------------------------------------------------------------------

/** Every textual form a recorded error could take: raw, JSON-parsed, unicode and slash escapes decoded. */
function decodings(text: string): string[] {
  const slashes = (s: string): string => s.replaceAll("\\/", "/");
  const out = [text, slashes(text)];
  const unicode = (s: string): string =>
    s.replaceAll(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  out.push(unicode(text), unicode(slashes(text)));
  try {
    out.push(JSON.stringify(JSON.parse(text)));
    out.push(JSON.parse(text) as string);
  } catch {
    // not JSON: the raw forms above already cover it
  }
  return out.map(String);
}

function expectNoCredential(text: string | undefined): void {
  expect(text).toBeDefined();
  for (const form of decodings(text ?? "")) {
    expect(form).not.toContain(SECRET);
    expect(form).not.toContain(encodeURIComponent(SECRET));
    expect(form).not.toContain("proof1234");
  }
}

describe("receiveAndDeliver: no vendor error text survives when a credential was used", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const escapedSlash = JSON.stringify({ message: `bad token ${SECRET}` }).replaceAll("/", "\\/");
  const unicodeSlash = JSON.stringify({ message: `bad token ${SECRET}` }).replaceAll(
    "/",
    "\\u002f",
  );

  async function failed(
    respond: () => Promise<{ status: number; error?: string; body?: Record<string, unknown> }>,
  ) {
    const w = world([META], { respond });
    const out = await receiveAndDeliver(w.deps, { envelope: envelope(), routing: w.routing });
    const outcome = out.results[0]?.result.outcome;
    expect(outcome?.status).toBe("dead_lettered");

    const attemptErrors = [
      out.record.destinationHistory[0]?.attempts.map((a) => a.error),
      w.appended.flatMap((r) =>
        r.destinationHistory.flatMap((d) => d.attempts.map((a) => a.error)),
      ),
      (w.histories as { destinations: { attempts: { error?: string }[] }[] }[]).flatMap((h) =>
        h.destinations.flatMap((d) => d.attempts.map((a) => a.error)),
      ),
    ].flat();
    const deadLetterErrors = (w.deadLetters as { error?: string }[]).map((e) => e.error);
    const outcomeError = (outcome as { error?: string } | undefined)?.error;
    return { w, out, outcomeError, attemptErrors, deadLetterErrors };
  }

  it.each([
    ["JSON-escaped slashes", escapedSlash],
    ["a unicode-escaped slash", unicodeSlash],
  ])(
    "a vendor error echoing the token with %s is replaced by the trusted status",
    async (_n, echoed) => {
      const r = await failed(() =>
        Promise.resolve({ status: 400, error: echoed, body: { message: `bad token ${SECRET}` } }),
      );

      expect(r.outcomeError).toBe("vendor responded 400");
      expectNoCredential(r.outcomeError);
      expect(r.attemptErrors.length).toBeGreaterThan(0);
      for (const e of r.attemptErrors) {
        expect(e).toContain("vendor responded 400");
        expectNoCredential(e);
      }
      expect(r.deadLetterErrors).toHaveLength(1);
      for (const e of r.deadLetterErrors) {
        expect(e).toBe("vendor responded 400");
        expectNoCredential(e);
      }
      const everything = JSON.stringify([
        r.out.record,
        r.w.appended,
        r.w.histories,
        r.w.deadLetters,
      ]);
      for (const form of decodings(everything)) expect(form).not.toContain(SECRET);
    },
  );

  it("a thrown error carrying the token keeps only its name", async () => {
    const r = await failed(() => {
      const thrown = new Error(JSON.stringify({ m: SECRET }).replaceAll("/", "\\u002f"));
      thrown.name = "ConnectError";
      return Promise.reject(thrown);
    });

    expect(r.outcomeError).toBe("transport error (ConnectError)");
    for (const e of [r.outcomeError, ...r.attemptErrors, ...r.deadLetterErrors]) {
      expect(e).toContain("transport error (ConnectError)");
      expectNoCredential(e);
    }
  });

  it("a thrown error whose name is not a plain identifier is recorded as Error", async () => {
    const r = await failed(() => {
      const thrown = new Error("boom");
      thrown.name = `bad ${SECRET}`;
      return Promise.reject(thrown);
    });
    expect(r.outcomeError).toBe("transport error (Error)");
    expectNoCredential(r.outcomeError);
  });
});

describe("receiveAndDeliver: the TikTok user object is never dropped", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const hashedNoBrowser = (): EnrichedEnvelope => {
    const base = envelope({}, { email: "h-em", phone: "h-ph", hashStatus: "sha256" });
    return {
      ...base,
      context: { ...base.context, technical: {}, attribution: {} },
    } as EnrichedEnvelope;
  };

  it("already-hashed identity and no ip, user agent, ttp or click id is blocked, with no HTTP", async () => {
    const w = world([TIKTOK]);
    const out = await receiveAndDeliver(w.deps, {
      envelope: hashedNoBrowser(),
      routing: w.routing,
    });

    expect(w.calls).toHaveLength(0);
    expect(out.results).toHaveLength(0);
    expect(out.renderFailures).toEqual([
      { destination: TIKTOK.key, detail: "tiktok user data missing" },
    ]);
    const entry = out.record.destinationHistory.find((e) => e.destination === TIKTOK.key);
    expect(entry?.status).toBe("blocked");
    expect(entry?.attempts[0]?.error).toBe("mapping: tiktok user data missing");
  });

  it("a sparse user (ip and user agent only) is sent with its user object", async () => {
    const base = hashedNoBrowser();
    const sparse = {
      ...base,
      context: {
        ...base.context,
        technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 (test)" },
      },
    } as EnrichedEnvelope;
    const w = world([TIKTOK]);
    await receiveAndDeliver(w.deps, { envelope: sparse, routing: w.routing });

    expect(w.calls).toHaveLength(1);
    const body = w.calls[0]?.body as { data: { user?: unknown }[] };
    expect(body.data[0]?.user).toEqual({ ip: "203.0.113.7", user_agent: "Mozilla/5.0 (test)" });
  });

  it("meta with nothing to put in user_data is blocked rather than sent without it", async () => {
    const w = world([META]);
    const out = await receiveAndDeliver(w.deps, {
      envelope: hashedNoBrowser(),
      routing: w.routing,
    });
    expect(w.calls).toHaveLength(0);
    expect(out.renderFailures).toEqual([
      { destination: META.key, detail: "meta user data missing" },
    ]);
  });
});
