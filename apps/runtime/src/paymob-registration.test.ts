import { describe, expect, it, vi } from "vitest";
import type { OffSessionCharger } from "@platform/contracts";
import { PaymobMitNotConfiguredError } from "@platform/psp-paymob";
import type { Logger } from "@platform/utils";
import { paymobRegistration } from "./paymob-registration";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

const credentials = { secretKey: "egy_sk_x", hmacSecret: "h", publicKey: "egy_pk_x" };
const charge = {
  tenantId: "t",
  orderRef: "o",
  amountMinor: 100,
  currency: "EGP",
  idempotencyKey: "k",
  storedMethodToken: "tok",
};

/**
 * Paymob declaring `chargesOffSession: true` is only honest if the provider the registration builds
 * really implements the off-session port. This fails if the flag is flipped without the port (or the
 * port is removed while the flag stays) — the flag and the implementation cannot drift apart.
 */
describe("Paymob's chargesOffSession declaration is honest", () => {
  const registration = paymobRegistration(logger);

  it("declares the capability", () => {
    expect(registration.capabilities.chargesOffSession).toBe(true);
  });

  it("builds a provider that implements the off-session port", () => {
    const built = registration.create({
      config: { region: "egy", integrationId: 158, motoIntegrationId: 777 },
      credentials,
    });
    expect(typeof (built as Partial<OffSessionCharger>).chargeStoredMethod).toBe("function");
  });

  it("accepts and keeps the MOTO integration id in a merchant's config", () => {
    const parsed = registration.parseConfig?.({
      region: "egy",
      integrationId: 158,
      motoIntegrationId: 777,
    });
    expect(parsed).toEqual({
      ok: true,
      value: { region: "egy", integrationId: 158, motoIntegrationId: 777 },
    });
  });

  it("fails closed when the merchant's config has no MOTO integration: no request, no fallback sale", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const built = registration.create({
        config: { region: "egy", integrationId: 158 },
        credentials,
      });
      await expect(
        (built as unknown as OffSessionCharger).chargeStoredMethod(charge),
      ).rejects.toBeInstanceOf(PaymobMitNotConfiguredError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
