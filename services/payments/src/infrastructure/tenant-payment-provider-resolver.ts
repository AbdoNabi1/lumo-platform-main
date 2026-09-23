import type { PaymentProvider } from "@platform/contracts";
import type {
  PaymentCredentialVault,
  PaymentProviderResolver,
  PaymobProviderFactory,
  ProviderAvailability,
  ProviderBacking,
} from "../application/ports";
import { PaymentProviderUnavailableError } from "../application/ports";
import { MerchantPaymentSettings } from "../domain/merchant-payment-settings";
import type { MerchantPaymentSettingsRepository } from "../domain/merchant-payment-settings-repository";
import type { PaymentProviderKey } from "../domain/value-objects/payment-provider-key";
import { InMemoryPaymentProvider } from "./in-memory-port-adapters";

export interface TenantPaymentProviderResolverDeps {
  readonly settings: MerchantPaymentSettingsRepository;
  /** The platform's own Stripe adapter (one Stripe account for the whole platform). Absent ⇒ Stripe is unavailable. */
  readonly stripe: PaymentProvider | undefined;
  readonly cashOnDelivery: PaymentProvider;
  readonly paymobFactory: PaymobProviderFactory | undefined;
  readonly vault: PaymentCredentialVault | undefined;
}

/**
 * Resolves a `PaymentProvider` per request from the request's tenant and the shopper's selected
 * method — the ADR-0014 shape for something that used to be a construction-time singleton.
 *
 * What makes this per-tenant rather than one shared object:
 *  - it holds NO tenant and NO merchant credential: only the settings repository, the vault, the
 *    platform's own Stripe adapter and factories. `assertMultiTenantReady`'s graph walk finds no
 *    `tenantId` field here, and there is no merchant secret in it to leak between tenants;
 *  - a merchant's Paymob provider is BUILT on each call, from that tenant's sealed credentials, and
 *    never cached — there is no map keyed by tenant that a bug could read the wrong slot of;
 *  - it has no fallback. A missing vault, factory, credentials or enablement throws
 *    {@link PaymentProviderUnavailableError}; it never substitutes an in-memory PSP.
 */
export class TenantPaymentProviderResolver implements PaymentProviderResolver {
  private readonly deps: TenantPaymentProviderResolverDeps;

  constructor(deps: TenantPaymentProviderResolverDeps) {
    this.deps = deps;
  }

  async resolveForNewPayment(
    tenantId: string,
    provider: PaymentProviderKey,
  ): Promise<PaymentProvider> {
    const settings = (await this.deps.settings.get(tenantId)) ?? MerchantPaymentSettings.defaults();
    if (!settings.isEnabled(provider)) {
      throw new PaymentProviderUnavailableError(provider, "the merchant has not enabled it");
    }
    return this.build(tenantId, provider, settings);
  }

  async resolveForExisting(
    tenantId: string,
    provider: PaymentProviderKey,
  ): Promise<PaymentProvider> {
    const settings = (await this.deps.settings.get(tenantId)) ?? MerchantPaymentSettings.defaults();
    return this.build(tenantId, provider, settings);
  }

  describe(): ProviderAvailability {
    const backing = (provider: PaymentProvider | undefined): ProviderBacking =>
      provider === undefined
        ? "absent"
        : provider instanceof InMemoryPaymentProvider
          ? "stub"
          : "real";
    return {
      stripe: backing(this.deps.stripe),
      cod: backing(this.deps.cashOnDelivery),
      paymob: this.deps.paymobFactory === undefined ? "absent" : "real",
      credentialVault: this.deps.vault?.backing ?? "absent",
    };
  }

  private async build(
    tenantId: string,
    provider: PaymentProviderKey,
    settings: MerchantPaymentSettings,
  ): Promise<PaymentProvider> {
    switch (provider) {
      case "stripe": {
        if (this.deps.stripe === undefined) {
          throw new PaymentProviderUnavailableError(
            provider,
            "Stripe is not configured on this platform",
          );
        }
        return this.deps.stripe;
      }
      case "cod":
        return this.deps.cashOnDelivery;
      case "paymob": {
        const config = settings.paymob;
        if (config === undefined) {
          throw new PaymentProviderUnavailableError(
            provider,
            "the merchant has not configured Paymob",
          );
        }
        if (this.deps.vault === undefined || this.deps.paymobFactory === undefined) {
          throw new PaymentProviderUnavailableError(
            provider,
            "Paymob is not available on this platform",
          );
        }
        const secrets = await this.deps.vault.open(tenantId, "paymob", config.sealedCredentials);
        const { secretKey, hmacSecret, publicKey } = secrets;
        if (secretKey === undefined || hmacSecret === undefined || publicKey === undefined) {
          throw new PaymentProviderUnavailableError(
            provider,
            "the merchant's Paymob credentials are incomplete",
          );
        }
        return this.deps.paymobFactory({
          region: config.region,
          integrationId: config.integrationId,
          secretKey,
          hmacSecret,
          publicKey,
        });
      }
    }
  }
}
