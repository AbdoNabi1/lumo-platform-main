import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { PaymentProvider } from "@platform/contracts";
import {
  GetMerchantPaymentSettings,
  UpdateMerchantPaymentSettings,
} from "./application/merchant-payment-settings.use-cases";
import type { PaymobProviderConfig } from "./application/ports";
import { CashOnDeliveryProvider } from "./infrastructure/cash-on-delivery-provider";
import { InMemoryMerchantPaymentSettingsRepository } from "./infrastructure/in-memory-merchant-payment-settings-repository";
import { PrismaMerchantPaymentSettingsRepository } from "./infrastructure/prisma-merchant-payment-settings-repository";
import { TenantPaymentProviderResolver } from "./infrastructure/tenant-payment-provider-resolver";
import { testEnvelopeVault } from "./test-support/local-key-wrap-cipher";

/**
 * WP-13's definition of done: "merchant payment credentials are never in a Postgres column, a log,
 * or a DTO". Each test below plants recognisable secret values and searches every place a leak
 * could occur for them. (Same standard as the ad-platform credential proof WP-9's T9 tasks call
 * for; WP-9 has not landed, so there is no existing test to mirror — this is the reference.)
 */
const SECRETS = {
  secretKey: "egy_sk_test_SUPER-SECRET-KEY-0123456789",
  hmacSecret: "HMAC-SECRET-VALUE-abcdef-9876543210",
  publicKey: "egy_pk_test_PUBLIC-BUT-SEALED-KEY-777",
};
const ALL = Object.values(SECRETS);

const noLeak = (haystack: unknown) => {
  const text = typeof haystack === "string" ? haystack : JSON.stringify(haystack);
  for (const secret of ALL) expect(text).not.toContain(secret);
};

class PassthroughUnitOfWork implements TransactionalUnitOfWork<unknown> {
  run<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    return work({});
  }
}

const stripeStub = {} as PaymentProvider;

function setup(overrides: { paymobFactory?: (c: PaymobProviderConfig) => PaymentProvider } = {}) {
  const repo = new InMemoryMerchantPaymentSettingsRepository();
  const vault = testEnvelopeVault();
  const resolver = new TenantPaymentProviderResolver({
    settings: repo,
    stripe: stripeStub,
    cashOnDelivery: new CashOnDeliveryProvider(),
    paymobFactory: overrides.paymobFactory ?? (() => ({}) as PaymentProvider),
    vault,
  });
  const update = new UpdateMerchantPaymentSettings({
    settings: repo,
    providers: resolver,
    vault,
    unitOfWork: new PassthroughUnitOfWork(),
  });
  const get = new GetMerchantPaymentSettings({ settings: repo, providers: resolver });
  return { repo, vault, resolver, update, get };
}

const input = (tenantId = "tenant-a") => ({
  tenantId,
  enabledMethods: ["paymob", "cod"],
  paymob: { region: "egy", integrationId: 158, ...SECRETS },
});

describe("merchant PSP credentials never leak", () => {
  it("are not in the DTO an update returns, nor in one a read returns", async () => {
    const { update, get } = setup();

    const updated = await update.execute(input());
    const read = await get.execute({ tenantId: "tenant-a" });

    expect(updated.ok && read.ok).toBe(true);
    noLeak(updated);
    noLeak(read);
    // What IS exposed: that Paymob is configured, and its non-secret routing data.
    expect(read.ok && read.value.methods.paymob).toEqual({
      available: true,
      configured: true,
      region: "egy",
      integrationId: 158,
    });
  });

  it("are not in the value handed to the persistence layer — only a sealed envelope is", async () => {
    const { update, repo } = setup();
    await update.execute(input());

    const stored = await repo.get("tenant-a");
    const sealed = stored?.paymob?.sealedCredentials ?? "";

    expect(sealed.length).toBeGreaterThan(0);
    noLeak(sealed);
    noLeak(stored?.paymob);
    // It is a genuine envelope (wrapped data key + ciphertext), not an encoding of the secrets.
    expect(JSON.parse(sealed)).toEqual(
      expect.objectContaining({
        v: 1,
        wrappedDek: expect.any(String),
        ciphertext: expect.any(String),
      }),
    );
  });

  it("are not in any Postgres column: the Prisma row written carries only the sealed string", async () => {
    const { update, repo } = setup();
    await update.execute(input());
    const settings = (await repo.get("tenant-a"))!;

    let written: Record<string, unknown> | undefined;
    const fakeClient = {
      merchantPaymentSettings: {
        upsert: (args: { create: Record<string, unknown> }) => {
          written = args.create;
          return Promise.resolve({});
        },
      },
    } as unknown as TransactionClient;
    await new PrismaMerchantPaymentSettingsRepository({} as never).save(
      settings,
      "tenant-a",
      fakeClient,
    );

    expect(written).toBeDefined();
    noLeak(written);
    expect(Object.keys(written!).sort()).toEqual([
      "enabledMethods",
      "paymobCredentials",
      "paymobIntegrationId",
      "paymobRegion",
      "tenantId",
    ]);
    expect(written!.paymobCredentials).toBe(settings.paymob!.sealedCredentials);
  });

  it("are not in the message of a rejected update", async () => {
    const { update } = setup();

    const rejected = await update.execute({
      ...input(),
      paymob: { region: "atlantis", integrationId: 158, ...SECRETS },
    });
    const incomplete = await update.execute({
      ...input(),
      paymob: { region: "egy", integrationId: 158, ...SECRETS, hmacSecret: "" },
    });

    expect(rejected.ok).toBe(false);
    expect(incomplete.ok).toBe(false);
    noLeak(rejected);
    noLeak(incomplete);
  });

  it("are only ever decrypted into the one provider built for one request", async () => {
    const seen: PaymobProviderConfig[] = [];
    const { update, resolver } = setup({
      paymobFactory: (config) => {
        seen.push(config);
        return {} as PaymentProvider;
      },
    });
    await update.execute(input());

    await resolver.resolveForNewPayment("tenant-a", "paymob");
    await resolver.resolveForNewPayment("tenant-a", "paymob");

    // Rebuilt per call, never cached: two resolutions, two constructions.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject(SECRETS);
  });

  it("do not open for another tenant, another provider, or a tampered envelope", async () => {
    const { vault } = setup();
    const sealed = await vault.seal("tenant-a", "paymob", SECRETS);

    await expect(vault.open("tenant-a", "paymob", sealed)).resolves.toEqual(SECRETS);
    await expect(vault.open("tenant-b", "paymob", sealed)).rejects.toThrow(/could not be opened/);
    await expect(vault.open("tenant-a", "stripe", sealed)).rejects.toThrow(/could not be opened/);
    const tampered = JSON.parse(sealed) as { ciphertext: string };
    tampered.ciphertext = `${tampered.ciphertext.slice(0, -4)}AAAA`;
    const failure = await vault
      .open("tenant-a", "paymob", JSON.stringify(tampered))
      .catch((e) => e);
    expect(failure).toBeInstanceOf(Error);
    noLeak((failure as Error).message);
  });

  it("a sealed envelope copied into another tenant's row yields no provider", async () => {
    const { update, repo, resolver } = setup();
    await update.execute(input("tenant-a"));
    // Simulate the attack: tenant-b's row gets tenant-a's stored Paymob config verbatim.
    await repo.save((await repo.get("tenant-a"))!, "tenant-b");

    await expect(resolver.resolveForExisting("tenant-b", "paymob")).rejects.toThrow(
      /could not be opened/,
    );
  });
});

describe("the resolver keeps no tenant and no credential (ADR-0014)", () => {
  it("has no tenantId-shaped field and no credential anywhere in its object graph", async () => {
    const { update, resolver } = setup();
    await update.execute(input("tenant-a"));
    await resolver.resolveForNewPayment("tenant-a", "paymob");

    const seen = new WeakSet<object>();
    const keys: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node !== "object" || node === null || seen.has(node)) return;
      seen.add(node);
      if (node instanceof Map || node instanceof Set) return;
      for (const [key, value] of Object.entries(node)) {
        keys.push(`${path}.${key}`);
        walk(value, `${path}.${key}`);
      }
    };
    walk(resolver, "resolver");

    expect(keys.filter((k) => /tenantId/i.test(k.split(".").at(-1) ?? ""))).toEqual([]);
    noLeak(keys);
    // Nothing on the resolver holds a plaintext credential after serving a request.
    expect(
      JSON.stringify(resolver, (_k, v: unknown) => (typeof v === "function" ? undefined : v)),
    ).not.toMatch(/SUPER-SECRET|HMAC-SECRET|PUBLIC-BUT/);
  });
});
