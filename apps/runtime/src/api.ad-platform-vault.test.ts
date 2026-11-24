import type { Database } from "@platform/db";
import { wireAdPlatforms } from "@platform/ad-platforms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeCore } from "./composition";
import { loadRuntimeConfig } from "./config";

beforeEach(() => {
  expect.hasAssertions();
});

/**
 * Lead Site Part D1: `startApi()` must hand the runtime's ad platform credential vault to the admin API
 * EXPLICITLY (like the payment vault), built only when `AD_PLATFORM_CREDENTIALS_KEK_REF` is set. Same
 * mock-and-inspect-the-call convention as `api.h-02-audit-trail-regression.test.ts`.
 */

const { mockCreateAdminHttpApi } = vi.hoisted(() => ({
  mockCreateAdminHttpApi: vi.fn(async (_deps: { adPlatformCredentialVault?: unknown }) => ({
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  })),
}));

vi.mock("@platform/admin", () => ({
  createAdminHttpApi: mockCreateAdminHttpApi,
  LoggingSignupEmailAdapter: class {
    async sendCompleteAccountEmail() {
      return undefined;
    }
    async sendAlreadyRegisteredEmail() {
      return undefined;
    }
  },
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
  EmailSignupEmailAdapter: class {
    sendCompleteAccountEmail() {
      return Promise.resolve();
    }
    sendAlreadyRegisteredEmail() {
      return Promise.resolve();
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

const SECRET = "EAAB1234567890abcdWIRINGTOKEN";
const KEK = "a-runtime-test-kek-ref-0123456789-abcdef";

/** Records every write the Prisma repository makes, so the stored value can be inspected. */
function recordingPrisma() {
  const created: { data: { sealedSecret: string | null } }[] = [];
  const delegate = {
    findFirst: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
    updateMany: () => Promise.resolve({ count: 1 }),
    create: (args: { data: { sealedSecret: string | null } }) => {
      created.push(args);
      return Promise.resolve(null);
    },
  };
  const client: Record<string, unknown> = {
    adPlatformConnection: delegate,
    $executeRaw: () => Promise.resolve(1),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  return { prisma: client as unknown as Database, created };
}

describe("startApi() wires the ad platform credential vault into the admin API", () => {
  beforeEach(() => {
    mockCreateAdminHttpApi.mockClear();
  });

  it("passes the REAL envelope vault when AD_PLATFORM_CREDENTIALS_KEK_REF is set, and a save through it stores a sealed envelope (not stub:)", async () => {
    const { startApi } = await import("./api");
    const env = { ...validEnv, AD_PLATFORM_CREDENTIALS_KEK_REF: KEK };
    const core = buildRuntimeCore(loadRuntimeConfig(env));
    expect(core.adPlatformCredentialVault?.backing).toBe("real");

    await startApi(loadRuntimeConfig(env), core);

    expect(mockCreateAdminHttpApi).toHaveBeenCalledTimes(1);
    const [deps] = mockCreateAdminHttpApi.mock.calls[0] ?? [];
    const vault = deps?.adPlatformCredentialVault as
      { backing: string; seal: (t: string, p: "meta", s: string) => Promise<string> } | undefined;
    expect(vault).toBe(core.adPlatformCredentialVault);
    expect(vault?.backing).toBe("real");

    // The vault the admin API receives, composed exactly as the admin will (Prisma branch), seals the token.
    const { prisma, created } = recordingPrisma();
    const wired = wireAdPlatforms({
      clock: { now: () => new Date("2026-11-23T10:00:00.000Z") },
      idGenerator: { generate: () => "01930000-0000-7000-8000-000000000001" },
      prisma,
      vault: vault as never,
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
    const stored = created[0]?.data.sealedSecret ?? "";
    expect(stored.startsWith("stub:")).toBe(false);
    expect(stored).not.toContain(SECRET);
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual([
      "alias",
      "ciphertext",
      "kekRef",
      "v",
      "wrappedDek",
    ]);
    expect((JSON.parse(stored) as { alias: string }).alias).toBe("ad-platform-credentials");
    expect(JSON.stringify(response.body)).not.toContain(SECRET);
  });

  it("passes no vault without the KEK, and the Prisma composition then refuses a token with 503", async () => {
    const { startApi } = await import("./api");
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    expect(core.adPlatformCredentialVault).toBeUndefined();

    await startApi(loadRuntimeConfig(validEnv), core);

    const [deps] = mockCreateAdminHttpApi.mock.calls[0] ?? [];
    expect(deps?.adPlatformCredentialVault).toBeUndefined();

    const { prisma, created } = recordingPrisma();
    const wired = wireAdPlatforms({
      clock: { now: () => new Date("2026-11-23T10:00:00.000Z") },
      idGenerator: { generate: () => "01930000-0000-7000-8000-000000000001" },
      prisma,
    });
    const response = await wired.controller.save({
      tenantId: "t-1",
      platform: "meta",
      enabled: true,
      publicConfig: { platform: "meta", pixelId: "123456789012345" },
      secret: SECRET,
      expectedVersion: 0,
    });
    expect(response.status).toBe(503);
    expect(created).toEqual([]);
  });
});
