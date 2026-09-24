import type { UseCase } from "@platform/application";
import { BusinessRuleError, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { MerchantPaymentSettings } from "../domain/merchant-payment-settings";
import type { MerchantPaymentSettingsRepository } from "../domain/merchant-payment-settings-repository";
import {
  isWellFormedProviderKey,
  type PaymentProviderKey,
} from "../domain/value-objects/payment-provider-key";
import type { PaymentCredentialVault } from "./ports";
import type { PaymentProviderRegistry, ProviderRegistration } from "./provider-registry";

/**
 * One registered method as a merchant sees it. By construction free of credentials: it has no field
 * a secret could occupy. `configured` (only for a provider that takes merchant credentials) says
 * whether credentials exist; it never says what they are. `config` is the provider's own NON-secret
 * routing data, exactly as its registration normalised it.
 */
export interface ProviderMethodDto {
  readonly available: boolean;
  readonly configured?: boolean;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** What a read of a merchant's payment settings returns — fully primitive. */
export interface MerchantPaymentSettingsDto {
  /** Methods the shopper is offered. The order carries no meaning — nothing picks the first. */
  readonly enabledMethods: readonly PaymentProviderKey[];
  /** Every method registered on this platform, by key. */
  readonly methods: Readonly<Record<PaymentProviderKey, ProviderMethodDto>>;
}

export interface MerchantPaymentSettingsDeps {
  readonly settings: MerchantPaymentSettingsRepository;
  readonly registry: PaymentProviderRegistry;
  readonly vault: PaymentCredentialVault | undefined;
}

function isAvailable(
  registration: ProviderRegistration,
  vault: PaymentCredentialVault | undefined,
): boolean {
  if (!registration.capabilities.requiresMerchantCredentials) return true;
  return registration.backing === "real" && vault !== undefined && vault.backing !== "absent";
}

function toDto(
  settings: MerchantPaymentSettings,
  deps: MerchantPaymentSettingsDeps,
): MerchantPaymentSettingsDto {
  const methods: Record<PaymentProviderKey, ProviderMethodDto> = {};
  for (const registration of deps.registry.list()) {
    const stored = settings.providerSettings(registration.key);
    methods[registration.key] = {
      available: isAvailable(registration, deps.vault),
      ...(registration.capabilities.requiresMerchantCredentials
        ? { configured: stored !== undefined }
        : {}),
      ...(stored !== undefined ? { config: stored.config } : {}),
    };
  }
  return { enabledMethods: [...settings.enabledMethods], methods };
}

export interface GetMerchantPaymentSettingsInput {
  readonly tenantId: string;
}

/** Reads a merchant's payment settings (defaults if none stored). */
export class GetMerchantPaymentSettings implements UseCase<
  GetMerchantPaymentSettingsInput,
  MerchantPaymentSettingsDto,
  DomainError
> {
  private readonly deps: MerchantPaymentSettingsDeps;

  constructor(deps: MerchantPaymentSettingsDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetMerchantPaymentSettingsInput,
  ): Promise<Result<MerchantPaymentSettingsDto, DomainError>> {
    const settings =
      (await this.deps.settings.get(input.tenantId)) ??
      MerchantPaymentSettings.defaults(this.deps.registry.defaultEnabled());
    return ok(toDto(settings, this.deps));
  }
}

/** One provider's write: its own non-secret config, and its WRITE-ONLY secrets. */
export interface ProviderSettingsInput {
  /** Validated by the provider's own registration (`parseConfig`). Omit for a provider with none. */
  readonly config?: unknown;
  /** Keyed by the registration's `credentialFields`. Sealed before anything is stored. */
  readonly credentials: Readonly<Record<string, string>>;
}

export interface UpdateMerchantPaymentSettingsInput {
  readonly tenantId: string;
  readonly enabledMethods?: readonly string[];
  /**
   * WRITE-ONLY, keyed by provider. The credentials are sealed into the vault before anything is
   * stored; no read ever returns them and no error message contains them.
   */
  readonly providerSettings?: Readonly<Record<string, ProviderSettingsInput>>;
}

export interface UpdateMerchantPaymentSettingsDeps extends MerchantPaymentSettingsDeps {
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

const MAX_SECRET_LENGTH = 512;

function isSecretString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_SECRET_LENGTH;
}

interface Prepared {
  readonly key: PaymentProviderKey;
  readonly config: Readonly<Record<string, unknown>>;
  readonly sealed: string;
}

/**
 * Configures which payment methods a merchant offers and stores each provider's config and sealed
 * credentials (WP-13 T13.2). Validation lives at THIS boundary, driven by the registry: a key
 * nothing registered is refused, a provider's config is checked by that provider's own
 * `parseConfig`, its credentials must be exactly its declared `credentialFields`, and a provider
 * that needs merchant credentials cannot be enabled without them (or without a real vault). So a
 * merchant cannot switch on a method nothing real backs.
 */
export class UpdateMerchantPaymentSettings implements UseCase<
  UpdateMerchantPaymentSettingsInput,
  MerchantPaymentSettingsDto,
  DomainError
> {
  private readonly deps: UpdateMerchantPaymentSettingsDeps;

  constructor(deps: UpdateMerchantPaymentSettingsDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdateMerchantPaymentSettingsInput,
  ): Promise<Result<MerchantPaymentSettingsDto, DomainError>> {
    const { registry, vault } = this.deps;
    const requested = input.enabledMethods;
    if (requested !== undefined) {
      if (requested.length === 0) {
        return err(new BusinessRuleError("A merchant must offer at least one payment method"));
      }
      if (!requested.every((key) => isWellFormedProviderKey(key) && registry.has(key))) {
        return err(new ValidationError("Unknown payment method", []));
      }
      for (const key of requested) {
        const registration = registry.get(key);
        if (registration !== undefined && !isAvailable(registration, vault)) {
          return err(
            new BusinessRuleError(`Payment method "${key}" is not available on this platform`),
          );
        }
      }
    }

    const prepared: Prepared[] = [];
    for (const [key, entry] of Object.entries(input.providerSettings ?? {})) {
      const registration = isWellFormedProviderKey(key) ? registry.get(key) : undefined;
      if (registration === undefined) {
        return err(new ValidationError("Unknown payment method", []));
      }
      if (!isAvailable(registration, vault) || vault === undefined) {
        return err(
          new BusinessRuleError(`Payment method "${key}" is not available on this platform`),
        );
      }
      if (!registration.capabilities.requiresMerchantCredentials) {
        return err(new BusinessRuleError(`Payment method "${key}" takes no merchant credentials`));
      }

      let config: Readonly<Record<string, unknown>> = {};
      if (registration.parseConfig !== undefined) {
        const parsed = registration.parseConfig(entry.config ?? {});
        if (!parsed.ok) {
          return err(new ValidationError(`Invalid "${key}" configuration: ${parsed.reason}`, []));
        }
        config = parsed.value;
      } else if (entry.config !== undefined && Object.keys(entry.config as object).length > 0) {
        return err(new ValidationError(`Payment method "${key}" takes no configuration`, []));
      }

      const fields = registration.credentialFields ?? [];
      const supplied = entry.credentials;
      const unexpected = Object.keys(supplied).filter((field) => !fields.includes(field));
      if (unexpected.length > 0 || !fields.every((field) => isSecretString(supplied[field]))) {
        // The message names no field value — never a secret, not even its length.
        return err(new ValidationError(`Credentials for "${key}" are incomplete or invalid`, []));
      }
      const secrets: Record<string, string> = {};
      for (const field of fields) secrets[field] = supplied[field] as string;
      prepared.push({ key, config, sealed: await vault.seal(input.tenantId, key, secrets) });
    }

    return this.deps.unitOfWork.run<Result<MerchantPaymentSettingsDto, DomainError>>(async (tx) => {
      let settings =
        (await this.deps.settings.get(input.tenantId, tx)) ??
        MerchantPaymentSettings.defaults(registry.defaultEnabled());
      try {
        for (const entry of prepared) {
          settings = settings.withProviderSettings(entry.key, {
            config: entry.config,
            sealedCredentials: entry.sealed,
          });
        }
        if (requested !== undefined) {
          settings = settings.withEnabledMethods(
            requested,
            (key) => registry.get(key)?.capabilities,
          );
        }
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.settings.save(settings, input.tenantId, tx);
      return ok(toDto(settings, this.deps));
    });
  }
}
