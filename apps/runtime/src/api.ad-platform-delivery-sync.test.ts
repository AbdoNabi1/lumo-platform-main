import { wireAdPlatforms, type DeliverySyncPort } from "@platform/ad-platforms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdPlatformDelivery, buildRuntimeCore, prismaSiteTypeOf } from "./composition";
import { loadRuntimeConfig } from "./config";
import { ConnectionCredentialResolver } from "./tracking/connection-credential-resolver";
import { fakeTrackingDb } from "./tracking/testing/fake-tracking-db";

beforeEach(() => {
  expect.hasAssertions();
});

/**
 * Lead Site Part D1 (Task 4): `startApi()` hands the admin API the delivery sync the runtime built, and a save
 * through the controller composed the way the admin composes it reaches the REAL sync: the shop's tracking
 * registry gains its destination, and the sealed token opens again through the `conn://` resolver. Same
 * mock-and-inspect-the-call convention as `api.ad-platform-vault.test.ts`.
 */

const { mockCreateAdminHttpApi } = vi.hoisted(() => ({
  mockCreateAdminHttpApi: vi.fn(
    async (_deps: { adPlatformDeliverySync?: unknown; adPlatformCredentialVault?: unknown }) => ({
      listen: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    }),
  ),
}));

vi.mock("@platform/admin", () => ({
  createAdminHttpApi: mockCreateAdminHttpApi,
  LoggingEmailSender: class {
    send() {
      return Promise.resolve();
    }
  },
  ResendEmailSender: class {
    send() {
      return Promise.resolve();
    }
  },
  ResendStoreEmailProvider: class {
    send() {
      return Promise.resolve({ ok: true });
    }
  },
}));

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:***@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
} as NodeJS.ProcessEnv;

const SECRET = "EAAB1234567890abcdSYNCWIRING";
const KEK = "a-runtime-test-kek-ref-0123456789-abcdef";

describe("startApi() wires the ad platform delivery sync into the admin API", () => {
  beforeEach(() => {
    mockCreateAdminHttpApi.mockClear();
  });

  it("passes the runtime's sync, and a save through it reaches the real sync and the conn:// resolver", async () => {
    const { startApi } = await import("./api");
    const env = { ...validEnv, AD_PLATFORM_CREDENTIALS_KEK_REF: KEK };
    const core = buildRuntimeCore(loadRuntimeConfig(env));
    expect(core.adPlatformDeliverySync).toBeDefined();
    expect(core.adPlatformConnections).toBeDefined();

    // The same composition over a fake database, so what the sync writes can be inspected.
    const db = fakeTrackingDb();
    const vault = core.adPlatformCredentialVault;
    expect(vault).toBeDefined();
    const delivery = buildAdPlatformDelivery({
      prisma: db.prisma,
      vault: vault as NonNullable<typeof vault>,
      clock: core.clock,
      idGenerator: core.idGenerator,
      ruleSetKey: "tracking.routing.default",
    });
    await startApi(loadRuntimeConfig(env), {
      ...core,
      adPlatformDeliverySync: delivery.sync,
      adPlatformConnections: delivery.connections,
    });

    expect(mockCreateAdminHttpApi).toHaveBeenCalledTimes(1);
    const [deps] = mockCreateAdminHttpApi.mock.calls[0] ?? [];
    const sync = deps?.adPlatformDeliverySync as DeliverySyncPort | undefined;
    expect(sync).toBe(delivery.sync);

    // The admin composes the controller the way Task 5 will: the connection store is the same database.
    db.siteTypes.set("t-1", "lead_site");
    const wired = wireAdPlatforms({
      clock: core.clock,
      idGenerator: core.idGenerator,
      prisma: db.prisma,
      vault: vault as NonNullable<typeof vault>,
      ...(sync === undefined ? {} : { deliverySync: sync }),
    });
    const response = await wired.controller.save({
      tenantId: "t-1",
      platform: "meta",
      enabled: true,
      publicConfig: { platform: "meta", pixelId: "123456789012345" },
      secret: SECRET,
      expectedVersion: 0,
    });
    expect(response.status).toBe(200);

    expect(db.entries.map((e) => `${e.kind}:${e.key}@${String(e.version)}:${e.tenantId}`)).toEqual([
      "destination:meta.capi@1:t-1",
      "mapping:meta.capi.v27@1:t-1",
      "rule_set:tracking.routing.default@1:t-1",
    ]);
    expect(JSON.stringify(db.entries)).not.toContain(SECRET);
    expect(JSON.stringify(response.body)).not.toContain(SECRET);

    const resolver = new ConnectionCredentialResolver({
      connections: delivery.connections,
      fallback: { resolve: () => Promise.resolve(null) },
    });
    await expect(resolver.resolve("conn://t-1/meta")).resolves.toBe(SECRET);
    await expect(resolver.resolve("conn://t-2/meta")).resolves.toBeNull();
  });

  it("passes no sync without the KEK (no real vault ⇒ no destinations from connections)", async () => {
    const { startApi } = await import("./api");
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    expect(core.adPlatformDeliverySync).toBeUndefined();
    expect(core.adPlatformConnections).toBeUndefined();

    await startApi(loadRuntimeConfig(validEnv), core);

    const [deps] = mockCreateAdminHttpApi.mock.calls[0] ?? [];
    expect(deps?.adPlatformDeliverySync).toBeUndefined();
  });
});

describe("prismaSiteTypeOf", () => {
  it("reads the shop's site type, defaulting to store when it never saved settings", async () => {
    const db = fakeTrackingDb();
    db.siteTypes.set("t-lead", "lead_site");
    db.siteTypes.set("t-store", "store");
    const read = prismaSiteTypeOf(db.prisma);

    await expect(read("t-lead")).resolves.toBe("lead_site");
    await expect(read("t-store")).resolves.toBe("store");
    await expect(read("t-none")).resolves.toBe("store");
  });

  it("throws on a stored value that is not a site type, rather than guessing", async () => {
    const db = fakeTrackingDb();
    db.siteTypes.set("t-bad", "kiosk");
    await expect(prismaSiteTypeOf(db.prisma)("t-bad")).rejects.toThrow(
      "store settings site type is not a site type",
    );
  });
});
