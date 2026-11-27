import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { RoleTableAccessControl } from "@platform/auth";
import type {
  AuthenticatedIdentity,
  Authenticator,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
} from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
import { InMemoryAuditTrail } from "../../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "../server";
import type { TrackingEventSink } from "../public-tracking-routes";
import { signEdgeRequest } from "../tracking-edge-signature";

/** Low-entropy test value on purpose (secret scanners): not a credential. */
export const EDGE_SECRET = "edge-secret-for-tests-".padEnd(40, "0");
export const SHOP = "shop-edge-1";
export const NOW = new Date("2026-11-27T12:00:00.000Z");
export const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
export const COLLECT_URL = "/api/v1/public/tracking/collect";

export type PublishedRecord = Parameters<TrackingEventSink["publish"]>[0];

export interface EdgeApp {
  readonly app: FastifyInstance;
  readonly published: PublishedRecord[];
}

export interface EdgeAppOptions {
  /** `null` ⇒ the secret is not configured at all. */
  readonly secret?: string | null;
  /** Make `publish` throw, like an unreachable broker or database. */
  readonly failPublish?: boolean;
  /** No sink at all (a runtime whose transport could not be built). */
  readonly noSink?: boolean;
}

export async function buildEdgeApp(options: EdgeAppOptions = {}): Promise<EdgeApp> {
  const clock: Clock = { now: () => NOW };
  const published: PublishedRecord[] = [];
  const sink: TrackingEventSink = {
    publish: (record) => {
      if (options.failPublish === true) return Promise.reject(new Error("broker is down"));
      published.push(record);
      return Promise.resolve();
    },
  };
  const store = new Map<string, unknown>();
  const responseCache: Cache = {
    get: <T>(k: string) => Promise.resolve((store.get(k) as T | undefined) ?? null),
    set: (k, v) => {
      store.set(k, JSON.parse(JSON.stringify(v)));
      return Promise.resolve();
    },
    delete: (k) => {
      store.delete(k);
      return Promise.resolve();
    },
    has: (k) => Promise.resolve(store.has(k)),
  };
  const seen = new Set<string>();
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: (key): Promise<IdempotencyClaim | null> => {
      if (seen.has(key)) return Promise.resolve(null);
      seen.add(key);
      return Promise.resolve({ key, token: "t", release: () => Promise.resolve(seen.delete(key)) });
    },
  };
  const authenticator: Authenticator = {
    verify: () => Promise.resolve<AuthenticatedIdentity | null>(null),
  };
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `0192f0aa-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const secret = options.secret === undefined ? EDGE_SECRET : options.secret;
  const app = await createAdminHttpApi({
    serializer: new JsonEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    accessControl: new RoleTableAccessControl(),
    rateLimiter: {
      consume: () => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
    },
    idempotencyKeys,
    responseCache,
    ...(secret === null ? {} : { trackingEdgeSecret: secret }),
    ...(options.noSink === true ? {} : { trackingEventSink: sink }),
  });
  return { app, published };
}

/** A valid body: a canonical page view plus the visitor context the storefront saw. */
export function edgeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: SHOP,
    event: {
      eventName: "page_view",
      eventVersion: 1,
      timestamp: NOW.toISOString(),
      environment: "production",
      consent: { analytics: true, marketing: true, personalization: true },
      properties: {},
    },
    client: {
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      pageUrl: "https://shop.example/landing?gclid=CJ-abc&utm_source=google",
      referrer: "https://www.google.com/",
      cookies: { fbp: "fb.1.1764000000.1234567890" },
    },
    ...overrides,
  };
}

export interface SendOptions {
  readonly tenantHeader?: string;
  readonly timestamp?: number;
  readonly secret?: string;
  /** Overrides the computed signature (e.g. garbage, or one for a different body). */
  readonly signature?: string | null;
  readonly omitTimestamp?: boolean;
}

/** Serialises once and signs those exact bytes, like the storefront does. */
export function sendSigned(
  app: FastifyInstance,
  body: Record<string, unknown> = edgeBody(),
  options: SendOptions = {},
): Promise<LightMyRequestResponse> {
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? NOW_SECONDS;
  const signature =
    options.signature === undefined
      ? signEdgeRequest(options.secret ?? EDGE_SECRET, timestamp, raw)
      : options.signature;
  return app.inject({
    method: "POST",
    url: COLLECT_URL,
    headers: {
      "content-type": "application/json",
      "x-tenant-id": options.tenantHeader ?? SHOP,
      ...(options.omitTimestamp === true ? {} : { "x-mb-ts": String(timestamp) }),
      ...(signature === null ? {} : { "x-mb-sig": signature }),
    },
    payload: raw,
  });
}
