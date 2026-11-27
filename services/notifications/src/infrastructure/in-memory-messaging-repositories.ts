import { ConcurrencyError } from "@platform/utils";
import type {
  EmailConnectionRepository,
  EmailConnectionWrite,
  NotificationSettingsRepository,
  TemplateOverride,
  TemplateOverrideRepository,
} from "../domain/messaging/messaging-repositories";
import type {
  NotificationSettingsValues,
  StoredNotificationSettings,
} from "../domain/messaging/notification-settings";
import type { StoredEmailConnection } from "../domain/messaging/email-connection";
import type { TemplateKey, TemplateLocale } from "../domain/messaging/template-catalogue";

/** In-memory settings with the SAME version contract as the Prisma repository (stale = `ConcurrencyError`). */
export class InMemoryNotificationSettingsRepository implements NotificationSettingsRepository {
  private readonly store = new Map<string, StoredNotificationSettings>();

  find(tenantId: string): Promise<StoredNotificationSettings | null> {
    const stored = this.store.get(tenantId);
    return Promise.resolve(
      stored === undefined
        ? null
        : {
            values: {
              senderEmail: stored.values.senderEmail,
              staffRecipients: [...stored.values.staffRecipients],
              disabledTemplates: [...stored.values.disabledTemplates],
            },
            version: stored.version,
          },
    );
  }

  save(
    tenantId: string,
    values: NotificationSettingsValues,
    expectedVersion: number | null,
  ): Promise<number> {
    const current = this.store.get(tenantId)?.version ?? null;
    if (current !== expectedVersion) {
      return Promise.reject(
        new ConcurrencyError("Notification settings changed since they were read"),
      );
    }
    const version = (current ?? 0) + 1;
    this.store.set(tenantId, {
      values: {
        senderEmail: values.senderEmail,
        staffRecipients: [...values.staffRecipients],
        disabledTemplates: [...values.disabledTemplates],
      },
      version,
    });
    return Promise.resolve(version);
  }
}

export class InMemoryTemplateOverrideRepository implements TemplateOverrideRepository {
  private readonly store = new Map<string, TemplateOverride>();

  private static id(tenantId: string, key: string, locale: string): string {
    return `${tenantId}\u0000${key}\u0000${locale}`;
  }

  list(tenantId: string): Promise<readonly TemplateOverride[]> {
    const prefix = `${tenantId}\u0000`;
    return Promise.resolve(
      [...this.store.entries()].filter(([id]) => id.startsWith(prefix)).map(([, value]) => value),
    );
  }

  find(
    tenantId: string,
    key: TemplateKey,
    locale: TemplateLocale,
  ): Promise<TemplateOverride | null> {
    return Promise.resolve(
      this.store.get(InMemoryTemplateOverrideRepository.id(tenantId, key, locale)) ?? null,
    );
  }

  upsert(tenantId: string, override: TemplateOverride): Promise<void> {
    this.store.set(InMemoryTemplateOverrideRepository.id(tenantId, override.key, override.locale), {
      ...override,
    });
    return Promise.resolve();
  }

  remove(tenantId: string, key: TemplateKey, locale: TemplateLocale): Promise<void> {
    this.store.delete(InMemoryTemplateOverrideRepository.id(tenantId, key, locale));
    return Promise.resolve();
  }
}

/** In-memory email connections with the SAME version contract as the Prisma repository (stale = `ConcurrencyError`). */
export class InMemoryEmailConnectionRepository implements EmailConnectionRepository {
  private readonly rows = new Map<string, StoredEmailConnection>();

  find(tenantId: string): Promise<StoredEmailConnection | null> {
    const row = this.rows.get(tenantId);
    return Promise.resolve(row === undefined ? null : { ...row });
  }

  save(
    tenantId: string,
    connection: EmailConnectionWrite,
    expectedVersion: number | null,
  ): Promise<number> {
    const current = this.rows.get(tenantId)?.version ?? null;
    if (current !== expectedVersion) {
      return Promise.reject(new ConcurrencyError("Email connection changed since it was read"));
    }
    const version = (current ?? 0) + 1;
    this.rows.set(tenantId, { ...connection, version });
    return Promise.resolve(version);
  }

  remove(tenantId: string): Promise<void> {
    this.rows.delete(tenantId);
    return Promise.resolve();
  }

  recordFailure(tenantId: string, message: string, at: Date): Promise<void> {
    const row = this.rows.get(tenantId);
    if (row !== undefined) this.rows.set(tenantId, { ...row, lastError: message, lastErrorAt: at });
    return Promise.resolve();
  }

  /** Test read: the raw stored row (to prove what a row holds and what it never holds). */
  peek(tenantId: string): StoredEmailConnection | undefined {
    return this.rows.get(tenantId);
  }
}
