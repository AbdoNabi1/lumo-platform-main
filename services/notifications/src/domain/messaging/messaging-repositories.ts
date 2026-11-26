import type {
  StoredNotificationSettings,
  NotificationSettingsValues,
} from "./notification-settings";
import type { TemplateKey, TemplateLocale } from "./template-catalogue";

/** Persistence port for a shop's notification settings (Wave 2b). One row per tenant; every call names `tenantId` (ADR-0014). */
export interface NotificationSettingsRepository {
  find(tenantId: string, tx?: unknown): Promise<StoredNotificationSettings | null>;
  /**
   * Writes `values`. `expectedVersion` is null to create the first row, else the version that was
   * read; anything else stale throws `ConcurrencyError`. Returns the new version.
   */
  save(
    tenantId: string,
    values: NotificationSettingsValues,
    expectedVersion: number | null,
    tx?: unknown,
  ): Promise<number>;
}

export interface TemplateOverride {
  readonly key: TemplateKey;
  readonly locale: TemplateLocale;
  readonly subject: string;
  readonly body: string;
}

/** A merchant's own copy for one template + language. Deleting it is "revert to default". */
export interface TemplateOverrideRepository {
  list(tenantId: string, tx?: unknown): Promise<readonly TemplateOverride[]>;
  find(
    tenantId: string,
    key: TemplateKey,
    locale: TemplateLocale,
    tx?: unknown,
  ): Promise<TemplateOverride | null>;
  upsert(tenantId: string, override: TemplateOverride, tx?: unknown): Promise<void>;
  /** Idempotent: deleting what is not there is not an error. */
  remove(tenantId: string, key: TemplateKey, locale: TemplateLocale, tx?: unknown): Promise<void>;
}

/** What Task 1 needs from the store's own sending domains: the verified ones. Task 2 writes them. */
export interface SenderDomainReader {
  listVerifiedDomains(tenantId: string, tx?: unknown): Promise<readonly string[]>;
}
