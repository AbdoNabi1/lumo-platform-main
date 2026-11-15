import { isWellFormedCarrierKey } from "../domain/value-objects/carrier-key";
import type { CarrierProvider } from "./carrier-provider";

export interface CarrierCapabilities {
  readonly cod: boolean;
  readonly awb: boolean;
  readonly webhooks: boolean;
  readonly cancel: boolean;
}

export type CarrierConfigParseResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string };

/** What a provider is built from for ONE resolution. Never retained by the registry or resolver. */
export interface CarrierBuildContext {
  readonly config: Readonly<Record<string, unknown>>;
  readonly credentials: Readonly<Record<string, string>>;
  /** { "x-tenant-id", Authorization } for a resolved tenant; {} for a credential check. */
  readonly webhookHeaders: Readonly<Record<string, string>>;
}

/**
 * What a carrier hands over at composition time: the whole of "adding a carrier". It holds only
 * declarations and a factory, never a tenant, a merchant credential or a built provider.
 */
export interface CarrierRegistration {
  readonly key: string;
  readonly displayName: string;
  /** `stub` only so an offline default can compose; the boot guard (Task 12) refuses it outside local. */
  readonly backing: "real" | "stub";
  /** The secret fields a merchant supplies (`["apiKey"]`). Non-empty. */
  readonly credentialFields: readonly string[];
  readonly parseConfig: (raw: unknown) => CarrierConfigParseResult;
  readonly capabilities: CarrierCapabilities;
  /** Absolute webhook URL Bosta posts to; null ⇒ statuses never follow (Ruling 31). */
  readonly webhookUrl: string | null;
  readonly create: (context: CarrierBuildContext) => CarrierProvider;
}

/**
 * The carriers composed at boot. It answers BY KEY and has no operation that picks one for a
 * merchant: the merchant's own selection is the only selector.
 */
export class CarrierRegistry {
  private readonly byKey: ReadonlyMap<string, CarrierRegistration>;

  private constructor(byKey: ReadonlyMap<string, CarrierRegistration>) {
    this.byKey = byKey;
  }

  /** Refuses a malformed key, a duplicate key and empty `credentialFields`: nothing is silently replaced. */
  static from(registrations: readonly CarrierRegistration[]): CarrierRegistry {
    const byKey = new Map<string, CarrierRegistration>();
    for (const registration of registrations) {
      if (!isWellFormedCarrierKey(registration.key)) {
        throw new Error(
          `Carrier key "${registration.key}" is malformed: use 2–32 lower-case letters, digits, "-" and "_", starting with a letter`,
        );
      }
      if (byKey.has(registration.key)) {
        throw new Error(`Carrier "${registration.key}" is already registered`);
      }
      if (registration.credentialFields.length === 0) {
        throw new Error(`Carrier "${registration.key}": credentialFields must be non-empty`);
      }
      byKey.set(registration.key, registration);
    }
    return new CarrierRegistry(byKey);
  }

  get(key: string): CarrierRegistration | undefined {
    return this.byKey.get(key);
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** Every registration, in registration order — which carries no meaning. */
  list(): readonly CarrierRegistration[] {
    return [...this.byKey.values()];
  }
}
