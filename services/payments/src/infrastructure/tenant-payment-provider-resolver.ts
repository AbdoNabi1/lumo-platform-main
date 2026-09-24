import type { OffSessionPaymentProvider, PaymentProvider } from "@platform/contracts";
import type {
  PaymentCredentialVault,
  PaymentProviderResolver,
  ProviderAvailability,
} from "../application/ports";
import { PaymentProviderUnavailableError } from "../application/ports";
import {
  isOffSessionRegistration,
  type PaymentProviderRegistry,
  type ProviderBuildContext,
  type ProviderRegistration,
} from "../application/provider-registry";
import { MerchantPaymentSettings } from "../domain/merchant-payment-settings";
import type { MerchantPaymentSettingsRepository } from "../domain/merchant-payment-settings-repository";
import type { PaymentProviderKey } from "../domain/value-objects/payment-provider-key";
import type { ProviderCapabilities } from "../domain/value-objects/provider-capabilities";

export interface TenantPaymentProviderResolverDeps {
  readonly settings: MerchantPaymentSettingsRepository;
  /** What was registered at composition time. Declarations and factories only — no tenant, no merchant credential. */
  readonly registry: PaymentProviderRegistry;
  readonly vault: PaymentCredentialVault | undefined;
}

/**
 * Resolves a `PaymentProvider` per request from the request's tenant and the shopper's selected
 * method — the ADR-0014 shape for something that used to be a construction-time singleton.
 *
 * What makes this per-tenant rather than one shared object:
 *  - it holds NO tenant and NO merchant credential: only the settings repository, the vault and the
 *    registry of factories. `assertMultiTenantReady`'s graph walk finds no `tenantId` field here,
 *    and there is no merchant secret in it to leak between tenants;
 *  - a merchant's provider is BUILT on each call, from that tenant's sealed credentials, and never
 *    cached — there is no map keyed by tenant that a bug could read the wrong slot of;
 *  - it has no fallback and no preference. `provider` is always the shopper's explicit choice, and
 *    a missing registration, vault, credentials, enablement or capability throws
 *    {@link PaymentProviderUnavailableError}; it never substitutes another provider or an
 *    in-memory PSP.
 *
 * It reasons about DECLARED CAPABILITIES (`requiresMerchantCredentials`, `chargesOffSession`),
 * never about a provider's name: adding a provider adds a registration, not a branch here.
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
    const registration = this.registered(provider);
    const settings = await this.settingsOf(tenantId);
    if (!settings.isEnabled(provider)) {
      throw new PaymentProviderUnavailableError(provider, "the merchant has not enabled it");
    }
    return registration.create(await this.contextFor(tenantId, registration, settings));
  }

  async resolveForExisting(
    tenantId: string,
    provider: PaymentProviderKey,
  ): Promise<PaymentProvider> {
    const registration = this.registered(provider);
    return registration.create(
      await this.contextFor(tenantId, registration, await this.settingsOf(tenantId)),
    );
  }

  async resolveForOffSession(
    tenantId: string,
    provider: PaymentProviderKey,
  ): Promise<OffSessionPaymentProvider> {
    const registration = this.registered(provider);
    if (!isOffSessionRegistration(registration)) {
      throw new PaymentProviderUnavailableError(
        provider,
        "it cannot charge off-session, so it is not available for recurring billing",
      );
    }
    const settings = await this.settingsOf(tenantId);
    if (!settings.isEnabled(provider)) {
      throw new PaymentProviderUnavailableError(provider, "the merchant has not enabled it");
    }
    const built = registration.create(await this.contextFor(tenantId, registration, settings));
    // The registration TYPE already forbids declaring the capability without the port; this is the
    // backstop for what a cast, plain JS or a stale build can still do. A declaration with nothing
    // behind it is refused here rather than discovered as a `TypeError` mid-renewal.
    if (typeof (built as Partial<OffSessionPaymentProvider>).chargeStoredMethod !== "function") {
      throw new PaymentProviderUnavailableError(
        provider,
        "it declares off-session charging but implements no off-session port",
      );
    }
    return built;
  }

  capabilitiesOf(provider: PaymentProviderKey): ProviderCapabilities | undefined {
    return this.deps.registry.get(provider)?.capabilities;
  }

  describe(): ProviderAvailability {
    return {
      providers: this.deps.registry.list().map((registration) => ({
        key: registration.key,
        capabilities: registration.capabilities,
        backing: registration.backing,
      })),
      credentialVault: this.deps.vault?.backing ?? "absent",
    };
  }

  private registered(provider: PaymentProviderKey): ProviderRegistration {
    const registration = this.deps.registry.get(provider);
    if (registration === undefined) {
      throw new PaymentProviderUnavailableError(
        provider,
        "no such payment method on this platform",
      );
    }
    return registration;
  }

  private async settingsOf(tenantId: string): Promise<MerchantPaymentSettings> {
    return (
      (await this.deps.settings.get(tenantId)) ??
      MerchantPaymentSettings.defaults(this.deps.registry.defaultEnabled())
    );
  }

  /** What `registration.create` is built from for ONE resolution: the merchant's opened credentials and config. */
  private async contextFor(
    tenantId: string,
    registration: ProviderRegistration,
    settings: MerchantPaymentSettings,
  ): Promise<ProviderBuildContext> {
    const provider = registration.key;
    if (!registration.capabilities.requiresMerchantCredentials) {
      return { config: {}, credentials: {} };
    }
    const stored = settings.providerSettings(provider);
    if (stored === undefined) {
      throw new PaymentProviderUnavailableError(provider, "the merchant has not configured it");
    }
    if (this.deps.vault === undefined) {
      throw new PaymentProviderUnavailableError(provider, "it is not available on this platform");
    }
    const opened = await this.deps.vault.open(tenantId, provider, stored.sealedCredentials);
    const credentials: Record<string, string> = {};
    for (const field of registration.credentialFields ?? []) {
      const value = opened[field];
      if (value === undefined) {
        throw new PaymentProviderUnavailableError(
          provider,
          "the merchant's credentials are incomplete",
        );
      }
      credentials[field] = value;
    }
    return { config: stored.config, credentials };
  }
}
