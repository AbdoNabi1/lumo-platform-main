import { ConcurrencyError } from "@platform/utils";
import type {
  NotificationSettingsRepository,
  SenderDomainRepository,
  TemplateOverride,
  TemplateOverrideRepository,
} from "../domain/messaging/messaging-repositories";
import type {
  NotificationSettingsValues,
  StoredNotificationSettings,
} from "../domain/messaging/notification-settings";
import { SenderDomainTakenError, type StoredSenderDomain } from "../domain/messaging/sender-domain";
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

/** In-memory sending domains per store, with the same one-row-per-domain contract as the Prisma repository. */
export class InMemorySenderDomainRepository implements SenderDomainRepository {
  private readonly rows = new Map<string, Map<string, StoredSenderDomain>>();

  /** Test seed: these domains are verified for the store. */
  setVerified(tenantId: string, domains: readonly string[]): void {
    const own = new Map<string, StoredSenderDomain>();
    for (const domain of domains) {
      own.set(domain, {
        domain,
        providerDomainId: `seed-${domain}`,
        status: "verified",
        records: [],
        verifiedAt: new Date(0),
      });
    }
    this.rows.set(tenantId, own);
  }

  find(tenantId: string): Promise<StoredSenderDomain | null> {
    const first = [...(this.rows.get(tenantId)?.values() ?? [])][0];
    return Promise.resolve(first === undefined ? null : { ...first, records: [...first.records] });
  }

  save(
    tenantId: string,
    row: StoredSenderDomain,
    options: { readonly replacing?: string } = {},
  ): Promise<void> {
    // The database's partial unique index: one verified owner per domain.
    if (row.status === "verified") {
      for (const [owner, others] of this.rows) {
        if (owner !== tenantId && others.get(row.domain)?.status === "verified") {
          return Promise.reject(new SenderDomainTakenError());
        }
      }
    }
    const own = this.rows.get(tenantId) ?? new Map<string, StoredSenderDomain>();
    if (options.replacing !== undefined) own.delete(options.replacing);
    own.set(row.domain, { ...row, records: [...row.records] });
    this.rows.set(tenantId, own);
    return Promise.resolve();
  }

  isVerifiedByAnotherStore(domain: string, tenantId: string): Promise<boolean> {
    for (const [owner, own] of this.rows) {
      if (owner !== tenantId && own.get(domain)?.status === "verified")
        return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  listVerifiedDomains(tenantId: string): Promise<readonly string[]> {
    return Promise.resolve(
      [...(this.rows.get(tenantId)?.values() ?? [])]
        .filter((row) => row.status === "verified")
        .map((row) => row.domain),
    );
  }
}
