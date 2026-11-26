import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, ConflictError, type DomainError } from "@platform/utils";
import {
  effectiveCheckoutSettings,
  SETTINGS_STALE_MESSAGE,
  validateCheckoutSettings,
  type CheckoutSettingsValues,
} from "../domain/checkout-settings";
import type { CheckoutSettingsRepository } from "../domain/checkout-settings-repository";

export interface CheckoutSettingsDeps {
  readonly settings: CheckoutSettingsRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** The settings in force plus the optimistic-lock version (null while the shop has never saved any). */
export interface CheckoutSettingsOutput {
  readonly values: CheckoutSettingsValues;
  readonly version: number | null;
}

export interface GetCheckoutSettingsInput {
  readonly tenantId: string;
}

/** Reads the shop's checkout settings; a shop that never saved any gets today's behaviour. */
export class GetCheckoutSettings implements UseCase<
  GetCheckoutSettingsInput,
  CheckoutSettingsOutput,
  DomainError
> {
  private readonly deps: Pick<CheckoutSettingsDeps, "settings">;

  constructor(deps: Pick<CheckoutSettingsDeps, "settings">) {
    this.deps = deps;
  }

  async execute(
    input: GetCheckoutSettingsInput,
  ): Promise<Result<CheckoutSettingsOutput, DomainError>> {
    const stored = await this.deps.settings.find(input.tenantId);
    return ok({
      values: effectiveCheckoutSettings(stored),
      version: stored?.version ?? null,
    });
  }
}

export interface UpdateCheckoutSettingsInput {
  readonly tenantId: string;
  /** The version the page loaded; null when it loaded the defaults (no row yet). */
  readonly expectedVersion: number | null;
  readonly values: unknown;
}

/** Saves the whole settings document; a stale `expectedVersion` is a CONFLICT, never an overwrite. */
export class UpdateCheckoutSettings implements UseCase<
  UpdateCheckoutSettingsInput,
  CheckoutSettingsOutput,
  DomainError
> {
  private readonly deps: CheckoutSettingsDeps;

  constructor(deps: CheckoutSettingsDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdateCheckoutSettingsInput,
  ): Promise<Result<CheckoutSettingsOutput, DomainError>> {
    const values = validateCheckoutSettings(input.values);
    if (!values.ok) return err(values.error);

    return this.deps.unitOfWork.run<Result<CheckoutSettingsOutput, DomainError>>(async (tx) => {
      const stored = await this.deps.settings.find(input.tenantId, tx);
      if ((stored?.version ?? null) !== input.expectedVersion) {
        return err(new ConflictError(SETTINGS_STALE_MESSAGE));
      }
      try {
        const version = await this.deps.settings.save(
          input.tenantId,
          values.value,
          input.expectedVersion,
          tx,
        );
        return ok({ values: values.value, version });
      } catch (error) {
        if (error instanceof ConcurrencyError)
          return err(new ConflictError(SETTINGS_STALE_MESSAGE));
        throw error;
      }
    });
  }
}
