import type {
  StoredNotificationSettings,
  NotificationSettingsValues,
} from "./notification-settings";
import type { StoredEmailConnection } from "./email-connection";
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

/** A connection as it is written: the repository assigns the version. */
export type EmailConnectionWrite = Omit<StoredEmailConnection, "version">;

/** Persistence port for a store's own email account (Wave 2b2). One row per tenant; every call names `tenantId` (ADR-0014). */
export interface EmailConnectionRepository {
  find(tenantId: string, tx?: unknown): Promise<StoredEmailConnection | null>;
  /**
   * Writes the connection. `expectedVersion` is null to create the row, else the version that was
   * read; anything else stale throws `ConcurrencyError`. Returns the new version.
   */
  save(
    tenantId: string,
    connection: EmailConnectionWrite,
    expectedVersion: number | null,
    tx?: unknown,
  ): Promise<number>;
  /** Idempotent: removing what is not there is not an error. */
  remove(tenantId: string, tx?: unknown): Promise<void>;
  /**
   * Records a real send failure (`last_error`, `last_error_at`) without touching the version, status
   * or key: a transient provider hiccup must not race a merchant's save. `message` is already sanitized.
   */
  recordFailure(tenantId: string, message: string, at: Date, tx?: unknown): Promise<void>;
}
