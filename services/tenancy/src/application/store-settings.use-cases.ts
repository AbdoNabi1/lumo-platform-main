import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { StoreSettingsRepository } from "../domain/repositories";
import { StoreSettings, type SiteType, type StoreSettingsInput } from "../domain/store-settings";

/** The wire shape of the shop's settings — never the value object itself. */
export interface StoreSettingsView {
  readonly storeName: string;
  readonly contactEmail: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly weightUnit: string;
  /** ISO-8601 instant the merchant dismissed Home's setup guide, or `null` while it still shows. */
  readonly setupGuideDismissedAt: string | null;
  /** Chosen at sign-up and fixed from then on. */
  readonly siteType: SiteType;
}

export function toStoreSettingsView(settings: StoreSettings): StoreSettingsView {
  return {
    storeName: settings.storeName,
    contactEmail: settings.contactEmail,
    currency: settings.currency,
    timezone: settings.timezone,
    weightUnit: settings.weightUnit,
    setupGuideDismissedAt: settings.setupGuideDismissedAt?.toISOString() ?? null,
    siteType: settings.siteType,
  };
}

export interface StoreSettingsDeps {
  readonly settings: StoreSettingsRepository;
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
    // The merchant never sends the dismissal or the site type, so a save carries the stored ones over.
    const next = await this.deps.settings.modify(tenantId, (current) =>
      created.value
        .withSetupGuideDismissedAt(current.setupGuideDismissedAt)
        .withSiteType(current.siteType),
    );
    return ok(toStoreSettingsView(next));
  }
}

/** Hides Home's setup guide for good (Shopify's "Dismiss"); dismissing again keeps the first time. */
export class DismissSetupGuide implements UseCase<
  { readonly tenantId: string },
  StoreSettingsView,
  DomainError
> {
  private readonly deps: StoreSettingsDeps & { readonly clock: Clock };

  constructor(deps: StoreSettingsDeps & { readonly clock: Clock }) {
    this.deps = deps;
  }

  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<StoreSettingsView, DomainError>> {
    const { tenantId } = input;
    const next = await this.deps.settings.modify(tenantId, (current) =>
      current.withSetupGuideDismissed(this.deps.clock.now()),
    );
    return ok(toStoreSettingsView(next));
  }
}

/**
 * Sets the shop's site type, once, at sign-up (before any credential exists). The repository does
 * the conditional write; whatever it reports is what is persisted, never the request's choice.
 */
export class SettleSignupSiteType implements UseCase<
  { readonly tenantId: string; readonly siteType: SiteType },
  { readonly siteType: SiteType },
  DomainError
> {
  private readonly deps: Pick<StoreSettingsDeps, "settings"> & { readonly clock: Clock };

  constructor(deps: Pick<StoreSettingsDeps, "settings"> & { readonly clock: Clock }) {
    this.deps = deps;
  }

  async execute(input: {
    readonly tenantId: string;
    readonly siteType: SiteType;
  }): Promise<Result<{ siteType: SiteType }, DomainError>> {
    const siteType = await this.deps.settings.settleSignupSiteType(
      input.tenantId,
      input.siteType,
      this.deps.clock.now(),
    );
    return ok({ siteType });
  }
}

/** What the storefront may know about a shop without signing in: its name, currency and site type. */
export interface PublicStoreView {
  readonly name: string;
  readonly currency: string;
  readonly siteType: SiteType;
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
    return ok({
      name: settings.storeName,
      currency: settings.currency,
      siteType: settings.siteType,
    });
  }
}
