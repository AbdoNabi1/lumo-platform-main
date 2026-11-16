import type { CarrierProvider } from "../application/carrier-provider";
import type { CarrierRegistry } from "../application/carrier-registry";
import {
  CarrierResolutionError,
  type CarrierResolutionPurpose,
  type CarrierResolver,
} from "../application/carrier-resolver";
import type { CarrierCredentialVault } from "../application/ports";
import type { MerchantCarrierSettingsRepository } from "../domain/merchant-carrier-settings-repository";

/**
 * The single field a webhook secret envelope holds: `vault.seal(tenantId, webhookVaultKey(key),
 * { [WEBHOOK_SECRET_FIELD]: secret })`.
 */
export const WEBHOOK_SECRET_FIELD = "secret";

/** The vault key a webhook secret is sealed under (Ruling 27). */
export function webhookVaultKey(carrierKey: string): string {
  return `${carrierKey}:webhook`;
}

export interface TenantCarrierResolverDeps {
  readonly settings: MerchantCarrierSettingsRepository;
  /** What was registered at boot: declarations and factories only, no tenant, no credential. */
  readonly registry: CarrierRegistry;
  /** Absent ⇒ every carrier is unavailable. There is no stub default. */
  readonly vault: CarrierCredentialVault | undefined;
}

/**
 * Resolves one tenant's carrier per call (ADR-0014, spec §7 "credentials are resolved per call and
 * never cached across tenants").
 *
 * It holds NO tenant and NO merchant credential: only the settings repository, the vault and the
 * registry of factories, so `assertMultiTenantReady`'s graph walk finds no `tenantId` here. The
 * provider is built afresh on every call from that tenant's sealed credentials and never cached.
 * A `stub` vault or registration is accepted here; refusing stubs outside `local` is the boot
 * guard's job (Task 12).
 */
export class TenantCarrierResolver implements CarrierResolver {
  private readonly deps: TenantCarrierResolverDeps;

  constructor(deps: TenantCarrierResolverDeps) {
    this.deps = deps;
  }

  async resolve(
    tenantId: string,
    carrierKey: string,
    purpose: CarrierResolutionPurpose,
  ): Promise<CarrierProvider> {
    const registration = this.deps.registry.get(carrierKey);
    if (registration === undefined) throw new CarrierResolutionError("CARRIER_UNKNOWN");

    const vault = this.deps.vault;
    if (vault === undefined) throw new CarrierResolutionError("CARRIER_NOT_AVAILABLE");

    const settings = await this.deps.settings.get(tenantId);
    const stored = settings?.carrier(carrierKey);
    if (settings === null || stored === undefined) {
      throw new CarrierResolutionError("CARRIER_NOT_CONFIGURED");
    }
    if (purpose === "new_shipment" && !settings.isEnabled(carrierKey)) {
      throw new CarrierResolutionError("CARRIER_NOT_ENABLED");
    }

    let opened: Readonly<Record<string, string>>;
    try {
      opened = await vault.open(tenantId, carrierKey, stored.sealedCredentials);
    } catch {
      throw new CarrierResolutionError("CARRIER_NOT_CONFIGURED");
    }
    // Only the declared fields travel to the provider; a stray sealed field never does.
    const credentials: Record<string, string> = {};
    for (const field of registration.credentialFields) {
      const value = Object.hasOwn(opened, field) ? opened[field] : undefined;
      if (typeof value !== "string" || value.length === 0) {
        throw new CarrierResolutionError("CARRIER_NOT_CONFIGURED");
      }
      credentials[field] = value;
    }

    let webhook: Readonly<Record<string, string>>;
    try {
      webhook = await vault.open(
        tenantId,
        webhookVaultKey(carrierKey),
        stored.webhook.sealedSecret,
      );
    } catch {
      throw new CarrierResolutionError("CARRIER_NOT_CONFIGURED");
    }
    const secret = Object.hasOwn(webhook, WEBHOOK_SECRET_FIELD)
      ? webhook[WEBHOOK_SECRET_FIELD]
      : undefined;
    if (typeof secret !== "string" || secret.length === 0) {
      throw new CarrierResolutionError("CARRIER_NOT_CONFIGURED");
    }

    return registration.create({
      config: stored.config,
      credentials,
      webhookHeaders: { "x-tenant-id": tenantId, Authorization: secret },
    });
  }
}
