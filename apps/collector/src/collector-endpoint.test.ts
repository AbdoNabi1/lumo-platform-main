/**
 * Collector endpoint tests.
 *
 * These drive the real `CollectorEndpoint`, the real `collect()` pipeline-free resolution logic, the
 * real `WriteKeyRegistry` and the real `JsonEventSerializer`. Only the broker is doubled — by a
 * publisher that records what it was asked to send, which is what lets these assert the exact bytes
 * and topic a consumer would receive.
 */

import { describe, expect, it } from "vitest";

import { JsonEventSerializer } from "@platform/domain-events";
import type { PublishRecord } from "@platform/messaging";
import type { TrackingCapturedEventPayload } from "@platform/tracking";

import { CollectorEndpoint, type CollectorEndpointDeps } from "./collector-endpoint";
import { WriteKeyRegistry, parseWriteKeyBindings } from "./write-key-registry";

const AT = new Date("2026-07-19T12:00:00.000Z");
const TENANT = "tenant-alpha";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

function recordingPublisher(fail = false) {
  const sent: PublishRecord[] = [];
  return {
    sent,
    publisher: {
      publish: (record: PublishRecord) => {
        if (fail) return Promise.reject(new Error("broker unreachable"));
        sent.push(record);
        return Promise.resolve();
      },
      publishBatch: () => Promise.resolve(),
    },
  };
}

function endpointWith(options: { fail?: boolean; trustedProxyCount?: number } = {}) {
  const broker = recordingPublisher(options.fail ?? false);
  let n = 0;

  const deps: CollectorEndpointDeps = {
    writeKeys: new WriteKeyRegistry(
      parseWriteKeyBindings(`wk_alpha:${TENANT}:store-1,wk_beta:tenant-beta`),
    ),
    idGenerator: { generate: () => `gen-${String((n += 1))}` },
    clock: { now: () => AT },
    ipPolicy: { trustedProxyCount: options.trustedProxyCount ?? 0 },
    publisher: broker.publisher,
    serializer: new JsonEventSerializer(),
    logger,
  };

  return { endpoint: new CollectorEndpoint(deps), sent: broker.sent };
}

function beacon(overrides: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  };
  return {
    body: {
      writeKey: "wk_alpha",
      event: {
        eventId: "01920000-0000-7000-8000-000000000001",
        eventName: "page_view",
        eventVersion: 1,
        timestamp: AT.toISOString(),
        environment: "production",
        consent: { analytics: true, marketing: true, personalization: true },
        context: { page: { url: "https://shop.example/p?gclid=G-1" } },
        properties: {},
        ...overrides,
      },
    },
    headers: (name: string): string | undefined => headers[name],
    cookies: (): string | undefined => undefined,
    remoteAddress: "203.0.113.7",
  };
}

/** Decodes what a consumer would actually receive. */
function decode(record: PublishRecord) {
  return JSON.parse(new TextDecoder().decode(record.value)) as {
    messageId: string;
    type: string;
    eventVersion: number;
    tenantId?: string;
    producer?: string;
    payload: TrackingCapturedEventPayload;
  };
}

describe("CollectorEndpoint — publishes exactly one event and runs no pipeline stage", () => {
  it("accepts a beacon and publishes one tracking.event.captured.v1", async () => {
    const { endpoint, sent } = endpointWith();

    const response = await endpoint.handle(beacon());

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.topic).toBe("tracking.event.captured.v1");

    const message = decode(sent[0] as PublishRecord);
    expect(message.type).toBe("tracking.event.captured");
    expect(message.eventVersion).toBe(1);
    expect(message.producer).toBe("tracking-collector");
    expect(message.tenantId).toBe(TENANT);
  });

  it("publishes ONE event per beacon — never a second, never a fan-out", async () => {
    const { endpoint, sent } = endpointWith();

    await endpoint.handle(beacon());
    await endpoint.handle(beacon({ eventId: "01920000-0000-7000-8000-000000000002" }));

    expect(sent).toHaveLength(2);
    expect(endpoint.counters()).toMatchObject({ received: 2, published: 2, refused: 0 });
    // Every message went to the one bridge topic. A second topic would mean a second ingress.
    expect(new Set(sent.map((record) => record.topic))).toEqual(
      new Set(["tracking.event.captured.v1"]),
    );
  });

  it("carries the RAW envelope — the collector resolves, it does not process", async () => {
    const { endpoint, sent } = endpointWith();
    await endpoint.handle(beacon());

    const { envelope } = decode(sent[0] as PublishRecord).payload;

    // Resolved (only a server can know these):
    expect(envelope.context.technical?.clientIpAddress).toBe("203.0.113.7");
    expect(envelope.context.technical?.deviceType).toBe("desktop");
    expect(envelope.context.session?.sessionId).toBeDefined();
    expect(envelope.context.attribution?.clickIds?.[0]?.name).toBe("gclid");
    expect(envelope.receivedAt).toBe(AT.toISOString());

    // NOT processed — every one of these is a pipeline stage's output and must be absent. If the
    // collector ever started normalizing or hashing, the pipeline would then do it again, and
    // `DoubleHashError` exists because that failure is otherwise silent.
    expect(envelope.dedupId).toBeUndefined();
    expect(envelope.context.identity?.hashStatus).toBeUndefined();
    expect(envelope.context.attribution?.channelGroup).toBeUndefined();
    expect(envelope.context.attribution?.touchIndex).toBeUndefined();
  });

  it("uses the envelope's eventId as the messageId, so a beacon retry is deduped end to end", async () => {
    const { endpoint, sent } = endpointWith();
    await endpoint.handle(beacon());

    const message = decode(sent[0] as PublishRecord);
    // The runtime consumer dedups on `messageId` via ProcessedEventStore. Minting a fresh id here
    // would silently turn one occurrence into two records on a flaky connection.
    expect(message.messageId).toBe("01920000-0000-7000-8000-000000000001");
    expect(message.payload.envelope.eventId).toBe(message.messageId);
  });

  it("partitions by tenant so one merchant's spike cannot reorder another's", async () => {
    const { endpoint, sent } = endpointWith();
    await endpoint.handle(beacon());
    expect(sent[0]?.key).toBe(TENANT);
  });

  it("answers 503 and does NOT claim acceptance when the broker is down", async () => {
    const { endpoint, sent } = endpointWith({ fail: true });

    const response = await endpoint.handle(beacon());

    // A 202 here would tell the SDK to drop its retry for an event that reached nothing.
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ retryable: true });
    expect(sent).toHaveLength(0);
    expect(endpoint.counters().publishFailed).toBe(1);
    // Cookies are still set: the ids are valid regardless, and re-minting on retry would fragment
    // the visitor's session.
    expect(response.cookies.length).toBeGreaterThan(0);
  });

  it("refuses an unknown write key with 400 and publishes nothing", async () => {
    const { endpoint, sent } = endpointWith();
    const request = beacon();

    const response = await endpoint.handle({
      ...request,
      body: { ...request.body, writeKey: "wk_forged" },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "WRITE_KEY_UNKNOWN", retryable: false });
    expect(sent).toHaveLength(0);
  });

  it("files events under the write key's tenant, never a body-claimed one", async () => {
    const { endpoint, sent } = endpointWith();
    await endpoint.handle(beacon({ tenancy: { tenantId: "tenant-victim" } }));

    expect(decode(sent[0] as PublishRecord).tenantId).toBe(TENANT);
    expect(decode(sent[0] as PublishRecord).payload.envelope.tenancy?.tenantId).toBe(TENANT);
  });

  it("keeps refusals out of the published stream entirely", async () => {
    const { endpoint, sent } = endpointWith();

    await endpoint.handle({ ...beacon(), body: { writeKey: "wk_alpha" } }); // no event
    await endpoint.handle({ ...beacon(), body: null });
    await endpoint.handle(beacon({ environment: undefined }));

    expect(sent).toHaveLength(0);
    expect(endpoint.counters()).toMatchObject({ received: 3, published: 0, refused: 3 });
  });
});

describe("WriteKeyRegistry", () => {
  it("refuses to start when one key is bound to two tenants", () => {
    // Picking either would misfile one merchant's conversions into another's account.
    expect(
      () =>
        new WriteKeyRegistry([
          { writeKey: "wk", tenantId: "a" },
          { writeKey: "wk", tenantId: "b" },
        ]),
    ).toThrow(/more than one tenant/);
  });

  it("refuses an empty binding list rather than accepting nothing while looking healthy", () => {
    expect(() => parseWriteKeyBindings("")).toThrow(/empty/);
    expect(() => parseWriteKeyBindings("   ,  ")).toThrow(/empty/);
  });

  it("rejects a malformed binding instead of silently skipping it", () => {
    expect(() => parseWriteKeyBindings("wk_only_key")).toThrow(/malformed/);
  });

  it("parses key:tenant and key:tenant:store", () => {
    const bindings = parseWriteKeyBindings("wk_a:t1, wk_b:t2:s2");
    expect(bindings).toEqual([
      { writeKey: "wk_a", tenantId: "t1" },
      { writeKey: "wk_b", tenantId: "t2", storeId: "s2" },
    ]);
  });
});
