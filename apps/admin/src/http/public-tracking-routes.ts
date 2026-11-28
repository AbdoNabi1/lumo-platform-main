import { createHash } from "node:crypto";
import { z } from "zod";
import type { Clock, IdGenerator } from "@platform/contracts";
import { topicFor, type EventSerializer } from "@platform/domain-events";
import { defineRoute, type RouteDefinition, type TransportResponse } from "@platform/http";
import {
  collect,
  TRACKING_CAPTURED_TOPIC,
  TRACKING_CAPTURED_VERSION,
  gaClientIdFromCookie,
  isBusinessConversion,
  type CollectEnricher,
  type CollectorRefusal,
  type CookieDirective,
  type TrackingCapturedEventPayload,
  type TrackingEnvelope,
} from "@platform/tracking";
import { logger, ValidationError } from "@platform/utils";
import {
  EDGE_SIGNATURE_HEADER,
  EDGE_TIMESTAMP_HEADER,
  verifyEdgeRequest,
} from "./tracking-edge-signature";

/** Identifies this producer on the integration-event envelope, for tracing and audit. */
const PRODUCER = "tracking-edge";
/** A canonical event plus its client context is a few KB; anything near this is not one. */
const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one 401 body: a missing header, a stale timestamp and a wrong signature are indistinguishable. */
export const TRACKING_UNAUTHORIZED_BODY = {
  code: "UNAUTHORIZED",
  message: "Unauthorized",
} as const;

/**
 * Where an accepted event goes: the Postgres outbox under `EVENT_TRANSPORT=postgres`, the broker
 * under Kafka (chosen by the runtime). Structurally `EventPublisher.publish` from
 * `@platform/messaging`, restated here so this app takes no new package dependency.
 */
export interface TrackingEventSink {
  publish(record: {
    readonly topic: string;
    readonly key: string;
    readonly value: Uint8Array;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<void>;
}

/**
 * Cookie Keeper (P1-D6): the vendor cookies the visitor's browser lacks and their profile still holds,
 * as first-party `Set-Cookie` directives. Tenant and visitor come from the SIGNED body, never from a
 * header; `present` is the set of cookie names the storefront saw on the request.
 */
export type TrackingCookieKeeper = (input: {
  readonly tenantId: string;
  readonly visitorId: string;
  readonly present: ReadonlySet<string>;
}) => Promise<readonly CookieDirective[]>;

/**
 * The per-store IP block list as the collect route needs it (P1-D9): `true` skips an ordinary event. Implemented by
 * `BlockedIpService.isBlocked`, which fails open — an unreadable list blocks nothing.
 */
export interface TrackingIpBlocklist {
  isBlocked(tenantId: string, ip: string | null | undefined): Promise<boolean>;
}

export interface PublicTrackingRouteDeps {
  /** `TRACKING_EDGE_SECRET`. Absent ⇒ the route answers 503 NOT_CONFIGURED and stores nothing. */
  readonly secret: string | undefined;
  /** Absent (profiles not enabled) ⇒ the response simply lists no cookies. */
  readonly cookieKeeper?: TrackingCookieKeeper;
  /** Collect-time enrichment (P1-D8): user agent, bot score, geo, AI source, cookieless id. Absent ⇒ events go as built. */
  readonly enricher?: CollectEnricher;
  /** The store's manual IP block list (P1-D9). Absent ⇒ nothing is blocked. */
  readonly blocklist?: TrackingIpBlocklist;
  readonly sink: TrackingEventSink | undefined;
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** The cookies the storefront server forwards. Each is optional and opaque; none is trusted for tenancy. */
const clientCookies = z
  .object({
    fbp: z.string().max(512).optional(),
    fbc: z.string().max(512).optional(),
    ttp: z.string().max(512).optional(),
    scid: z.string().max(512).optional(),
    ga: z.string().max(512).optional(),
    visitorId: z.string().max(128).optional(),
    sessionId: z.string().max(128).optional(),
    // Presence of the rest of the Cookie Keeper list (P1-D6), so the keeper never restores over a live cookie.
    ttclid: z.string().max(1024).optional(),
    scclid: z.string().max(512).optional(),
    gclAw: z.string().max(512).optional(),
    liFatId: z.string().max(512).optional(),
    epik: z.string().max(512).optional(),
  })
  .strict();

/** Client-cookie field → the cookie name the browser holds it under (Cookie Keeper presence check). */
const PRESENCE_COOKIE_NAMES: Readonly<Record<string, string>> = {
  fbp: "_fbp",
  fbc: "_fbc",
  ttp: "_ttp",
  scid: "_scid",
  ga: "_ga",
  ttclid: "ttclid",
  scclid: "_scclid",
  gclAw: "_gcl_aw",
  liFatId: "li_fat_id",
  epik: "_epik",
};

const edgeBody = z
  .object({
    /** The shop the STOREFRONT resolved from the host. Must equal the transport-resolved tenant. */
    tenantId: z.string().min(1).max(128),
    /** The canonical event (`TrackingEnvelope` shape); `collect()` validates and completes it. */
    event: z.record(z.string(), z.unknown()),
    client: z
      .object({
        ip: z.string().max(64).nullable(),
        userAgent: z.string().max(512).nullable(),
        pageUrl: z.string().max(2048).nullable(),
        referrer: z.string().max(2048).nullable(),
        // Headers a real browser always sends (bot score, P1-D8). Optional: an older storefront build omits them,
        // and the runtime then scores nothing on them rather than reading "absent" as "bot".
        acceptLanguage: z.string().max(256).nullable().optional(),
        secChUa: z.string().max(512).nullable().optional(),
        host: z.string().max(255).nullable().optional(),
        cookies: clientCookies,
      })
      .strict(),
  })
  .strict();

type EdgeBody = z.infer<typeof edgeBody>;

/** Any JSON object: the signature is checked on the raw bytes BEFORE the body is looked at. */
const anyBody = z.object({}).passthrough();

function headerOf(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The outbox row id, the ingest inbox key and the Kafka message id of one event. `outbox.id` and the
 * inbox `message_id` are UUID columns, but a server-side event id may be a business id (`lead_<id>`),
 * so a non-UUID is mapped to a stable UUID derived from the tenant and the id: the same event always
 * gets the same message id, which is what makes a retried or replayed request collapse into one row.
 */
export function trackingMessageId(tenantId: string, eventId: string): string {
  if (UUID.test(eventId)) return eventId.toLowerCase();
  const bytes = createHash("sha256").update(`${tenantId}\u0000${eventId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5 layout
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function refusalBody(refusal: CollectorRefusal): unknown {
  return {
    code: refusal.code.toUpperCase(),
    message: refusal.code === "validation_failed" ? "The event failed validation" : refusal.code,
    retryable: false,
  };
}

/** Merges the storefront's client context into the event so `collect()` sees one document. */
function withClientContext(body: EdgeBody): Record<string, unknown> {
  const { event, client } = body;
  const context = (event["context"] as Record<string, unknown> | undefined) ?? {};
  const page = (context["page"] as Record<string, unknown> | undefined) ?? {};
  const attribution = (context["attribution"] as Record<string, unknown> | undefined) ?? {};
  const browserIds = (attribution["browserIds"] as Record<string, unknown> | undefined) ?? {};
  const gaClientId = gaClientIdFromCookie(client.cookies.ga);

  return {
    ...event,
    context: {
      ...context,
      page: {
        ...(client.pageUrl === null ? {} : { url: client.pageUrl }),
        ...(client.referrer === null ? {} : { referrer: client.referrer }),
        ...page,
      },
      attribution: {
        ...attribution,
        browserIds: {
          ...(client.cookies.ttp === undefined ? {} : { ttp: client.cookies.ttp }),
          ...(client.cookies.scid === undefined ? {} : { scid: client.cookies.scid }),
          ...(gaClientId === null ? {} : { gaClientId }),
          ...browserIds,
        },
      },
    },
  };
}

/** Stamps the collect-time facts on the event; a failing enricher means the event goes out as it was built. */
async function enrichEnvelope(
  enricher: CollectEnricher | undefined,
  tenantId: string,
  envelope: TrackingEnvelope,
  body: EdgeBody,
): Promise<TrackingEnvelope> {
  if (enricher === undefined) return envelope;
  try {
    return await enricher({
      tenantId,
      envelope,
      signals: {
        ip: body.client.ip,
        userAgent: body.client.userAgent,
        acceptLanguage: body.client.acceptLanguage,
        secChUa: body.client.secChUa,
        host: body.client.host,
      },
    });
  } catch (cause) {
    logger.warn("tracking edge: enrichment failed", {
      error: cause instanceof Error ? cause.name : "unknown",
    });
    return envelope;
  }
}

async function restoreCookies(
  keeper: TrackingCookieKeeper | undefined,
  tenantId: string,
  cookies: EdgeBody["client"]["cookies"],
): Promise<readonly CookieDirective[]> {
  const visitorId = cookies.visitorId;
  if (keeper === undefined || visitorId === undefined || visitorId === "") return [];
  const present = new Set<string>();
  for (const [field, name] of Object.entries(PRESENCE_COOKIE_NAMES)) {
    const value = (cookies as Record<string, string | undefined>)[field];
    if (value !== undefined && value !== "") present.add(name);
  }
  try {
    return await keeper({ tenantId, visitorId, present });
  } catch (cause) {
    // Counts-only: the error name, never a message that could carry a row.
    logger.warn("tracking edge: cookie keeper failed", {
      error: cause instanceof Error ? cause.name : "unknown",
    });
    return [];
  }
}

/**
 * Tracking P1-D3: `POST /public/tracking/collect` — the runtime's capture entrance for the storefront
 * SERVER (never the browser). It is `public: true` only in the transport's sense (no bearer token);
 * the authentication IS the HMAC in `x-mb-sig`, checked on the raw bytes before anything else. The
 * tenant is the storefront-resolved shop inside the SIGNED body and must equal the one the transport
 * resolved from `x-tenant-id` — a client header alone can never choose a tenant.
 *
 * The body carries the canonical event plus the visitor's context as the storefront saw it (ip, user
 * agent, page url, referrer, a cookie subset); `collect()` completes and validates it exactly as it
 * does for the standalone collector, and the result is published to `tracking.event.captured.v1`.
 */
export function publicTrackingRoutes(deps: PublicTrackingRouteDeps): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/public/tracking/collect",
      version: 1,
      permission: "tracking:collect",
      public: true,
      summary:
        "Public: accept a canonical tracking event from the storefront server (HMAC-signed with TRACKING_EDGE_SECRET)",
      schema: { body: anyBody },
      handle: async ({ context }): Promise<TransportResponse> => {
        if (deps.secret === undefined) {
          // Fail safe: nothing is collected, nothing crashes, and the storefront sends nothing more.
          return {
            status: 503,
            body: {
              code: "NOT_CONFIGURED",
              message: "Tracking capture is not configured",
              retryable: false,
            },
          };
        }
        if (deps.sink === undefined) {
          return {
            status: 503,
            body: {
              code: "UNAVAILABLE",
              message: "Tracking transport unavailable",
              retryable: true,
            },
          };
        }

        const rawBody = context.rawBody;
        if (rawBody === undefined) return { status: 401, body: TRACKING_UNAUTHORIZED_BODY };
        if (rawBody.byteLength > MAX_BODY_BYTES) {
          return { status: 413, body: { code: "PAYLOAD_TOO_LARGE" } };
        }

        const verdict = verifyEdgeRequest({
          secret: deps.secret,
          signature: headerOf(context.headers, EDGE_SIGNATURE_HEADER),
          timestamp: headerOf(context.headers, EDGE_TIMESTAMP_HEADER),
          rawBody,
          nowMs: deps.clock.now().getTime(),
        });
        if (!verdict.ok) {
          // Counts-only: the reason class, never a header value, the body or the secret.
          logger.warn("tracking edge: request refused", { reason: verdict.reason });
          return { status: 401, body: TRACKING_UNAUTHORIZED_BODY };
        }

        const parsed = edgeBody.safeParse(JSON.parse(new TextDecoder().decode(rawBody)) as unknown);
        if (!parsed.success) {
          throw new ValidationError(
            "Invalid request body",
            parsed.error.issues.map((issue) => ({
              field: issue.path.join("."),
              message: issue.message,
            })),
          );
        }
        const body = parsed.data;
        if (body.tenantId !== context.tenantId) {
          return {
            status: 403,
            body: { code: "TENANT_MISMATCH", message: "Tenant mismatch", retryable: false },
          };
        }

        const tenantId = body.tenantId;
        const cookieJar: Readonly<Record<string, string | undefined>> = {
          _fbp: body.client.cookies.fbp,
          _fbc: body.client.cookies.fbc,
          morbeh_vid: body.client.cookies.visitorId,
          morbeh_sid: body.client.cookies.sessionId,
        };
        const outcome = collect(
          {
            body: { writeKey: tenantId, event: withClientContext(body) },
            headers: (name) =>
              name === "user-agent" ? (body.client.userAgent ?? undefined) : undefined,
            cookies: (name) => cookieJar[name],
            // The storefront already applied its trusted-proxy rule (P1-D7): this IS the client IP.
            ...(body.client.ip === null ? {} : { remoteAddress: body.client.ip }),
          },
          {
            // The write key is the signed tenant itself: no static key table on this route.
            writeKeys: { resolve: (key) => (key === tenantId ? { tenantId } : null) },
            idGenerator: deps.idGenerator,
            clock: deps.clock,
            ipPolicy: { trustedProxyCount: 0 },
          },
        );

        if (outcome.status === "refused") {
          logger.warn("tracking edge: event refused", { code: outcome.refusal.code });
          return { status: 422, body: refusalBody(outcome.refusal) };
        }

        // P2-D10: the browser's dedup id was invalid and replaced (ingest keys the event by its event id). A count only.
        if (outcome.dedupIdReplaced === true) {
          logger.warn("tracking edge: browser dedup id replaced", { count: 1 });
        }

        // The block list (P1-D9): an ordinary event from a listed address is accepted and dropped here — the
        // storefront is told 202 so it neither retries nor treats it as an error. An order or a lead is never
        // dropped, whatever the address. The check fails open (service) and so does this wrapper.
        if (
          deps.blocklist !== undefined &&
          body.client.ip !== null &&
          !isBusinessConversion(outcome.envelope)
        ) {
          const blocked = await deps.blocklist
            .isBlocked(tenantId, body.client.ip)
            .catch(() => false);
          if (blocked) {
            return {
              status: 202,
              body: { eventId: outcome.envelope.eventId, skipped: "blocked_ip", cookies: [] },
            };
          }
        }

        const envelope = await enrichEnvelope(deps.enricher, tenantId, outcome.envelope, body);
        const messageId = trackingMessageId(tenantId, envelope.eventId);
        const payload: TrackingCapturedEventPayload = { envelope };
        const serialized = deps.serializer.serialize({
          messageId,
          type: TRACKING_CAPTURED_TOPIC,
          eventVersion: TRACKING_CAPTURED_VERSION,
          aggregateId: envelope.eventId,
          aggregateType: "tracking_event",
          occurredAt: envelope.timestamp,
          correlationId: envelope.eventId,
          causationId: envelope.eventId,
          tenantId,
          producer: PRODUCER,
          payload,
          metadata: {},
        });

        try {
          await deps.sink.publish({
            topic: topicFor(TRACKING_CAPTURED_TOPIC, TRACKING_CAPTURED_VERSION),
            // Partitioned by tenant so one merchant's spike cannot reorder another's.
            key: tenantId,
            value: serialized.data,
            headers: {
              messageId,
              type: TRACKING_CAPTURED_TOPIC,
              eventVersion: String(TRACKING_CAPTURED_VERSION),
              contentType: serialized.contentType,
              "content-type": serialized.contentType,
              correlationId: envelope.eventId,
              causationId: envelope.eventId,
              tenantId,
              producer: PRODUCER,
            },
          });
        } catch (cause) {
          // 503, not 202: telling the storefront "accepted" for an event that never reached the
          // queue loses it silently. A 5xx lets the caller retry, and the stable message id makes the
          // retry idempotent.
          logger.error("tracking edge: publish failed", {
            tenantId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
          return {
            status: 503,
            body: {
              code: "PUBLISH_FAILED",
              message: "Event could not be accepted; retry",
              retryable: true,
            },
          };
        }

        // Cookie Keeper (P1-D6): the storefront re-emits whatever is listed here as first-party
        // Set-Cookie. It never changes the answer: a failing keeper means "no cookies", not an error,
        // because the event is already safely queued.
        const cookies = await restoreCookies(deps.cookieKeeper, tenantId, body.client.cookies);
        return { status: 202, body: { eventId: envelope.eventId, cookies } };
      },
    }),
  ] as readonly RouteDefinition[];
}
