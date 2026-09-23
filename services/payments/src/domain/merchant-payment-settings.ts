import { BusinessRuleError } from "@platform/domain";
import {
  PAYMENT_PROVIDER_KEYS,
  type PaymentProviderKey,
} from "./value-objects/payment-provider-key";

/**
 * The Paymob regions the adapter supports (`@platform/psp-paymob`'s `isPaymobRegion` is the source
 * of truth; a test in `apps/runtime` pins this list to it). Mirrored here because the domain may
 * depend on nothing but the kernel.
 */
export const PAYMOB_REGIONS = ["egy", "ksa", "uae"] as const;
export type PaymobRegionKey = (typeof PAYMOB_REGIONS)[number];

/**
 * A merchant's Paymob configuration. `sealedCredentials` is the opaque, already-encrypted envelope
 * (secret key, HMAC secret, public key) produced by `PaymentCredentialVault.seal` — the aggregate
 * never sees, holds or logs plaintext. `region` and `integrationId` are non-secret routing data.
 */
export interface PaymobSettings {
  readonly region: PaymobRegionKey;
  readonly integrationId: number;
  readonly sealedCredentials: string;
}

interface MerchantPaymentSettingsProps {
  readonly enabledMethods: readonly PaymentProviderKey[];
  readonly paymob: PaymobSettings | undefined;
}

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
   * What a merchant with no stored settings gets: Stripe only — the one provider that existed
   * before merchant configuration did, so a deployment that was taking Stripe payments keeps doing
   * so. COD and Paymob are always opt-in.
   */
  static defaults(): MerchantPaymentSettings {
    return new MerchantPaymentSettings({ enabledMethods: ["stripe"], paymob: undefined });
  }

  static reconstitute(props: MerchantPaymentSettingsProps): MerchantPaymentSettings {
    return new MerchantPaymentSettings({
      enabledMethods: [...props.enabledMethods],
      paymob: props.paymob,
    });
  }

  get enabledMethods(): readonly PaymentProviderKey[] {
    return this.props.enabledMethods;
  }

  get paymob(): PaymobSettings | undefined {
    return this.props.paymob;
  }

  isEnabled(method: PaymentProviderKey): boolean {
    return this.props.enabledMethods.includes(method);
  }

  /** Replaces the enabled set. `paymob` cannot be enabled without Paymob configuration to back it. */
  withEnabledMethods(methods: readonly PaymentProviderKey[]): MerchantPaymentSettings {
    const unique = PAYMENT_PROVIDER_KEYS.filter((key) => methods.includes(key));
    if (unique.length !== new Set(methods).size) {
      throw new BusinessRuleError("Unknown payment method in enabled set");
    }
    if (unique.includes("paymob") && this.props.paymob === undefined) {
      throw new BusinessRuleError("Paymob cannot be enabled before its credentials are configured");
    }
    return new MerchantPaymentSettings({ ...this.props, enabledMethods: unique });
  }

  withPaymob(paymob: {
    readonly region: string;
    readonly integrationId: number;
    readonly sealedCredentials: string;
  }): MerchantPaymentSettings {
    const region = PAYMOB_REGIONS.find((candidate) => candidate === paymob.region);
    if (region === undefined) {
      throw new BusinessRuleError(`Unsupported Paymob region "${paymob.region}"`);
    }
    if (!Number.isSafeInteger(paymob.integrationId) || paymob.integrationId <= 0) {
      throw new BusinessRuleError("Paymob integration id must be a positive integer");
    }
    if (paymob.sealedCredentials.length === 0) {
      throw new BusinessRuleError("Paymob credentials must be sealed before they are stored");
    }
    return new MerchantPaymentSettings({
      ...this.props,
      paymob: {
        region,
        integrationId: paymob.integrationId,
        sealedCredentials: paymob.sealedCredentials,
      },
    });
  }
}
