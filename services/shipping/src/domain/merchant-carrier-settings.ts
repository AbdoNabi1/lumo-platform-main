import { BusinessRuleError } from "@platform/domain";
import { isWellFormedCarrierKey } from "./value-objects/carrier-key";

/** How long the previous webhook secret is still accepted after a rotation (spec: 7 days). */
export const PREVIOUS_WEBHOOK_SECRET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The webhook secret envelopes (Ruling 27: sealed under `"<key>:webhook"`, never with the API key). */
export interface CarrierWebhookSecrets {
  readonly sealedSecret: string;
  readonly previousSealedSecret?: string;
  readonly previousValidUntil?: Date;
}

/**
 * One carrier's per-merchant settings. `config` is the carrier's own NON-secret config, shaped by
 * its registration's `parseConfig` at the boundary. `sealedCredentials` and the webhook secrets are
 * opaque envelopes from `CarrierCredentialVault.seal`: this aggregate never sees plaintext.
 */
export interface StoredCarrierSettings {
  readonly config: Readonly<Record<string, unknown>>;
  readonly sealedCredentials: string;
  readonly webhook: CarrierWebhookSecrets;
}

interface Props {
  readonly enabledCarriers: readonly string[];
  readonly carriers: Readonly<Record<string, StoredCarrierSettings>>;
  readonly version: number;
}

function notConfigured(key: string): BusinessRuleError {
  return new BusinessRuleError(`CARRIER_NOT_CONFIGURED: carrier "${key}" is not configured`);
}

/**
 * Which carriers a merchant uses and how to reach them. One per tenant, addressed by the per-call
 * `tenantId` (ADR-0014): the object carries none. Immutable: every change returns a new instance
 * that keeps the LOADED `version`, which the repository uses as its optimistic guard (Ruling 29).
 */
export class MerchantCarrierSettings {
  private readonly props: Props;

  private constructor(props: Props) {
    this.props = props;
  }

  /** A merchant with nothing stored. Version 0 tells the repository to insert. */
  static empty(): MerchantCarrierSettings {
    return new MerchantCarrierSettings({ enabledCarriers: [], carriers: {}, version: 0 });
  }

  static reconstitute(props: {
    readonly enabledCarriers: readonly string[];
    readonly carriers: Readonly<Record<string, StoredCarrierSettings>>;
    readonly version: number;
  }): MerchantCarrierSettings {
    return new MerchantCarrierSettings({
      enabledCarriers: [...props.enabledCarriers],
      carriers: { ...props.carriers },
      version: props.version,
    });
  }

  get version(): number {
    return this.props.version;
  }

  get enabledCarriers(): readonly string[] {
    return this.props.enabledCarriers;
  }

  get carriers(): Readonly<Record<string, StoredCarrierSettings>> {
    return this.props.carriers;
  }

  /** Own entries only: `__proto__`, `constructor` and friends are never a configured carrier. */
  carrier(key: string): StoredCarrierSettings | undefined {
    return Object.hasOwn(this.props.carriers, key) ? this.props.carriers[key] : undefined;
  }

  /** Enabled AND configured. */
  isEnabled(key: string): boolean {
    return this.props.enabledCarriers.includes(key) && this.carrier(key) !== undefined;
  }

  /** Stores one carrier's already-validated config and its sealed secrets. */
  withCarrier(key: string, stored: StoredCarrierSettings): MerchantCarrierSettings {
    if (!isWellFormedCarrierKey(key)) {
      throw new BusinessRuleError("Carrier key is malformed");
    }
    if (stored.sealedCredentials.length === 0 || stored.webhook.sealedSecret.length === 0) {
      throw new BusinessRuleError(
        `Secrets for carrier "${key}" must be sealed before they are stored`,
      );
    }
    return this.with({ carriers: { ...this.props.carriers, [key]: stored } });
  }

  withEnabled(key: string, enabled: boolean): MerchantCarrierSettings {
    if (!enabled) {
      return this.with({ enabledCarriers: this.props.enabledCarriers.filter((k) => k !== key) });
    }
    if (this.carrier(key) === undefined) throw notConfigured(key);
    if (this.props.enabledCarriers.includes(key)) return this;
    return this.with({ enabledCarriers: [...this.props.enabledCarriers, key] });
  }

  /** The current secret becomes the previous one, accepted until `now + 7 d`. */
  withRotatedWebhook(key: string, newSealedSecret: string, now: Date): MerchantCarrierSettings {
    const current = this.carrier(key);
    if (current === undefined) throw notConfigured(key);
    if (newSealedSecret.length === 0) {
      throw new BusinessRuleError(`The webhook secret for carrier "${key}" must be sealed`);
    }
    return this.with({
      carriers: {
        ...this.props.carriers,
        [key]: {
          ...current,
          webhook: {
            sealedSecret: newSealedSecret,
            previousSealedSecret: current.webhook.sealedSecret,
            previousValidUntil: new Date(now.getTime() + PREVIOUS_WEBHOOK_SECRET_TTL_MS),
          },
        },
      },
    });
  }

  /** Disconnect (Ruling 28): drops the sealed credentials, the webhook secrets and the enablement. */
  withoutCarrier(key: string): MerchantCarrierSettings {
    const carriers = Object.fromEntries(
      Object.entries(this.props.carriers).filter(([k]) => k !== key),
    );
    return this.with({
      carriers,
      enabledCarriers: this.props.enabledCarriers.filter((k) => k !== key),
    });
  }

  private with(change: Partial<Omit<Props, "version">>): MerchantCarrierSettings {
    return new MerchantCarrierSettings({ ...this.props, ...change });
  }
}
