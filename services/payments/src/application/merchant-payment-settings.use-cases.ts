import type { UseCase } from "@platform/application";
import { BusinessRuleError, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { MerchantPaymentSettings } from "../domain/merchant-payment-settings";
import type { MerchantPaymentSettingsRepository } from "../domain/merchant-payment-settings-repository";
import {
  isPaymentProviderKey,
  type PaymentProviderKey,
} from "../domain/value-objects/payment-provider-key";
import type { PaymentCredentialVault, PaymentProviderResolver } from "./ports";

/**
 * What a read of a merchant's payment settings returns — fully primitive, and by construction free
 * of credentials: it has no field a secret could occupy. `configured` says whether Paymob
 * credentials exist; it never says what they are.
 */
export interface MerchantPaymentSettingsDto {
  /** Methods the shopper is offered. The order carries no meaning — nothing picks the first. */
  readonly enabledMethods: readonly PaymentProviderKey[];
  readonly methods: {
    readonly stripe: { readonly available: boolean };
    readonly paymob: {
      readonly available: boolean;
      readonly configured: boolean;
      readonly region?: string;
      readonly integrationId?: number;
    };
    readonly cod: { readonly available: boolean };
  };
}

export interface MerchantPaymentSettingsDeps {
  readonly settings: MerchantPaymentSettingsRepository;
  readonly providers: PaymentProviderResolver;
}

function toDto(
  settings: MerchantPaymentSettings,
  providers: PaymentProviderResolver,
): MerchantPaymentSettingsDto {
  const availability = providers.describe();
  const paymob = settings.paymob;
  return {
    enabledMethods: [...settings.enabledMethods],
    methods: {
      stripe: { available: availability.stripe !== "absent" },
      paymob: {
        available: availability.paymob === "real" && availability.credentialVault !== "absent",
        configured: paymob !== undefined,
        ...(paymob !== undefined
          ? { region: paymob.region, integrationId: paymob.integrationId }
          : {}),
      },
      cod: { available: availability.cod !== "absent" },
    },
  };
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
      (await this.deps.settings.get(input.tenantId)) ?? MerchantPaymentSettings.defaults();
    return ok(toDto(settings, this.deps.providers));
  }
}

export interface PaymobCredentialsInput {
  readonly region: string;
  readonly integrationId: number;
  readonly secretKey: string;
  readonly hmacSecret: string;
  readonly publicKey: string;
}

export interface UpdateMerchantPaymentSettingsInput {
  readonly tenantId: string;
  readonly enabledMethods?: readonly string[];
  /**
   * WRITE-ONLY. Sealed into the credential vault before anything is stored; no read ever returns
   * it and no error message contains it.
   */
  readonly paymob?: PaymobCredentialsInput;
}

export interface UpdateMerchantPaymentSettingsDeps extends MerchantPaymentSettingsDeps {
  readonly vault: PaymentCredentialVault | undefined;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

const MAX_SECRET_LENGTH = 512;

function isSecretString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_SECRET_LENGTH;
}

/**
 * Configures which payment methods a merchant offers and stores their Paymob credentials sealed
 * (WP-13 T13.2). Refuses to enable anything the platform cannot really back — so a merchant cannot
 * switch on a method that would be served by a stub: Stripe needs the platform's Stripe adapter,
 * Paymob needs a real adapter, a real credential vault and stored credentials.
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
    const requested = input.enabledMethods;
    if (requested !== undefined) {
      if (requested.length === 0) {
        return err(new BusinessRuleError("A merchant must offer at least one payment method"));
      }
      if (!requested.every(isPaymentProviderKey)) {
        return err(new ValidationError("Unknown payment method", []));
      }
    }

    const availability = this.deps.providers.describe();
    if (requested?.includes("stripe") && availability.stripe === "absent") {
      return err(new BusinessRuleError("Stripe is not configured on this platform"));
    }
    if (
      (requested?.includes("paymob") || input.paymob !== undefined) &&
      (availability.paymob !== "real" || availability.credentialVault === "absent")
    ) {
      return err(new BusinessRuleError("Paymob is not available on this platform"));
    }

    let sealed: string | undefined;
    if (input.paymob !== undefined) {
      const p = input.paymob;
      if (
        !isSecretString(p.secretKey) ||
        !isSecretString(p.hmacSecret) ||
        !isSecretString(p.publicKey)
      ) {
        // The message names no field value — never a secret, not even its length.
        return err(new ValidationError("Paymob credentials are incomplete or invalid", []));
      }
      if (this.deps.vault === undefined) {
        return err(new BusinessRuleError("Paymob is not available on this platform"));
      }
      sealed = await this.deps.vault.seal(input.tenantId, "paymob", {
        secretKey: p.secretKey,
        hmacSecret: p.hmacSecret,
        publicKey: p.publicKey,
      });
    }

    return this.deps.unitOfWork.run<Result<MerchantPaymentSettingsDto, DomainError>>(async (tx) => {
      let settings =
        (await this.deps.settings.get(input.tenantId, tx)) ?? MerchantPaymentSettings.defaults();
      try {
        if (input.paymob !== undefined && sealed !== undefined) {
          settings = settings.withPaymob({
            region: input.paymob.region,
            integrationId: input.paymob.integrationId,
            sealedCredentials: sealed,
          });
        }
        if (requested !== undefined) {
          settings = settings.withEnabledMethods(requested);
        }
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.settings.save(settings, input.tenantId, tx);
      return ok(toDto(settings, this.deps.providers));
    });
  }
}
