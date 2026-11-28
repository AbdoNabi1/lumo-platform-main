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
  RateLimiter,
} from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
import type { LeadTrackingPort } from "@platform/leads";
import type { LeadEmissionLedgerPort } from "@platform/tracking";
import { tenancyShopFacts } from "../../infrastructure/cross-context/leads-shop-facts.adapter";
import { InMemoryAuditTrail } from "../../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "../server";
import { countingLimiter, headersFor, type StaffRole } from "./online-store-harness";

export { countingLimiter, headersFor, type StaffRole };

export interface LeadsAppOptions {
  /** The shop's site type as tenancy reports it. Default `lead_site`. */
  readonly siteType?: "store" | "lead_site";
  /** The shop's currency as tenancy reports it. Default `EGP` (calling code 20). */
  readonly currency?: string;
  /** Default: allows everything. Pass `countingLimiter()` or a throwing one to drive the limits. */
  readonly rateLimiter?: RateLimiter;
  /**
   * `reject`: the tenancy read throws. `non-200`: tenancy answers 503. Both go through the REAL
   * `tenancyShopFacts` adapter, so the route's 503 is the adapter's `UNAVAILABLE`.
   */
  readonly shopFactsFail?: "reject" | "non-200";
  /** Tracking P2-D9: where a saved lead is sent as a server event. Absent ⇒ none (the lead stays pending). */
  readonly leadTracking?: LeadTrackingPort;
}

export interface LeadsApp {
  readonly app: FastifyInstance;
  /** Every key `claimOnce` was asked for (the once-per-session claim), in order. */
  readonly claims: string[];
  /** How many times the tenancy-backed shop-facts read ran. */
  readonly shopReads: { count: number };
}

/** A recording once-per-key ledger: `claimOnce` is true only the first time a key is seen. */
function recordingLedger(claims: string[]): LeadEmissionLedgerPort {
  const seen = new Set<string>();
  return {
    claimOnce: (key) => {
      claims.push(key);
      if (seen.has(key)) return Promise.resolve(false);
      seen.add(key);
      return Promise.resolve(true);
    },
    extend: () => Promise.resolve(),
  };
}

/**
 * The real admin HTTP pipeline (`createAdminHttpApi`, single mode, header tenant) with the real role
 * table, a persistent response cache and idempotency claims, and the leads shop facts injected through
 * `AdminHttpDeps.leadsShopFacts`. The bearer token IS the role; `x-tenant-id` picks the shop.
 */
export async function buildLeadsApp(options: LeadsAppOptions = {}): Promise<LeadsApp> {
  const clock: Clock = { now: () => new Date("2026-11-23T10:00:00.000Z") };
  const claimsOfRequests = new Set<string>();
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
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: (key): Promise<IdempotencyClaim | null> => {
      if (claimsOfRequests.has(key)) return Promise.resolve(null);
      claimsOfRequests.add(key);
      return Promise.resolve({
        key,
        token: "t",
        release: () => Promise.resolve(claimsOfRequests.delete(key)),
      });
    },
  };
  const authenticator: Authenticator = {
    verify: (token) =>
      Promise.resolve<AuthenticatedIdentity | null>(
        token === "admin" || token === "operator" || token === "viewer"
          ? { id: `staff-${token}`, kind: "staff", roles: [token] }
          : null,
      ),
  };
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `0192f0aa-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const claims: string[] = [];
  const shopReads = { count: 0 };
  const getPublicStore = (): Promise<{ readonly status: number; readonly body: unknown }> => {
    shopReads.count += 1;
    if (options.shopFactsFail === "reject") return Promise.reject(new Error("tenancy is down"));
    if (options.shopFactsFail === "non-200") return Promise.resolve({ status: 503, body: null });
    return Promise.resolve({
      status: 200,
      body: {
        name: "Test Clinic",
        currency: options.currency ?? "EGP",
        siteType: options.siteType ?? "lead_site",
      },
    });
  };
  const app = await createAdminHttpApi({
    serializer: new JsonEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    accessControl: new RoleTableAccessControl(),
    rateLimiter: options.rateLimiter ?? {
      consume: () => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
    },
    idempotencyKeys,
    responseCache,
    leadEmissionLedger: recordingLedger(claims),
    leadsShopFacts: tenancyShopFacts(getPublicStore),
    ...(options.leadTracking === undefined ? {} : { leadTracking: options.leadTracking }),
  });
  return { app, claims, shopReads };
}

/** A valid `POST /public/leads` body; override any field. */
export function leadBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formId: "home-form",
    name: "Mona Ali",
    phone: "01012345678",
    email: "mona@example.com",
    message: "I would like to book a visit",
    sessionId: "session-0001",
    sessionAlreadyEmitted: false,
    spamSignals: { honeypot: false, elapsedMs: 8_000 },
    context: {
      pageUrl: "https://clinic.example.test/",
      referrer: null,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      cookies: {},
    },
    ...overrides,
  };
}

let keyCounter = 0;
/** A fresh valid `Idempotency-Key` (8-128 letters, digits, hyphens). */
export function freshKey(): string {
  keyCounter += 1;
  return `lead-key-${String(keyCounter).padStart(6, "0")}`;
}

/** The anonymous visitor's submit (no token; the shop comes from `x-tenant-id`). */
export function submitLead(
  app: FastifyInstance,
  body: Record<string, unknown> = leadBody(),
  options: {
    readonly key?: string | null;
    readonly tenantId?: string;
    readonly remoteAddress?: string;
  } = {},
): Promise<LightMyRequestResponse> {
  const key = options.key === undefined ? freshKey() : options.key;
  return app.inject({
    method: "POST",
    url: "/api/v1/public/leads",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": options.tenantId ?? "t-1",
      ...(key === null ? {} : { "idempotency-key": key }),
    },
    ...(options.remoteAddress === undefined ? {} : { remoteAddress: options.remoteAddress }),
    payload: body,
  });
}
