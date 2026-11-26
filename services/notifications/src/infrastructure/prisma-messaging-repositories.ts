import {
  runInTenantTransaction,
  runReadScoped,
  type Database,
  type TransactionClient,
} from "@platform/db";
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
import {
  normalizeDomainStatus,
  parseDnsRecords,
  SenderDomainTakenError,
  type StoredSenderDomain,
} from "../domain/messaging/sender-domain";
import {
  isTemplateKey,
  isTemplateLocale,
  type TemplateKey,
  type TemplateLocale,
} from "../domain/messaging/template-catalogue";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Production {@link NotificationSettingsRepository} on `notifications.notification_settings`. Every
 * read and write names `tenantId` and runs in a tenant-scoped transaction (RLS needs `app.tenant_id`).
 * Versioning is the 2a contract: no row = null; the first save inserts version 1 (a unique violation is
 * a `ConcurrencyError`); a later save updates `where { tenantId, version }` and increments.
 */
export class PrismaNotificationSettingsRepository implements NotificationSettingsRepository {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async find(tenantId: string, tx?: unknown): Promise<StoredNotificationSettings | null> {
    const run = (client: TransactionClient) =>
      client.notificationSettings.findUnique({ where: { tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    if (row === null) return null;
    return {
      values: {
        senderEmail: row.senderEmail,
        staffRecipients: strings(row.staffRecipients),
        disabledTemplates: [...row.disabledTemplates],
      },
      version: row.version,
    };
  }

  async save(
    tenantId: string,
    values: NotificationSettingsValues,
    expectedVersion: number | null,
    tx?: unknown,
  ): Promise<number> {
    const data = {
      senderEmail: values.senderEmail,
      staffRecipients: [...values.staffRecipients],
      disabledTemplates: [...values.disabledTemplates],
    };
    const run = async (client: TransactionClient): Promise<number> => {
      if (expectedVersion === null) {
        try {
          await client.notificationSettings.create({ data: { tenantId, ...data, version: 1 } });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConcurrencyError("Notification settings were created concurrently", {
              cause: error,
            });
          }
          throw error;
        }
        return 1;
      }
      const { count } = await client.notificationSettings.updateMany({
        where: { tenantId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConcurrencyError("Notification settings changed since they were read");
      }
      return expectedVersion + 1;
    };
    if (tx !== undefined && tx !== null) return run(tx as TransactionClient);
    return runInTenantTransaction(this.prisma, tenantId, run);
  }
}

function toOverride(row: {
  key: string;
  locale: string;
  subject: string;
  body: string;
}): TemplateOverride | null {
  if (!isTemplateKey(row.key) || !isTemplateLocale(row.locale)) return null;
  return { key: row.key, locale: row.locale, subject: row.subject, body: row.body };
}

/** Production {@link TemplateOverrideRepository} on `notifications.notification_template_overrides`. */
export class PrismaTemplateOverrideRepository implements TemplateOverrideRepository {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async list(tenantId: string, tx?: unknown): Promise<readonly TemplateOverride[]> {
    const run = (client: TransactionClient) =>
      client.notificationTemplateOverride.findMany({ where: { tenantId } });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    return rows.flatMap((row) => {
      const override = toOverride(row);
      return override === null ? [] : [override];
    });
  }

  async find(
    tenantId: string,
    key: TemplateKey,
    locale: TemplateLocale,
    tx?: unknown,
  ): Promise<TemplateOverride | null> {
    const run = (client: TransactionClient) =>
      client.notificationTemplateOverride.findFirst({ where: { tenantId, key, locale } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    return row === null ? null : toOverride(row);
  }

  async upsert(tenantId: string, override: TemplateOverride, tx?: unknown): Promise<void> {
    const run = async (client: TransactionClient): Promise<void> => {
      const { count } = await client.notificationTemplateOverride.updateMany({
        where: { tenantId, key: override.key, locale: override.locale },
        data: { subject: override.subject, body: override.body },
      });
      if (count > 0) return;
      try {
        await client.notificationTemplateOverride.create({
          data: {
            tenantId,
            key: override.key,
            locale: override.locale,
            subject: override.subject,
            body: override.body,
          },
        });
      } catch (error) {
        // A racing first save of the same template: the other write wins, both are the same shape.
        if (isUniqueViolation(error)) {
          throw new ConcurrencyError("Template was saved concurrently", { cause: error });
        }
        throw error;
      }
    };
    if (tx !== undefined && tx !== null) return run(tx as TransactionClient);
    return runInTenantTransaction(this.prisma, tenantId, run);
  }

  async remove(
    tenantId: string,
    key: TemplateKey,
    locale: TemplateLocale,
    tx?: unknown,
  ): Promise<void> {
    const run = async (client: TransactionClient): Promise<void> => {
      await client.notificationTemplateOverride.deleteMany({ where: { tenantId, key, locale } });
    };
    if (tx !== undefined && tx !== null) return run(tx as TransactionClient);
    return runInTenantTransaction(this.prisma, tenantId, run);
  }
}

/**
 * Production {@link SenderDomainRepository} on `notifications.sender_domains` (primary key tenant +
 * domain). Sender resolution reads the VERIFIED domains from here, so a domain only authenticates a
 * store's From address after the provider said so (D38/D43).
 */
export class PrismaSenderDomainRepository implements SenderDomainRepository {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async find(tenantId: string, tx?: unknown): Promise<StoredSenderDomain | null> {
    const run = (client: TransactionClient) =>
      client.senderDomain.findFirst({ where: { tenantId }, orderBy: { updatedAt: "desc" } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    if (row === null) return null;
    return {
      domain: row.domain,
      providerDomainId: row.providerDomainId,
      status: normalizeDomainStatus(row.status),
      records: parseDnsRecords(row.records),
      verifiedAt: row.verifiedAt,
    };
  }

  async save(
    tenantId: string,
    row: StoredSenderDomain,
    options: { readonly replacing?: string } = {},
  ): Promise<void> {
    const data = {
      providerDomainId: row.providerDomainId,
      status: row.status,
      records: row.records.map((record) => ({ ...record })),
      verifiedAt: row.verifiedAt,
    };
    try {
      await runInTenantTransaction(this.prisma, tenantId, async (client) => {
        if (options.replacing !== undefined && options.replacing !== row.domain) {
          await client.senderDomain.deleteMany({ where: { tenantId, domain: options.replacing } });
        }
        const { count } = await client.senderDomain.updateMany({
          where: { tenantId, domain: row.domain },
          data,
        });
        if (count > 0) return;
        await client.senderDomain.create({ data: { tenantId, domain: row.domain, ...data } });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Two unique rules can fire: (tenant, domain) when this store raced itself, and the partial
      // index `sender_domains_verified_domain_key` when another store verified the domain first.
      // The transaction is already rolled back here, so asking is safe.
      if (
        row.status === "verified" &&
        (await this.isVerifiedByAnotherStore(row.domain, tenantId))
      ) {
        throw new SenderDomainTakenError();
      }
      throw new ConcurrencyError("Sender domain was saved concurrently", { cause: error });
    }
  }

  async isVerifiedByAnotherStore(domain: string, tenantId: string): Promise<boolean> {
    // DELIBERATELY NOT TENANT-SCOPED (tenant-scanner exemption `platform-global`). The question
    // "does another store already have this domain verified" cannot be asked through a per-store
    // read. Only the owner's id leaves this query and it is compared here; no other store's row
    // is returned to the caller. NOTE: this relies on the connection role seeing every tenant's
    // rows (ADR-0014: BYPASSRLS today). Under an RLS-enforcing role it would see nothing; the
    // domain is then still unique at the provider (one account cannot register it twice).
    const owners = await this.prisma.senderDomain.findMany({
      where: { domain, status: "verified" },
      select: { tenantId: true },
    });
    return owners.some((owner) => owner.tenantId !== tenantId);
  }

  async listVerifiedDomains(tenantId: string, tx?: unknown): Promise<readonly string[]> {
    const run = (client: TransactionClient) =>
      client.senderDomain.findMany({
        where: { tenantId, status: "verified" },
        select: { domain: true },
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    return rows.map((row) => row.domain.toLowerCase());
  }
}
