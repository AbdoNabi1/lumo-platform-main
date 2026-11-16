import { ConcurrencyError } from "@platform/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { PREVIOUS_WEBHOOK_SECRET_TTL_MS } from "../domain/merchant-carrier-settings";
import type { MerchantCarrierSettingsRepository } from "../domain/merchant-carrier-settings-repository";
import { InMemoryMerchantCarrierSettingsRepository } from "../infrastructure/in-memory-merchant-carrier-settings-repository";
import { WEBHOOK_SECRET_FIELD, webhookVaultKey } from "../infrastructure/tenant-carrier-resolver";
import {
  fakeRegistration,
  fixedClock,
  testCarrierVault,
  type FakeCarrierScript,
} from "../testing/carrier-doubles";
import { TrackingUnitOfWork } from "../testing/shipping-doubles";
import type { CarrierCredentialVault } from "./ports";
import { CarrierRegistry, type CarrierRegistration } from "./carrier-registry";
import {
  GetCarrierSettings,
  ListEnabledCarriers,
  MAX_CARRIER_SECRET_LENGTH,
  RotateCarrierWebhookSecret,
  UpdateCarrierSettings,
  VerifyCarrierWebhook,
  type CarrierSettingsDeps,
} from "./carrier-settings.use-cases";

beforeEach(() => {
  expect.hasAssertions();
});

interface HarnessOptions {
  readonly verify?: FakeCarrierScript["verify"];
  readonly vault?: CarrierCredentialVault | null;
  readonly settings?: MerchantCarrierSettingsRepository;
  readonly registrationPatch?: Partial<Omit<CarrierRegistration, "create">>;
  readonly wrapRegistration?: (registration: CarrierRegistration) => CarrierRegistration;
}

function settingsHarness(options: HarnessOptions = {}) {
  const unitOfWork = new TrackingUnitOfWork();
  const fake = fakeRegistration({
    script: { verify: options.verify ?? "ok" },
    openCount: () => unitOfWork.openCount,
    ...options.registrationPatch,
  });
  const registration = options.wrapRegistration?.(fake.registration) ?? fake.registration;
  const store: MerchantCarrierSettingsRepository =
    options.settings ?? new InMemoryMerchantCarrierSettingsRepository();
  const settings = store;
  const vault = options.vault === null ? undefined : (options.vault ?? testCarrierVault());
  const clock = fixedClock();
  let n = 0;
  const randomSecret = () => {
    n += 1;
    return "s".repeat(42) + String(n % 10);
  };
  const deps: CarrierSettingsDeps = {
    settings,
    registry: CarrierRegistry.from([registration]),
    vault,
    unitOfWork,
    clock,
    randomSecret,
  };
  const webhookSecretOf = async (tenantId: string): Promise<string | undefined> => {
    const stored = (await store.get(tenantId))?.carrier("bosta");
    if (stored === undefined || vault === undefined) return undefined;
    const opened = await vault.open(
      tenantId,
      webhookVaultKey("bosta"),
      stored.webhook.sealedSecret,
    );
    return opened[WEBHOOK_SECRET_FIELD];
  };
  return {
    ...fake,
    unitOfWork,
    clock,
    vault,
    deps,
    settings: store,
    update: new UpdateCarrierSettings(deps),
    rotate: new RotateCarrierWebhookSecret(deps),
    verify: new VerifyCarrierWebhook(deps),
    get: new GetCarrierSettings(deps),
    listEnabled: new ListEnabledCarriers(deps),
    webhookSecretOf,
  };
}

async function configuredHarness(tenants: string[], opts: HarnessOptions = {}) {
  const h = settingsHarness(opts);
  const secrets = new Map<string, string>();
  for (const tenantId of tenants) {
    const r = await h.update.execute({
      tenantId,
      carrierKey: "bosta",
      credentials: { apiKey: `key-${tenantId}` },
      enabled: true,
    });
    expect(r.ok).toBe(true);
    secrets.set(tenantId, (await h.webhookSecretOf(tenantId)) ?? "");
  }
  return {
    ...h,
    secretOf: (tenantId: string): string => secrets.get(tenantId) ?? "",
    currentSecretOf: h.webhookSecretOf,
  };
}

function entryOf(r: Awaited<ReturnType<UpdateCarrierSettings["execute"]>>) {
  return r.ok ? r.value.carriers.find((c) => c.key === "bosta") : undefined;
}

describe("UpdateCarrierSettings (§8.1, Ruling 8)", () => {
  it("verifies the key before saving; a rejected key saves nothing", async () => {
    const h = settingsHarness({ verify: "credentials_rejected" });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "bad" },
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_CREDENTIALS_REJECTED");
    expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(409);
    expect(await h.settings.get("t-1")).toBeNull();
  });

  it("a valid key is sealed, configured, mints a webhook secret, and is never returned", async () => {
    const h = settingsHarness({ verify: "ok" });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "bosta-key-123" },
      config: { awbFormat: "A4" },
      enabled: true,
    });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("bosta-key-123");
    const entry = entryOf(r);
    expect(entry).toMatchObject({ enabled: true, configured: true, config: { awbFormat: "A4" } });
    const secret = await h.webhookSecretOf("t-1");
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(r)).not.toContain(secret ?? "x");
    const stored = (await h.settings.get("t-1"))?.carrier("bosta");
    expect(stored?.sealedCredentials).not.toContain("bosta-key-123");
    expect((await h.vault?.open("t-1", "bosta", stored?.sealedCredentials ?? ""))?.["apiKey"]).toBe(
      "bosta-key-123",
    );
  });

  it("credentials must be exactly the declared fields; the message names no value", async () => {
    const h = settingsHarness({ verify: "ok" });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "x", extra: "secret-y" },
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_CREDENTIALS_INVALID");
    expect(!r.ok && r.error.message).not.toContain("secret-y");
  });

  it.each([
    ["blank", { apiKey: "   " }],
    ["513 characters", { apiKey: "k".repeat(MAX_CARRIER_SECRET_LENGTH + 1) }],
    ["empty object", {}],
  ] as [string, Record<string, string>][])(
    "%s credentials are CARRIER_CREDENTIALS_INVALID (422) without the value",
    async (_n, c) => {
      const h = settingsHarness();
      const r = await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", credentials: c });
      expect(!r.ok && r.error.code).toBe("CARRIER_CREDENTIALS_INVALID");
      expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(422);
      expect(!r.ok && r.error.message).not.toContain("kkkkk");
      expect(await h.settings.get("t-1")).toBeNull();
      expect(h.record.verifyCalls).toBe(0);
    },
  );

  it("accepts a 512-character key and stores it trimmed", async () => {
    const h = settingsHarness();
    const key = "k".repeat(MAX_CARRIER_SECRET_LENGTH);
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: `  ${key}  ` },
    });
    expect(r.ok).toBe(true);
    const stored = (await h.settings.get("t-1"))?.carrier("bosta");
    const opened = await h.vault?.open("t-1", "bosta", stored?.sealedCredentials ?? "");
    expect(opened?.["apiKey"]).toBe(key);
  });

  it.each(["aramex", "Bosta", "__proto__", ""])(
    "carrierKey %j is CARRIER_UNKNOWN (422) and saves nothing",
    async (carrierKey) => {
      const h = settingsHarness();
      const r = await h.update.execute({ tenantId: "t-1", carrierKey, enabled: true });
      expect(!r.ok && r.error.code).toBe("CARRIER_UNKNOWN");
      expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(422);
      expect(await h.settings.get("t-1")).toBeNull();
    },
  );

  it("without a vault it is CARRIER_NOT_AVAILABLE (409)", async () => {
    const h = settingsHarness({ vault: null });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "k" },
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_NOT_AVAILABLE");
    expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(409);
    expect(h.record.verifyCalls).toBe(0);
  });

  it("disconnect together with another field is a ValidationError", async () => {
    const h = settingsHarness();
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      disconnect: true,
      enabled: true,
    });
    expect(!r.ok && r.error.code).toBe("VALIDATION");
  });

  it("a config parseConfig refuses is CARRIER_CONFIG_INVALID (422) with its reason", async () => {
    const h = settingsHarness({
      registrationPatch: { parseConfig: () => ({ ok: false, reason: "awbFormat" }) },
    });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "k" },
      config: { awbFormat: "Z9" },
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_CONFIG_INVALID");
    const error = !r.ok ? (r.error as { httpStatus?: number; reason?: string }) : undefined;
    expect(error?.httpStatus).toBe(422);
    expect(error?.reason).toBe("awbFormat");
    expect(await h.settings.get("t-1")).toBeNull();
  });

  it("an unavailable verification is CARRIER_UNAVAILABLE (503) and saves nothing", async () => {
    const h = settingsHarness({ verify: "unavailable" });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "k" },
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_UNAVAILABLE");
    expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(503);
    expect(await h.settings.get("t-1")).toBeNull();
  });

  it("a config-only change keeps the sealed credentials and doesn't verify again", async () => {
    const h = await configuredHarness(["t-1"]);
    const before = (await h.settings.get("t-1"))?.carrier("bosta")?.sealedCredentials;
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      config: { awbFormat: "A4" },
    });
    expect(r.ok).toBe(true);
    expect(entryOf(r)?.config).toEqual({ awbFormat: "A4" });
    expect((await h.settings.get("t-1"))?.carrier("bosta")?.sealedCredentials).toBe(before);
    expect(h.record.verifyCalls).toBe(1);
  });

  it("config-only on an unconfigured carrier is CARRIER_NOT_CONFIGURED (409)", async () => {
    const h = settingsHarness();
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      config: { awbFormat: "A4" },
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_NOT_CONFIGURED");
    expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(409);
    expect(await h.settings.get("t-1")).toBeNull();
  });

  it("enabled-only on an unconfigured carrier is CARRIER_NOT_CONFIGURED (409)", async () => {
    const h = settingsHarness();
    const r = await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", enabled: true });
    expect(!r.ok && r.error.code).toBe("CARRIER_NOT_CONFIGURED");
    expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(409);
    expect(await h.settings.get("t-1")).toBeNull();
  });

  it("new credentials on a configured carrier keep the webhook secret and reopen as the new key", async () => {
    const h = await configuredHarness(["t-1"]);
    const secretBefore = await h.webhookSecretOf("t-1");
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "k2" },
    });
    expect(r.ok).toBe(true);
    expect(await h.webhookSecretOf("t-1")).toBe(secretBefore);
    const stored = (await h.settings.get("t-1"))?.carrier("bosta");
    const opened = await h.vault?.open("t-1", "bosta", stored?.sealedCredentials ?? "");
    expect(opened?.["apiKey"]).toBe("k2");
    expect(h.record.verifyCalls).toBe(2);
  });

  it("disconnect removes credentials and secrets (Ruling 28)", async () => {
    const h = await configuredHarness(["t-1"]);
    const r = await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", disconnect: true });
    expect(r.ok).toBe(true);
    expect(entryOf(r)).toMatchObject({ configured: false, enabled: false, config: null });
    const after = await h.settings.get("t-1");
    expect(after?.carrier("bosta")).toBeUndefined();
    expect(after?.enabledCarriers).toEqual([]);
  });

  it("disconnecting an unconfigured carrier is a no-op that writes nothing", async () => {
    const h = settingsHarness();
    const r = await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", disconnect: true });
    expect(r.ok).toBe(true);
    expect(entryOf(r)).toMatchObject({ configured: false });
    expect(await h.settings.get("t-1")).toBeNull();
  });

  it("a stale version is a 409 ConcurrencyError, nothing lost (Ruling 29)", async () => {
    const real: MerchantCarrierSettingsRepository = new InMemoryMerchantCarrierSettingsRepository();
    const stale: MerchantCarrierSettingsRepository = {
      get: (tenantId, tx) => real.get(tenantId, tx),
      save: () => Promise.reject(new ConcurrencyError("x")),
    };
    const h = settingsHarness({ settings: stale });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "k" },
    });
    expect(!r.ok && r.error).toBeInstanceOf(ConcurrencyError);
    expect(await real.get("t-1")).toBeNull();
  });

  it("verifies outside the transaction", async () => {
    const h = settingsHarness();
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", credentials: { apiKey: "k" } });
    expect(h.record.verifyOpenCounts).toEqual([0]);
  });

  it("verifies with the registration's declared credentials and no webhook headers", async () => {
    const h = settingsHarness();
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", credentials: { apiKey: "k" } });
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({ credentials: { apiKey: "k" }, webhookHeaders: {} });
  });

  it("an omitted config never resets a stored one", async () => {
    const h = await configuredHarness(["t-1"]);
    const config = { awbFormat: "A4", awbLanguage: "en" };
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", config });
    const a = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "k2" },
    });
    expect(entryOf(a)?.config).toEqual(config);
    const b = await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", enabled: false });
    expect(entryOf(b)?.config).toEqual(config);
    expect(entryOf(b)?.enabled).toBe(false);
  });

  it("a first configuration without config uses the registration defaults", async () => {
    const h = settingsHarness({
      registrationPatch: {
        parseConfig: (raw) => ({ ok: true, value: raw === undefined ? { awbFormat: "A6" } : {} }),
      },
    });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "k" },
    });
    expect(entryOf(r)?.config).toEqual({ awbFormat: "A6" });
  });

  it("a change made during verification is a ConcurrencyError and A never saves", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saves = 0;
    const real: MerchantCarrierSettingsRepository = new InMemoryMerchantCarrierSettingsRepository();
    const counting: MerchantCarrierSettingsRepository = {
      get: (tenantId, tx) => real.get(tenantId, tx),
      save: async (s, t, tx) => {
        saves += 1;
        await real.save(s, t, tx);
      },
    };
    let held = false;
    const h = settingsHarness({
      settings: counting,
      wrapRegistration: (registration) => ({
        ...registration,
        create: (context) => {
          const provider = registration.create(context);
          const proxy = Object.create(provider) as typeof provider;
          proxy.verifyCredentials = async () => {
            if (context.credentials["apiKey"] === "held" && !held) {
              held = true;
              await gate;
            }
            await provider.verifyCredentials();
          };
          return proxy;
        },
      }),
    });
    // The repository the harness reads through is `counting`; seed through it.
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", credentials: { apiKey: "b1" } });
    const savesBefore = saves;
    const pending = h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "held" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const b = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      config: { awbFormat: "A6" },
    });
    expect(b.ok).toBe(true);
    const afterB = await real.get("t-1");
    release();
    const a = await pending;
    expect(!a.ok && a.error).toBeInstanceOf(ConcurrencyError);
    expect(saves).toBe(savesBefore + 1);
    expect(await real.get("t-1")).toEqual(afterB);
    expect(afterB?.carrier("bosta")?.config).toEqual({ awbFormat: "A6" });
  });

  it("B disconnecting and C reconnecting during A's verification still stops A", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saves = 0;
    const real: MerchantCarrierSettingsRepository = new InMemoryMerchantCarrierSettingsRepository();
    const counting: MerchantCarrierSettingsRepository = {
      get: (tenantId, tx) => real.get(tenantId, tx),
      save: async (s, t, tx) => {
        saves += 1;
        await real.save(s, t, tx);
      },
    };
    const h = settingsHarness({
      settings: counting,
      wrapRegistration: (registration) => ({
        ...registration,
        create: (context) => {
          const provider = registration.create(context);
          const proxy = Object.create(provider) as typeof provider;
          proxy.verifyCredentials = async () => {
            if (context.credentials["apiKey"] === "held") await gate;
            await provider.verifyCredentials();
          };
          return proxy;
        },
      }),
    });
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", credentials: { apiKey: "b1" } });
    const pending = h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "held" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", disconnect: true });
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", credentials: { apiKey: "c1" } });
    const savesBefore = saves;
    const afterC = await real.get("t-1");
    release();
    const a = await pending;
    expect(!a.ok && a.error).toBeInstanceOf(ConcurrencyError);
    expect(saves).toBe(savesBefore);
    expect(await real.get("t-1")).toEqual(afterC);
  });

  it("a first configuration that finds an entry in the transaction is a ConcurrencyError", async () => {
    const real: MerchantCarrierSettingsRepository = new InMemoryMerchantCarrierSettingsRepository();
    const rival: { update?: UpdateCarrierSettings } = {};
    let first = true;
    const h = settingsHarness({
      settings: real,
      wrapRegistration: (registration) => ({
        ...registration,
        create: (context) => {
          const provider = registration.create(context);
          const proxy = Object.create(provider) as typeof provider;
          proxy.verifyCredentials = async () => {
            if (first) {
              first = false;
              await rival.update?.execute({
                tenantId: "t-1",
                carrierKey: "bosta",
                credentials: { apiKey: "rival" },
              });
            }
            await provider.verifyCredentials();
          };
          return proxy;
        },
      }),
    });
    rival.update = h.update;
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "mine" },
    });
    expect(!r.ok && r.error).toBeInstanceOf(ConcurrencyError);
    const stored = (await real.get("t-1"))?.carrier("bosta");
    const opened = await h.vault?.open("t-1", "bosta", stored?.sealedCredentials ?? "");
    expect(opened?.["apiKey"]).toBe("rival");
  });
});

describe("RotateCarrierWebhookSecret", () => {
  it("is CARRIER_NOT_CONFIGURED (409) when nothing is stored", async () => {
    const h = settingsHarness();
    const r = await h.rotate.execute({ tenantId: "t-1", carrierKey: "bosta" });
    expect(!r.ok && r.error.code).toBe("CARRIER_NOT_CONFIGURED");
    expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(409);
  });

  it("is CARRIER_NOT_AVAILABLE (409) without a vault", async () => {
    const h = settingsHarness({ vault: null });
    const r = await h.rotate.execute({ tenantId: "t-1", carrierKey: "bosta" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("CARRIER_NOT_AVAILABLE");
    expect(!r.ok && (r.error as { httpStatus?: number }).httpStatus).toBe(409);
  });

  it("is CARRIER_UNKNOWN for an unregistered key", async () => {
    const h = settingsHarness();
    const r = await h.rotate.execute({ tenantId: "t-1", carrierKey: "aramex" });
    expect(!r.ok && r.error.code).toBe("CARRIER_UNKNOWN");
  });

  it("keeps the old secret as previous until now + 7 days and returns no secret", async () => {
    const h = await configuredHarness(["t-1"]);
    const before = (await h.settings.get("t-1"))?.carrier("bosta");
    const r = await h.rotate.execute({ tenantId: "t-1", carrierKey: "bosta" });
    expect(r.ok).toBe(true);
    const after = (await h.settings.get("t-1"))?.carrier("bosta");
    expect(after?.webhook.previousSealedSecret).toBe(before?.webhook.sealedSecret);
    expect(after?.webhook.previousValidUntil?.getTime()).toBe(
      h.clock.now().getTime() + PREVIOUS_WEBHOOK_SECRET_TTL_MS,
    );
    expect(after?.webhook.sealedSecret).not.toBe(before?.webhook.sealedSecret);
    expect(JSON.stringify(r)).not.toContain(h.secretOf("t-1"));
    expect(JSON.stringify(r)).not.toContain((await h.webhookSecretOf("t-1")) ?? "x");
  });
});

describe("GetCarrierSettings", () => {
  it("lists one entry per registration; an unconfigured entry is bare", async () => {
    const h = settingsHarness();
    const r = await h.get.execute({ tenantId: "t-1" });
    expect(r.ok && r.value.version).toBe(0);
    expect(r.ok && r.value.carriers).toEqual([
      {
        key: "bosta",
        displayName: "Fake carrier",
        available: true,
        enabled: false,
        configured: false,
        config: null,
        capabilities: { cod: true, awb: true, webhooks: true, cancel: true },
        webhookUrl: "https://admin.example.test/api/v1/public/shipping/webhook/bosta",
      },
    ]);
  });

  it("returns one entry per registration in registry order, not sorted", async () => {
    const h = settingsHarness();
    const zeta = fakeRegistration({ key: "zeta" }).registration;
    const bosta = fakeRegistration({ key: "bosta" }).registration;
    const get = new GetCarrierSettings({
      ...h.deps,
      registry: CarrierRegistry.from([zeta, bosta]),
    });
    const r = await get.execute({ tenantId: "t-1" });
    expect(r.ok && r.value.carriers.map((c) => c.key)).toEqual(["zeta", "bosta"]);
    expect(r.ok && r.value.carriers).toHaveLength(2);
    for (const entry of r.ok ? r.value.carriers : []) {
      expect(entry).toMatchObject({
        displayName: "Fake carrier",
        available: true,
        enabled: false,
        configured: false,
        config: null,
        capabilities: { cod: true, awb: true, webhooks: true, cancel: true },
      });
    }
  });

  it("reports available false without a vault", async () => {
    const h = settingsHarness({ vault: null });
    const r = await h.get.execute({ tenantId: "t-1" });
    expect(r.ok && r.value.carriers[0]?.available).toBe(false);
  });

  it("carries the config and the version but never a secret", async () => {
    const h = await configuredHarness(["t-1"]);
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", config: { awbFormat: "A4" } });
    const r = await h.get.execute({ tenantId: "t-1" });
    expect(r.ok && r.value.version).toBe(2);
    expect(r.ok && r.value.carriers[0]).toMatchObject({
      configured: true,
      enabled: true,
      config: { awbFormat: "A4" },
    });
    const text = JSON.stringify(r);
    const stored = (await h.settings.get("t-1"))?.carrier("bosta");
    expect(text).not.toContain("key-t-1");
    expect(text).not.toContain(h.secretOf("t-1"));
    expect(text).not.toContain(stored?.sealedCredentials ?? "x");
    expect(text).not.toContain(stored?.webhook.sealedSecret ?? "x");
  });

  it("is per tenant", async () => {
    const h = await configuredHarness(["t-1"]);
    const r = await h.get.execute({ tenantId: "t-2" });
    expect(r.ok && r.value.carriers[0]?.configured).toBe(false);
  });
});

describe("ListEnabledCarriers", () => {
  it("lists only enabled + configured + available carriers, with no config", async () => {
    const h = await configuredHarness(["t-1"]);
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", config: { awbFormat: "A4" } });
    const r = await h.listEnabled.execute({ tenantId: "t-1" });
    expect(r.ok && r.value.carriers).toEqual([{ key: "bosta", displayName: "Fake carrier" }]);
    expect(r.ok && Object.keys(r.value.carriers[0] ?? {}).sort()).toEqual(["displayName", "key"]);
    expect(JSON.stringify(r)).not.toContain("awbFormat");
  });

  it("omits a configured carrier that is turned off, and an unconfigured tenant", async () => {
    const h = await configuredHarness(["t-1"]);
    await h.update.execute({ tenantId: "t-1", carrierKey: "bosta", enabled: false });
    const off = await h.listEnabled.execute({ tenantId: "t-1" });
    expect(off.ok && off.value.carriers).toEqual([]);
    const other = await h.listEnabled.execute({ tenantId: "t-2" });
    expect(other.ok && other.value.carriers).toEqual([]);
  });

  it("is empty without a vault", async () => {
    const real: MerchantCarrierSettingsRepository = new InMemoryMerchantCarrierSettingsRepository();
    const seeded = await configuredHarness(["t-1"], { settings: real });
    expect(seeded.vault).toBeDefined();
    const h = settingsHarness({ vault: null, settings: real });
    const r = await h.listEnabled.execute({ tenantId: "t-1" });
    expect(r.ok && r.value.carriers).toEqual([]);
  });
});

describe("VerifyCarrierWebhook (§9a.1, Review Focus 3)", () => {
  it("accepts the tenant's own secret only; tenant B's secret is refused for tenant A", async () => {
    const h = await configuredHarness(["t-1", "t-2"]);
    expect(
      await h.verify.execute({
        tenantId: "t-1",
        carrierKey: "bosta",
        presented: h.secretOf("t-1"),
      }),
    ).toBe(true);
    expect(
      await h.verify.execute({
        tenantId: "t-1",
        carrierKey: "bosta",
        presented: h.secretOf("t-2"),
      }),
    ).toBe(false);
    expect(
      await h.verify.execute({
        tenantId: "t-3",
        carrierKey: "bosta",
        presented: h.secretOf("t-1"),
      }),
    ).toBe(false);
    expect(
      await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: undefined }),
    ).toBe(false);
  });

  it("the previous secret works for 7 days after a rotation, then not", async () => {
    const h = await configuredHarness(["t-1"]);
    const old = h.secretOf("t-1");
    await h.rotate.execute({ tenantId: "t-1", carrierKey: "bosta" });
    const current = (await h.currentSecretOf("t-1")) ?? "";
    expect(current).not.toBe(old);
    expect(await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: old })).toBe(
      true,
    );
    expect(
      await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: current }),
    ).toBe(true);
    h.clock.advanceMs(PREVIOUS_WEBHOOK_SECRET_TTL_MS + 1);
    expect(await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: old })).toBe(
      false,
    );
    expect(
      await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: current }),
    ).toBe(true);
  });

  it("refuses an empty, over-long, or unknown-carrier presentation", async () => {
    const h = await configuredHarness(["t-1"]);
    for (const presented of ["", "x".repeat(MAX_CARRIER_SECRET_LENGTH + 1)]) {
      expect(await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented })).toBe(
        false,
      );
    }
    expect(
      await h.verify.execute({
        tenantId: "t-1",
        carrierKey: "aramex",
        presented: h.secretOf("t-1"),
      }),
    ).toBe(false);
  });

  it("refuses without a vault, and when the vault throws on open (never throws)", async () => {
    const real: MerchantCarrierSettingsRepository = new InMemoryMerchantCarrierSettingsRepository();
    const seeded = await configuredHarness(["t-1"], { settings: real });
    const secret = seeded.secretOf("t-1");
    const noVault = settingsHarness({ vault: null, settings: real });
    expect(
      await noVault.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: secret }),
    ).toBe(false);
    const throwing: CarrierCredentialVault = {
      backing: "real",
      seal: () => Promise.resolve("x"),
      open: () => Promise.reject(new Error("boom")),
    };
    const broken = settingsHarness({ vault: throwing, settings: real });
    expect(
      await broken.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: secret }),
    ).toBe(false);
  });

  it("refuses when the settings read throws", async () => {
    const failing: MerchantCarrierSettingsRepository = {
      get: () => Promise.reject(new Error("db down")),
      save: () => Promise.resolve(),
    };
    const h = settingsHarness({ settings: failing });
    expect(await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: "abc" })).toBe(
      false,
    );
  });
});
