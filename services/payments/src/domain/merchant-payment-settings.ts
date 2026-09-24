import { BusinessRuleError } from "@platform/domain";
import type { ProviderCapabilities } from "./value-objects/provider-capabilities";
import {
  isWellFormedProviderKey,
  type PaymentProviderKey,
} from "./value-objects/payment-provider-key";

/**
 * One provider's per-merchant configuration. `config` is opaque to this domain: the provider's own
 * NON-secret routing data (a region, an integration id, …), shaped and validated by that provider's
 * registration at the boundary — never here. `sealedCredentials` is the opaque, already-encrypted
 * envelope produced by `PaymentCredentialVault.seal`; the aggregate never sees, holds or logs
 * plaintext.
 */
export interface ProviderSettings {
  readonly config: Readonly<Record<string, unknown>>;
  readonly sealedCredentials: string;
}

interface MerchantPaymentSettingsProps {
  readonly enabledMethods: readonly PaymentProviderKey[];
  readonly providers: Readonly<Record<PaymentProviderKey, ProviderSettings>>;
}

/** Looks up what a provider declares; `undefined` for a key nothing registered. */
export type CapabilityLookup = (key: PaymentProviderKey) => ProviderCapabilities | undefined;

/**
 * Which payment methods a merchant offers, and how to reach the ones that need credentials
 * (WP-13 T13.2). One per tenant, addressed by the per-call `tenantId` (ADR-0014) — the object
 * itself carries none.
 *
 * "Enabled" only governs what the shopper is OFFERED. It never picks a method: the order in
 * `enabledMethods` is not a priority, and nothing reads it as one.
 */
export class MerchantPaymentSettings {
  private readonly props: MerchantPaymentSettingsProps;

  private constructor(props: MerchantPaymentSettingsProps) {
    this.props = props;
  }

  /**
   * What a merchant with no stored settings gets: whatever the registered providers declare as
   * `enabledByDefault` (Stripe, so a deployment that was taking Stripe payments keeps doing so).
   * Everything else is opt-in.
   */
  static defaults(enabledByDefault: readonly PaymentProviderKey[]): MerchantPaymentSettings {
    return new MerchantPaymentSettings({ enabledMethods: [...enabledByDefault], providers: {} });
  }

  static reconstitute(props: MerchantPaymentSettingsProps): MerchantPaymentSettings {
    return new MerchantPaymentSettings({
      enabledMethods: [...props.enabledMethods],
      providers: { ...props.providers },
    });
  }

  get enabledMethods(): readonly PaymentProviderKey[] {
    return this.props.enabledMethods;
  }

  /** Every provider this merchant has configured, by key. */
  get providers(): Readonly<Record<PaymentProviderKey, ProviderSettings>> {
    return this.props.providers;
  }

  providerSettings(key: PaymentProviderKey): ProviderSettings | undefined {
    return Object.prototype.hasOwnProperty.call(this.props.providers, key)
      ? this.props.providers[key]
      : undefined;
  }

  isEnabled(method: PaymentProviderKey): boolean {
    return this.props.enabledMethods.includes(method);
  }

  /**
   * Replaces the enabled set. A key nothing registered is refused, and so is a provider that needs
   * merchant credentials before those are configured. Duplicates collapse; the order the caller
   * gave is kept but carries no meaning.
   */
  withEnabledMethods(
    methods: readonly PaymentProviderKey[],
    capabilitiesOf: CapabilityLookup,
  ): MerchantPaymentSettings {
    const unique = [...new Set(methods)];
    for (const key of unique) {
      const capabilities = capabilitiesOf(key);
      if (capabilities === undefined) {
        throw new BusinessRuleError("Unknown payment method in enabled set");
      }
      if (capabilities.requiresMerchantCredentials && this.providerSettings(key) === undefined) {
        throw new BusinessRuleError(
          `Payment method "${key}" cannot be enabled before its credentials are configured`,
        );
      }
    }
    return new MerchantPaymentSettings({ ...this.props, enabledMethods: unique });
  }

  /** Stores one provider's already-validated config and its sealed credentials. */
  withProviderSettings(
    key: PaymentProviderKey,
    settings: {
      readonly config: Readonly<Record<string, unknown>>;
      readonly sealedCredentials: string;
    },
  ): MerchantPaymentSettings {
    if (!isWellFormedProviderKey(key)) {
      throw new BusinessRuleError("Provider key is malformed");
    }
    if (settings.sealedCredentials.length === 0) {
      throw new BusinessRuleError(`Credentials for "${key}" must be sealed before they are stored`);
    }
    return new MerchantPaymentSettings({
      ...this.props,
      providers: {
        ...this.props.providers,
        [key]: { config: settings.config, sealedCredentials: settings.sealedCredentials },
      },
    });
  }
}
