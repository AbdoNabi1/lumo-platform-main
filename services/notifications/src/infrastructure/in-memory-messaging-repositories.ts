import { ConcurrencyError } from "@platform/utils";
import type {
  NotificationSettingsRepository,
  SenderDomainReader,
  TemplateOverride,
  TemplateOverrideRepository,
} from "../domain/messaging/messaging-repositories";
import type {
  NotificationSettingsValues,
  StoredNotificationSettings,
} from "../domain/messaging/notification-settings";
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

/** In-memory verified domains per tenant (Task 2 will write real rows; tests seed this one). */
export class InMemorySenderDomainReader implements SenderDomainReader {
  private readonly verified = new Map<string, string[]>();

  setVerified(tenantId: string, domains: readonly string[]): void {
    this.verified.set(tenantId, [...domains]);
  }

  listVerifiedDomains(tenantId: string): Promise<readonly string[]> {
    return Promise.resolve([...(this.verified.get(tenantId) ?? [])]);
  }
}
