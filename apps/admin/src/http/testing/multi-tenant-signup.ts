import { generateKeyPairSync } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { JwtVerifier, NativeTokenIssuer, localKeyResolver } from "@platform/auth";
import type {
  AccessControl,
  Cache,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import type { EventSerializer } from "@platform/domain-events";
import { wireLicensing, type WiredLicensing } from "@platform/licensing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { createAdminHttpApi, type AdminHttpDeps } from "../server";

/**
 * Shared by the multi-tenant isolation suites (merchant onboarding, leads): the REAL multi-mode admin
 * pipeline (`createAdminHttpApi` with `tenantMode: "multi"`) over its own licensing instance, with the
 * Redis-shaped ports as in-memory doubles, plus the sign-up helpers. Extracted from
 * `merchant-onboarding-isolation.e2e.test.ts`.
 */

export const PLATFORM = "platform";
export const API = "/api/v1";
export const clock: Clock = { now: () => new Date("2026-10-16T00:00:00.000Z") };

function infra() {
  const kv = new Map<string, unknown>();
  const cache: Cache = {
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
  // A real fixed-window counter: the route's own limits (5/IP/hour, 3/email/hour) apply as configured.
  const rateLimiter: RateLimiter = {
    consume: (key, limit) => {
      const used = ((kv.get(`rl:${key}`) as number | undefined) ?? 0) + 1;
      kv.set(`rl:${key}`, used);
      return Promise.resolve({
        allowed: used <= limit,
        remaining: Math.max(0, limit - used),
        retryAfterMs: 1_000,
      });
    },
  };
  return { cache, idempotencyKeys, rateLimiter };
}

/** The "basic" plan, published, in the SAME licensing instance the app composes with. */
export async function seedBasicPlan(licensing: WiredLicensing): Promise<void> {
  const plan = await licensing.licensing.createPlan({
    key: "basic",
    name: "Basic",
    tier: "starter",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await licensing.licensing.createPlanDraft({
    planId,
    spec: {
      limits: { maxProducts: 100 },
      featureEntitlements: ["basic_reports"],
      pricing: {
        basePriceMinor: 49_900,
        currency: "EGP",
        billingCycle: "monthly",
        trialDays: 14,
        creditAllowances: {},
      },
    },
    tenantId: PLATFORM,
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  const published = await licensing.licensing.publishPlanVersion({
    planId,
    planVersionId,
    tenantId: PLATFORM,
  });
  if (published.status !== 200) {
    throw new Error(`seeding the basic plan failed: ${String(published.status)}`);
  }
}

export interface Store {
  readonly tenantId: string;
  readonly storeUrl: string;
  readonly token: string;
  readonly email: string;
}

export const PASSWORD = "correct horse battery staple";
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

/**
 * The real multi-mode admin pipeline over its own licensing instance. `accessControl` stays the server
 * default (permissive) unless a case needs the real role table.
 */
export interface BootOptions {
  /**
   * Required because this file is not a `.test.ts` file: `apps-no-testing-imports` forbids it
   * `@platform/domain-events/testing`, so each test passes `InMemoryEventSerializer` in.
   */
  readonly serializer: EventSerializer;
  readonly accessControl?: AccessControl;
  /** Extra deps for one suite (a Leads test seam, say); never overrides the multi-tenant wiring. */
  readonly extraDeps?: Partial<AdminHttpDeps>;
}

export async function bootMultiTenant(
  options: BootOptions,
): Promise<{ app: FastifyInstance; licensing: WiredLicensing }> {
  const { accessControl } = options;
  let n = 0;
  const idGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const { serializer } = options;
  // The app is built over THIS licensing instance, so the plan seeded afterwards is the plan sign-up
  // finds. (`createAdminHttpApi` forwards `licensing` to `wireAdmin`; no HTTP seeding needed.)
  const licensing = wireLicensing({ serializer, idGenerator, clock, platformTenantId: PLATFORM });

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const tokenIssuer = new NativeTokenIssuer({
    privateKey,
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
  });
  const resolver = localKeyResolver(tokenIssuer);
  // `JwtVerifier` is the Authenticator and the ClaimsAuthenticator in one: it already returns
  // `{ principal, claims }` with the token's `tenant_id` claim.
  const authenticator = new JwtVerifier({
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    getKey: (header, token) => resolver.then((getKey) => getKey(header, token)),
    logger: silent,
  });

  const fx = infra();
  const app = await createAdminHttpApi({
    ...options.extraDeps,
    tenantMode: "multi",
    tenantId: PLATFORM,
    serializer,
    idGenerator,
    clock,
    licensing,
    authenticator,
    ...(accessControl === undefined ? {} : { accessControl }),
    rateLimiter: fx.rateLimiter,
    idempotencyKeys: fx.idempotencyKeys,
    responseCache: fx.cache,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    staffTokenIssuer: tokenIssuer,
    adminPublicUrl: "https://admin.test",
    platformStoreDomain: "morbeh.test",
    // Without a verifier `verify` answers 409 "not configured" before it looks at ownership, which
    // would hide the 404 this suite is after. No domain here points at the platform.
    dnsVerifier: { pointsToPlatform: () => Promise.resolve(false) },
    defaultPlanKey: "basic",
  });
  return { app, licensing };
}

/** `POST /public/merchant-signup` as an anonymous caller naming the platform tenant. */
export function publicSignupPost(app: FastifyInstance, payload: unknown) {
  return app.inject({
    method: "POST",
    url: `${API}/public/merchant-signup`,
    headers: { "content-type": "application/json", "x-tenant-id": PLATFORM },
    payload: payload as object,
  });
}

/** Signs a store up through the real route and returns its tenant and owner token (201 or throws). */
export async function signUpStoreOf(
  app: FastifyInstance,
  storeName: string,
  email: string,
  siteType: "store" | "lead_site" = "store",
): Promise<Store> {
  const res = await publicSignupPost(app, {
    storeName,
    email,
    password: PASSWORD,
    country: "EG",
    siteType,
  });
  if (res.statusCode !== 201) {
    throw new Error(`sign-up of ${storeName} answered ${String(res.statusCode)}`);
  }
  const body = res.json<{
    tenantId: string;
    storeUrl: string;
    accessToken?: string;
    signInRequired?: boolean;
  }>();
  if (body.signInRequired !== undefined || body.accessToken === undefined) {
    throw new Error(`sign-up of ${storeName} did not sign the owner in`);
  }
  return { tenantId: body.tenantId, storeUrl: body.storeUrl, token: body.accessToken, email };
}
