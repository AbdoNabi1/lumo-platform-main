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
import type {
  AdPlatform,
  CredentialPolicy,
  CredentialVaultPort,
  DeliverySyncPort,
} from "@platform/ad-platforms";
import { InMemoryAuditTrail } from "../../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "../server";

/**
 * Lead Site D1 Task 5: the REAL multi-mode admin pipeline (claims-based tenants, the real role table)
 * for the ad platform connection routes. Tokens are `<shop>-<role>` (`a-admin`, `b-viewer`, ...);
 * the token's claim is the shop, its role is the staff role. Only the Redis-shaped ports and the
 * credential vault are in-memory doubles. Every value here is a fake.
 */

export const API = "/api/v1";
export const SHOP_A = "tenant-a";
export const SHOP_B = "tenant-b";

export const META_ID = "12345678901234";
export const TIKTOK_CODE = "ABCDE12345";
export const SNAP_ID = "00000000-0000-4000-8000-000000000001";
export const GA4_ID = "G-ABCD1234";
export const FAKE_SECRET = "fake-secret-value-1234";
export const FAKE_SECRET_B = "other-fake-secret-5678";

type Role = "admin" | "operator" | "viewer";

function sessionsOf(): Record<string, AuthenticatedContext> {
  const sessions: Record<string, AuthenticatedContext> = {};
  for (const [short, tenant] of [
    ["a", SHOP_A],
    ["b", SHOP_B],
  ] as const) {
    for (const role of ["admin", "operator", "viewer"] as const satisfies readonly Role[]) {
      sessions[`${short}-${role}`] = {
        principal: { id: `staff-${short}-${role}`, kind: "staff", roles: [role] },
        claims: { tenant_id: tenant },
      };
    }
  }
  return sessions;
}

/** Marks every sealed value so a test can prove it never reaches a response. */
export function fakeRealVault(): CredentialVaultPort {
  return {
    backing: "real",
    seal: (tenantId: string, platform: AdPlatform, secret: string) =>
      Promise.resolve(`sealed|${tenantId}|${platform}|${Buffer.from(secret).toString("hex")}`),
    open: (_tenantId: string, _platform: AdPlatform, sealed: string) =>
      Promise.resolve(Buffer.from(sealed.split("|")[3] ?? "", "hex").toString()),
  };
}

export interface AdPlatformsAppOptions {
  /** Default: a fake vault whose `backing` is `real`. `none`: no vault is configured at all. */
  readonly vault?: CredentialVaultPort | "none";
  readonly credentialPolicy?: CredentialPolicy;
  readonly deliverySync?: DeliverySyncPort;
}

export interface AdPlatformsApp {
  readonly app: FastifyInstance;
  /** Tenant ids the delivery sync was asked for, in order. */
  readonly synced: string[];
}

export async function buildAdPlatformsApp(
  options: AdPlatformsAppOptions = {},
): Promise<AdPlatformsApp> {
  const clock: Clock = { now: () => new Date("2026-11-27T10:00:00.000Z") };
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
  const synced: string[] = [];
  const deliverySync: DeliverySyncPort = options.deliverySync ?? {
    sync: (tenantId) => {
      synced.push(tenantId);
      return Promise.resolve();
    },
  };
  const vault = options.vault === undefined ? fakeRealVault() : options.vault;
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
    ...(vault === "none" ? {} : { adPlatformCredentialVault: vault }),
    ...(options.credentialPolicy === undefined
      ? {}
      : { adPlatformCredentialPolicy: options.credentialPolicy }),
    adPlatformDeliverySync: deliverySync,
  });
  return { app, synced };
}

export function authed(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra };
}
