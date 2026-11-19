import { beforeEach, describe, expect, it } from "vitest";
import { CarrierRegistry } from "../application/carrier-registry";
import {
  CarrierResolutionError,
  type CarrierResolutionCode,
} from "../application/carrier-resolver";
import type { CarrierCredentialVault } from "../application/ports";
import { MerchantCarrierSettings } from "../domain/merchant-carrier-settings";
import { fakeRegistration, testCarrierVault } from "../testing/carrier-doubles";
import { InMemoryMerchantCarrierSettingsRepository } from "./in-memory-merchant-carrier-settings-repository";
import { InMemoryCarrierCredentialVault } from "./envelope-carrier-credential-vault";
import { TenantCarrierResolver, webhookVaultKey } from "./tenant-carrier-resolver";

beforeEach(() => {
  expect.hasAssertions();
});

function graphHasTenantId(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(
    ([key, child]) => key === "tenantId" || graphHasTenantId(child, seen),
  );
}

interface HarnessOptions {
  readonly enabled?: boolean;
  readonly vault?: CarrierCredentialVault | null;
  readonly credentials?: Readonly<Record<string, string>>;
}

async function resolverHarness(options: HarnessOptions = {}) {
  const vault = options.vault === null ? undefined : (options.vault ?? testCarrierVault());
  const sealingVault = vault ?? testCarrierVault();
  const settings = new InMemoryMerchantCarrierSettingsRepository();
  const fake = fakeRegistration({ key: "bosta", credentialFields: ["apiKey"] });
  const registry = CarrierRegistry.from([fake.registration]);
  const secrets: Record<string, string> = {};

  for (const [tenantId, apiKey] of [
    ["t-1", "k1"],
    ["t-2", "k2"],
  ] as const) {
    const secret = `whsec-${tenantId}`;
    secrets[tenantId] = secret;
    let stored = MerchantCarrierSettings.empty().withCarrier("bosta", {
      config: { awbFormat: "A6" },
      sealedCredentials: await sealingVault.seal(
        tenantId,
        "bosta",
        options.credentials ?? { apiKey },
      ),
      webhook: {
        sealedSecret: await sealingVault.seal(tenantId, webhookVaultKey("bosta"), { secret }),
      },
    });
    if (options.enabled ?? true) stored = stored.withEnabled("bosta", true);
    await settings.save(stored, tenantId);
  }

  const resolver = new TenantCarrierResolver({ settings, registry, vault });
  return {
    resolver,
    settings,
    created: fake.created,
    secretOf: (tenantId: string) => secrets[tenantId],
  };
}

async function codeOf(promise: Promise<unknown>): Promise<CarrierResolutionCode | "resolved"> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    expect(error).toBeInstanceOf(CarrierResolutionError);
    return (error as CarrierResolutionError).code;
  }
}

describe("TenantCarrierResolver (ADR-0014: per call, caches nothing)", () => {
  it("builds the provider per call with the tenant's own key and webhook headers; caches nothing", async () => {
    const h = await resolverHarness(); // configures bosta for t-1 (apiKey k1) and t-2 (apiKey k2), both enabled
    const p1 = await h.resolver.resolve("t-1", "bosta", "new_shipment");
    const p2 = await h.resolver.resolve("t-2", "bosta", "new_shipment");
    expect(h.created.map((c) => c.credentials.apiKey)).toEqual(["k1", "k2"]);
    expect(h.created[0]!.webhookHeaders["x-tenant-id"]).toBe("t-1");
    expect(h.created[0]!.webhookHeaders.Authorization).toBe(h.secretOf("t-1"));
    expect(h.created[1]!.webhookHeaders["x-tenant-id"]).toBe("t-2");
    expect(h.created[1]!.webhookHeaders.Authorization).toBe(h.secretOf("t-2"));
    expect(h.created[0]!.config).toEqual({ awbFormat: "A6" });
    expect(p1).not.toBe(p2);

    const again = await h.resolver.resolve("t-1", "bosta", "new_shipment");
    expect(again).not.toBe(p1);
    expect(h.created).toHaveLength(3);
  });

  it.each([
    ["unknown key", "aramex", "new_shipment", "CARRIER_UNKNOWN"],
    ["disabled, new shipment", "bosta", "new_shipment", "CARRIER_NOT_ENABLED"],
  ] as const)("%s → %s", async (_label, key, purpose, code) => {
    const h = await resolverHarness({ enabled: false });
    expect(await codeOf(h.resolver.resolve("t-1", key, purpose))).toBe(code);
    expect(h.created).toHaveLength(0);
  });

  it("a disabled but configured carrier still resolves for an existing shipment (Ruling 30)", async () => {
    const h = await resolverHarness({ enabled: false });
    const provider = await h.resolver.resolve("t-1", "bosta", "existing_shipment");
    expect(provider.key).toBe("bosta");
    expect(h.created.map((c) => c.credentials.apiKey)).toEqual(["k1"]);
  });

  it("no vault means every registered carrier is unavailable; an unknown key is still unknown", async () => {
    const h = await resolverHarness({ vault: null });
    expect(await codeOf(h.resolver.resolve("t-1", "bosta", "new_shipment"))).toBe(
      "CARRIER_NOT_AVAILABLE",
    );
    expect(await codeOf(h.resolver.resolve("t-1", "aramex", "new_shipment"))).toBe(
      "CARRIER_UNKNOWN",
    );
  });

  it("a stub vault is allowed here (the boot guard refuses it outside local)", async () => {
    const h = await resolverHarness({ vault: new InMemoryCarrierCredentialVault() });
    const provider = await h.resolver.resolve("t-1", "bosta", "new_shipment");
    expect(provider.key).toBe("bosta");
  });

  it("a tenant with no settings, or no entry for the carrier, is CARRIER_NOT_CONFIGURED", async () => {
    const h = await resolverHarness();
    expect(await codeOf(h.resolver.resolve("t-3", "bosta", "existing_shipment"))).toBe(
      "CARRIER_NOT_CONFIGURED",
    );
    await h.settings.save((await h.settings.get("t-1"))!.withoutCarrier("bosta"), "t-1");
    expect(await codeOf(h.resolver.resolve("t-1", "bosta", "existing_shipment"))).toBe(
      "CARRIER_NOT_CONFIGURED",
    );
    expect(h.created).toHaveLength(0);
  });

  it("missing or empty credential fields are CARRIER_NOT_CONFIGURED; extra fields never reach create", async () => {
    const missing = await resolverHarness({ credentials: { other: "x" } });
    expect(await codeOf(missing.resolver.resolve("t-1", "bosta", "new_shipment"))).toBe(
      "CARRIER_NOT_CONFIGURED",
    );
    const empty = await resolverHarness({ credentials: { apiKey: "" } });
    expect(await codeOf(empty.resolver.resolve("t-1", "bosta", "new_shipment"))).toBe(
      "CARRIER_NOT_CONFIGURED",
    );

    const extra = await resolverHarness({ credentials: { apiKey: "k", stray: "s" } });
    await extra.resolver.resolve("t-1", "bosta", "new_shipment");
    expect(extra.created[0]!.credentials).toEqual({ apiKey: "k" });
  });

  it("another tenant's envelope copied into this tenant's row does not open", async () => {
    const h = await resolverHarness();
    const t2 = (await h.settings.get("t-2"))!;
    const t1 = (await h.settings.get("t-1"))!;
    await h.settings.save(t1.withCarrier("bosta", t2.carrier("bosta")!), "t-1");
    expect(await codeOf(h.resolver.resolve("t-1", "bosta", "existing_shipment"))).toBe(
      "CARRIER_NOT_CONFIGURED",
    );
    expect(h.created).toHaveLength(0);
  });

  it("the error carries only the code, never a secret", async () => {
    const h = await resolverHarness({ enabled: false });
    const error = await h.resolver.resolve("t-1", "bosta", "new_shipment").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CarrierResolutionError);
    expect((error as Error).message).toMatch(/^CARRIER_NOT_ENABLED: /);
    expect((error as Error).message).not.toContain("k1");
    expect(JSON.stringify(error)).not.toContain("whsec");
  });

  it("holds no tenant: the resolver is a singleton graph with no tenantId field", () => {
    const resolver = new TenantCarrierResolver({
      settings: new InMemoryMerchantCarrierSettingsRepository(),
      registry: CarrierRegistry.from([]),
      vault: undefined,
    });
    expect(graphHasTenantId(resolver)).toBe(false);
    expect(graphHasTenantId({ deps: { inner: { tenantId: "t-1" } } })).toBe(true);
    const cyclic: { self?: unknown; children: unknown[] } = { children: [] };
    cyclic.self = cyclic;
    cyclic.children.push({ tenantId: "t-1" });
    expect(graphHasTenantId(cyclic)).toBe(true);
  });

  it("webhookVaultKey seals the webhook secret under its own key (Ruling 27)", () => {
    expect(webhookVaultKey("bosta")).toBe("bosta:webhook");
  });
});
