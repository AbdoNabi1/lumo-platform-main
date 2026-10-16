import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { StoreSettingsRepository } from "../domain/repositories";
import { StoreSettings, type StoreSettingsInput } from "../domain/store-settings";

/** The wire shape of the shop's settings — never the value object itself. */
export interface StoreSettingsView {
  readonly storeName: string;
  readonly contactEmail: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly weightUnit: string;
}

export function toStoreSettingsView(settings: StoreSettings): StoreSettingsView {
  return {
    storeName: settings.storeName,
    contactEmail: settings.contactEmail,
    currency: settings.currency,
    timezone: settings.timezone,
    weightUnit: settings.weightUnit,
  };
}

export interface StoreSettingsDeps {
  readonly settings: StoreSettingsRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

export class GetStoreSettings implements UseCase<
  { readonly tenantId: string },
  StoreSettingsView,
  DomainError
> {
  private readonly deps: Pick<StoreSettingsDeps, "settings">;

  constructor(deps: Pick<StoreSettingsDeps, "settings">) {
    this.deps = deps;
  }

  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<StoreSettingsView, DomainError>> {
    const stored = await this.deps.settings.get(input.tenantId);
    return ok(toStoreSettingsView(stored ?? StoreSettings.defaults()));
  }
}

export type UpdateStoreSettingsInput = StoreSettingsInput & { readonly tenantId: string };

/** Replaces the shop's settings wholesale (Shopify's Settings → General "Save"). */
export class UpdateStoreSettings implements UseCase<
  UpdateStoreSettingsInput,
  StoreSettingsView,
  DomainError
> {
  private readonly deps: StoreSettingsDeps;

  constructor(deps: StoreSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateStoreSettingsInput): Promise<Result<StoreSettingsView, DomainError>> {
    const { tenantId, ...rest } = input;
    const created = StoreSettings.create(rest);
    if (!created.ok) return err(created.error);
    await this.deps.unitOfWork.run(async (tx) => {
      await this.deps.settings.save(tenantId, created.value, tx);
    });
    return ok(toStoreSettingsView(created.value));
  }
}

/** What the storefront may know about a shop without signing in: its name and its currency. */
export interface PublicStoreView {
  readonly name: string;
  readonly currency: string;
}

export class GetPublicStore implements UseCase<
  { readonly tenantId: string },
  PublicStoreView,
  DomainError
> {
  private readonly deps: Pick<StoreSettingsDeps, "settings">;

  constructor(deps: Pick<StoreSettingsDeps, "settings">) {
    this.deps = deps;
  }

  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<PublicStoreView, DomainError>> {
    const settings = (await this.deps.settings.get(input.tenantId)) ?? StoreSettings.defaults();
    return ok({ name: settings.storeName, currency: settings.currency });
  }
}
