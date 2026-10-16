import { describe, expect, it } from "vitest";
import type {
  Clock,
  IdGenerator,
  OffSessionCharger,
  OffSessionPaymentProvider,
  PaymentProvider,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePayments } from "./composition";
import type { ProviderRegistration } from "./application/provider-registry";
import { composePaymentProviderRegistrations } from "./infrastructure/built-in-provider-registrations";
import { testEnvelopeVault } from "./test-support/local-key-wrap-cipher";

/**
 * Off-session charging is a SEPARATE narrow port (`OffSessionCharger`, WP-14 follow-up G-74 (1)) —
 * `PaymentProvider` is not widened. A provider that declares `chargesOffSession` must implement it,
 * and the type system, not just a runtime check, is what says so.
 */

const plainProvider: PaymentProvider = {
  createIntent: () => Promise.resolve({ providerIntentId: "x" }),
  capture: () => Promise.resolve(),
  cancel: () => Promise.resolve(),
  refund: () => Promise.resolve(),
  verifyWebhook: () => Promise.resolve(true),
};

const chargingProvider: OffSessionPaymentProvider = {
  ...plainProvider,
  chargeStoredMethod: () => Promise.resolve({ providerReference: "ref" }),
};

const CAPS = {
  settlesAtPayTime: false,
  deliversWebhooks: true,
  requiresMerchantCredentials: false,
} as const;

function wire(registrations: readonly ProviderRegistration[]) {
  let n = 0;
  const ids: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const clock: Clock = { now: () => new Date("2026-09-24T00:00:00.000Z") };
  return wirePayments({
    serializer: new InMemoryEventSerializer(),
    idGenerator: ids,
    clock,
    paymentProvider: plainProvider,
    paymentCredentialVault: testEnvelopeVault(),
    providerRegistrations: registrations,
  });
}

describe("the type system carries the off-session capability", () => {
  it("a plain PaymentProvider is not assignable where an OffSessionCharger is required", () => {
    // @ts-expect-error — a provider without `chargeStoredMethod` must not satisfy the narrow port.
    const refused: OffSessionCharger = plainProvider;
    expect(refused).toBeDefined();
  });

  it("a registration declaring chargesOffSession: true cannot be backed by a plain provider", () => {
    // @ts-expect-error — declares off-session but builds a provider with no off-session port.
    const dishonest: ProviderRegistration = {
      key: "liar",
      capabilities: { ...CAPS, chargesOffSession: true },
      backing: "real",
      create: () => plainProvider,
    };
    const honest: ProviderRegistration = {
      key: "honest",
      capabilities: { ...CAPS, chargesOffSession: true },
      backing: "real",
      create: () => chargingProvider,
    };
    const onSessionOnly: ProviderRegistration = {
      key: "on-session",
      capabilities: { ...CAPS, chargesOffSession: false },
      backing: "real",
      create: () => plainProvider,
    };
    expect([dishonest.key, honest.key, onSessionOnly.key]).toHaveLength(3);
  });
});

describe("resolveForOffSession hands back a provider that can actually charge", () => {
  it("returns the off-session port for a registration that declares and implements it", async () => {
    const app = wire([
      {
        key: "can-recur",
        capabilities: { ...CAPS, chargesOffSession: true },
        backing: "real",
        create: () => chargingProvider,
      },
    ]);
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["can-recur"],
    });
    const provider = await app.providers.resolveForOffSession("tenant-a", "can-recur");
    await expect(
      provider.chargeStoredMethod({
        tenantId: "tenant-a",
        orderRef: "o",
        amountMinor: 1,
        currency: "EGP",
        idempotencyKey: "k",
        storedMethodToken: "t",
      }),
    ).resolves.toEqual({ providerReference: "ref" });
  });

  it("refuses at runtime a registration that DECLARES the capability with nothing behind it (a cast, JS, a stale build)", async () => {
    const app = wire([
      {
        key: "liar",
        capabilities: { ...CAPS, chargesOffSession: true },
        backing: "real",
        create: () => plainProvider as unknown as OffSessionPaymentProvider,
      },
    ]);
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["liar"],
    });
    await expect(app.providers.resolveForOffSession("tenant-a", "liar")).rejects.toThrow(
      /no off-session port/,
    );
  });
});

describe("every built-in registration is honest about chargesOffSession", () => {
  it("declares it exactly when the provider it builds implements the port — Stripe here does not", () => {
    for (const registration of composePaymentProviderRegistrations({})) {
      const built = registration.create({ config: {}, credentials: {} });
      const implementsPort =
        typeof (built as Partial<OffSessionCharger>).chargeStoredMethod === "function";
      expect(
        registration.capabilities.chargesOffSession,
        `${registration.key} declares chargesOffSession=${registration.capabilities.chargesOffSession} but implements the port=${implementsPort}`,
      ).toBe(implementsPort);
    }
  });
});
