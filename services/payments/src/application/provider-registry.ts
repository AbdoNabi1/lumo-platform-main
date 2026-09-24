import type { PaymentProvider } from "@platform/contracts";
import type { ProviderCapabilities } from "../domain/value-objects/provider-capabilities";
import {
  isWellFormedProviderKey,
  type PaymentProviderKey,
} from "../domain/value-objects/payment-provider-key";

export type { ProviderCapabilities } from "../domain/value-objects/provider-capabilities";

/**
 * How the platform backs a provider, for the production boot guard. `stub` is an in-memory
 * stand-in that answers without a real PSP behind it; `absent` is a provider nothing was registered
 * for (it has no registration at all — it cannot be `absent` inside the registry).
 */
export type ProviderBacking = "real" | "stub" | "absent";

export type ConfigParseResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string };

/** What a provider is built from for ONE resolution: the merchant's opened credentials and their non-secret config. Never retained. */
export interface ProviderBuildContext {
  /** The provider's own non-secret routing config, exactly as its `parseConfig` returned it. `{}` for a provider with none. */
  readonly config: Readonly<Record<string, unknown>>;
  /** The merchant's opened secrets, keyed by the registration's `credentialFields`. `{}` unless the provider requires merchant credentials. */
  readonly credentials: Readonly<Record<string, string>>;
}

/**
 * What a provider hands over at composition time — the whole of "adding a provider". Registration
 * happens once, at the composition root (ADR-0014); resolution stays per request. A registration
 * therefore holds only functions and declarations: no tenant, no merchant credential, no built
 * provider instance for a merchant — `create` is called afresh for every resolution and its result
 * is never cached here.
 */
export interface ProviderRegistration {
  /** Lower-case key the shopper selects and that is persisted on the intent (`stripe`, `acme-pay`…). */
  readonly key: PaymentProviderKey;
  readonly capabilities: ProviderCapabilities;
  /**
   * `real` if a genuine PSP (or genuinely PSP-free method) backs it, `stub` for an in-memory
   * stand-in. A registration with no real backing must be left OUT — a provider that cannot be
   * served is unavailable, never downgraded. `stub` exists only so the offline dev/test default can
   * compose, and the production guard refuses it outside `local`.
   */
  readonly backing: Exclude<ProviderBacking, "absent">;
  /** Offered to a merchant with no stored settings. Governs what is OFFERED, never what is chosen. */
  readonly enabledByDefault?: boolean;
  /**
   * The secret fields a merchant must supply (`["secretKey", "hmacSecret"]`). Required, non-empty,
   * exactly when `capabilities.requiresMerchantCredentials`.
   */
  readonly credentialFields?: readonly string[];
  /**
   * Validates and normalises the provider's own non-secret routing data at the write boundary.
   * Absent ⇒ the provider takes no config and `{}` is stored.
   */
  readonly parseConfig?: (raw: unknown) => ConfigParseResult;
  /** Operator-facing hint for the production guard when this provider is not really backed. */
  readonly configurationHint?: string;
  readonly create: (context: ProviderBuildContext) => PaymentProvider;
}

/**
 * The set of providers registered at composition time. It answers questions BY KEY. It has no
 * operation that picks a provider — no "first", "best", "cheapest" or "default": the shopper's
 * explicit choice is the only selector (WP-13 decision 3), and `provider-registry.test.ts` fails if
 * one is added.
 */
export class PaymentProviderRegistry {
  private readonly byKey: ReadonlyMap<PaymentProviderKey, ProviderRegistration>;

  private constructor(byKey: ReadonlyMap<PaymentProviderKey, ProviderRegistration>) {
    this.byKey = byKey;
  }

  /** Validates every registration and refuses a duplicate key: a later registration must never silently replace an earlier one. */
  static from(registrations: readonly ProviderRegistration[]): PaymentProviderRegistry {
    const byKey = new Map<PaymentProviderKey, ProviderRegistration>();
    for (const registration of registrations) {
      if (!isWellFormedProviderKey(registration.key)) {
        throw new Error(
          `Payment provider key "${registration.key}" is malformed: use lower-case letters, digits, "-" and "_", starting with a letter`,
        );
      }
      if (byKey.has(registration.key)) {
        throw new Error(`Payment provider "${registration.key}" is already registered`);
      }
      const fields = registration.credentialFields ?? [];
      if (registration.capabilities.requiresMerchantCredentials !== fields.length > 0) {
        throw new Error(
          `Payment provider "${registration.key}": credentialFields must be non-empty exactly when the provider requires merchant credentials`,
        );
      }
      byKey.set(registration.key, registration);
    }
    return new PaymentProviderRegistry(byKey);
  }

  get(key: PaymentProviderKey): ProviderRegistration | undefined {
    return this.byKey.get(key);
  }

  has(key: PaymentProviderKey): boolean {
    return this.byKey.has(key);
  }

  /** Every registration, in registration order — which carries no meaning. */
  list(): readonly ProviderRegistration[] {
    return [...this.byKey.values()];
  }

  /** The keys registrations declare `enabledByDefault` — the OFFERED set for a merchant who has stored nothing. */
  defaultEnabled(): readonly PaymentProviderKey[] {
    return this.list()
      .filter((registration) => registration.enabledByDefault === true)
      .map((registration) => registration.key);
  }
}
