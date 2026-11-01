import type { FastifyInstance } from "fastify";
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
import type { EventSerializer } from "@platform/domain-events";
import type { ObjectStoragePort } from "@platform/media";
import type { StorefrontPasswordHasher } from "@platform/online-store";
import { InMemoryAuditTrail } from "../../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "../server";

export type StaffRole = "admin" | "operator" | "viewer";

/** Fake values only. The bearer token IS the role, so a test reads like the permission table. */
export function headersFor(
  role: StaffRole,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    authorization: `Bearer ${role}`,
    "x-tenant-id": "t-1",
    "content-type": "application/json",
    ...extra,
  };
}

/** Counts per key and refuses beyond `limit`, like the Redis limiter. */
export function countingLimiter(): RateLimiter & { readonly keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    consume: (key, limit) => {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve(
        n > limit
          ? { allowed: false, remaining: 0, retryAfterMs: 120_000 }
          : { allowed: true, remaining: limit - n, retryAfterMs: 0 },
      );
    },
  };
}

/** A fast deterministic hasher (the real scrypt is exercised in the adapters test). */
export const fastHasher: StorefrontPasswordHasher = {
  hash: (plain) => Promise.resolve(`fake$${plain}`),
  verify: (plain, hash) => Promise.resolve(hash === `fake$${plain}`),
};

export function recordingStorage(keys: string[]): ObjectStoragePort {
  return {
    persistent: true,
    exists: () => Promise.resolve(true),
    getDownloadUrl: (key) => Promise.resolve(`https://signed.example/${key}`),
    put: (key) => {
      keys.push(key);
      return Promise.resolve();
    },
  };
}

export interface OnlineStoreAppOptions {
  /**
   * Required because this file is not a `.test.ts` file: `apps-no-testing-imports` forbids it
   * `@platform/domain-events/testing`, so each test passes `InMemoryEventSerializer` in.
   */
  readonly serializer: EventSerializer;
  readonly rateLimiter?: RateLimiter;
  readonly objectStorage?: ObjectStoragePort;
  /** The idempotency response cache's contents, so a test can read what could be replayed. */
  readonly responseStore?: Map<string, unknown>;
}

export function buildOnlineStoreApp(options: OnlineStoreAppOptions): Promise<FastifyInstance> {
  const clock: Clock = { now: () => new Date("2026-10-27T10:00:00.000Z") };
  const claims = new Set<string>();
  const store = options.responseStore ?? new Map<string, unknown>();
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
      if (claims.has(key)) return Promise.resolve(null);
      claims.add(key);
      return Promise.resolve({
        key,
        token: "t",
        release: () => Promise.resolve(claims.delete(key)),
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
  return createAdminHttpApi({
    serializer: options.serializer,
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
    onlineStorePasswordHasher: fastHasher,
    ...(options.objectStorage === undefined
      ? {}
      : {
          objectStorage: options.objectStorage,
          publicMediaBaseUrl: "https://cdn.example.test/media",
        }),
  });
}
