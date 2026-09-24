import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { PaymentIntentMapper, type PaymentIntentRow } from "./payment-intent.mapper";
import { PrismaMerchantPaymentSettingsRepository } from "./prisma-merchant-payment-settings-repository";

/**
 * The database no longer enumerates providers (the CHECK on `payment_intents.provider` is dropped
 * and `paymob_*` became one `provider_settings` object). What a stored row must still do: keep
 * reading, whatever this deployment currently registers.
 */

const intentRow = (provider: string): PaymentIntentRow => ({
  id: "pi-1",
  orderRef: "order-1",
  amountMinor: 1000,
  currency: "EGP",
  status: "created",
  pspReference: null,
  provider,
  providerTransactionRef: null,
  paymentMethod: {},
  authorizedAmountMinor: null,
  version: 1,
});

describe("payment_intents.provider is free-form: stored rows still read", () => {
  it.each(["stripe", "paymob", "cod", "a-provider-registered-last-week", "bank_transfer"])(
    "reads a row holding %j — reading never asks the registry",
    (provider) => {
      const intent = PaymentIntentMapper.toDomain(intentRow(provider), [], []);

      expect(intent.provider).toBe(provider);
    },
  );

  it.each(["", "Not A Key", "UPPER", "../x"])(
    "still refuses a corrupt provider value %j",
    (bad) => {
      expect(() => PaymentIntentMapper.toDomain(intentRow(bad), [], [])).toThrow(
        /Corrupt payments row/,
      );
    },
  );
});

function clientReturning(row: Record<string, unknown> | null): TransactionClient {
  return {
    merchantPaymentSettings: { findUnique: () => Promise.resolve(row) },
  } as unknown as TransactionClient;
}

const repo = new PrismaMerchantPaymentSettingsRepository({} as never);

describe("merchant_payment_settings.provider_settings reads", () => {
  it("a historical row that predates any provider config reads as enabled methods and no provider settings", async () => {
    const settings = await repo.get(
      "tenant-a",
      clientReturning({ tenantId: "tenant-a", enabledMethods: ["stripe"], providerSettings: {} }),
    );

    expect(settings?.enabledMethods).toEqual(["stripe"]);
    expect(settings?.providers).toEqual({});
  });

  it("a row the migration produced from paymob_* reads as one provider entry, sealed string untouched", async () => {
    const settings = await repo.get(
      "tenant-a",
      clientReturning({
        tenantId: "tenant-a",
        enabledMethods: ["stripe", "paymob"],
        providerSettings: {
          paymob: {
            config: { region: "egy", integrationId: 158 },
            sealedCredentials: '{"v":1,"opaque":"envelope"}',
          },
        },
      }),
    );

    expect(settings?.providerSettings("paymob")).toEqual({
      config: { region: "egy", integrationId: 158 },
      sealedCredentials: '{"v":1,"opaque":"envelope"}',
    });
  });

  it.each([
    ["not an object", "oops"],
    ["an entry that is not an object", { paymob: "x" }],
    ["an entry without sealed credentials", { paymob: { config: {} } }],
    ["an entry with empty sealed credentials", { paymob: { config: {}, sealedCredentials: "" } }],
    ["a malformed key", { "Bad Key": { config: {}, sealedCredentials: "s" } }],
  ])(
    "fails loudly on corrupt provider settings — %s — without echoing them",
    async (_name, providerSettings) => {
      const failure = await repo
        .get("tenant-a", clientReturning({ enabledMethods: ["stripe"], providerSettings }))
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/Corrupt merchant payment settings/);
      expect((failure as Error).message).not.toContain("oops");
    },
  );
});
