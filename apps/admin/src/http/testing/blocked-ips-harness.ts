import type { FastifyInstance } from "fastify";
import { RoleTableAccessControl } from "@platform/auth";
import type {
  AuthenticatedContext,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  IdGenerator,
  RateLimiter,
} from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
import { BlockedIpService, InMemoryBlockedIpStore } from "@platform/tracking";
import { InMemoryAuditTrail } from "../../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "../server";

/**
 * Tracking P1-D9: the REAL multi-mode admin pipeline (claims-based tenants, the real role table) for the excluded-IP
 * routes. Tokens are `<shop>-<role>` (`a-admin`, `b-viewer`, …): the token's claim is the shop, its role the staff
 * role. Only the Redis-shaped ports and the list's store are in-memory doubles.
 */

export const API = "/api/v1";
export const SHOP_A = "tenant-a";
export const SHOP_B = "tenant-b";

function sessionsOf(): Record<string, AuthenticatedContext> {
  const sessions: Record<string, AuthenticatedContext> = {};
  for (const [short, tenant] of [
    ["a", SHOP_A],
    ["b", SHOP_B],
  ] as const) {
    for (const role of ["admin", "operator", "viewer"] as const) {
      sessions[`${short}-${role}`] = {
        principal: { id: `staff-${short}-${role}`, kind: "staff", roles: [role] },
        claims: { tenant_id: tenant },
      };
    }
  }
  return sessions;
}

export interface BlockedIpsApp {
  readonly app: FastifyInstance;
  readonly service: BlockedIpService;
  readonly store: InMemoryBlockedIpStore;
}

export async function buildBlockedIpsApp(): Promise<BlockedIpsApp> {
  const clock: Clock = { now: () => new Date("2026-11-28T10:00:00.000Z") };
  const kv = new Map<string, unknown>();
  const responseCache: Cache = {
    get: <T>(k: string) => Promise.resolve((kv.get(`cache:${k}`) as T | undefined) ?? null),
    set: (k, v) => Promise.resolve(void kv.set(`cache:${k}`, JSON.parse(JSON.stringify(v)))),
    delete: (k) => Promise.resolve(void kv.delete(`cache:${k}`)),
    has: (k) => Promise.resolve(kv.has(`cache:${k}`)),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: (key): Promise<IdempotencyClaim | null> => {
      if (kv.has(`idem:${key}`)) return Promise.resolve(null);
      kv.set(`idem:${key}`, true);
      return Promise.resolve({
        key,
        token: "t",
        release: () => Promise.resolve(kv.delete(`idem:${key}`)),
      });
    },
  };
  const rateLimiter: RateLimiter = {
    consume: () => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const sessions = sessionsOf();
  const authenticator: ClaimsAuthenticator = {
    verify: (token) => Promise.resolve(sessions[token]?.principal ?? null),
    verifyWithClaims: (token) => Promise.resolve(sessions[token] ?? null),
  };
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `0192f0aa-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const store = new InMemoryBlockedIpStore();
  const service = new BlockedIpService({ store, clock, idGenerator, cacheTtlMs: 0 });
  const app = await createAdminHttpApi({
    tenantMode: "multi",
    tenantGate: { availability: () => Promise.resolve("active" as const) },
    serializer: new JsonEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    accessControl: new RoleTableAccessControl(),
    rateLimiter,
    idempotencyKeys,
    responseCache,
    trackingBlockedIps: service,
  });
  return { app, service, store };
}

export function authed(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra };
}
