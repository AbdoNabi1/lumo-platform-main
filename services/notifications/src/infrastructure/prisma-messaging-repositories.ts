import {
  runInTenantTransaction,
  runReadScoped,
  type Database,
  type TransactionClient,
} from "@platform/db";
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
import {
  isEmailConnectionKind,
  isEmailConnectionStatus,
  type StoredEmailConnection,
} from "../domain/messaging/email-connection";
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

function toConnection(row: {
  kind: string;
  fromEmail: string;
  sealedCredentials: string;
  secretLast4: string;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastErrorAt: Date | null;
  verifiedAt: Date | null;
  version: number;
}): StoredEmailConnection | null {
  // An unknown kind or status (a row written by a newer release) is not a usable connection.
  if (!isEmailConnectionKind(row.kind) || !isEmailConnectionStatus(row.status)) return null;
  return {
    kind: row.kind,
    fromEmail: row.fromEmail,
    sealedCredentials: row.sealedCredentials,
    secretLast4: row.secretLast4,
    enabled: row.enabled,
    status: row.status,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    verifiedAt: row.verifiedAt,
    version: row.version,
  };
}

/**
 * Production {@link EmailConnectionRepository} on `notifications.email_connections` (one row per
 * tenant). Every read and write names `tenantId` and runs in a tenant-scoped transaction (RLS needs
 * `app.tenant_id`). The key is only ever the sealed envelope: this class never sees it in clear.
 * Versioning is the settings contract: no row = null; the first save inserts version 1 (a unique
 * violation is a `ConcurrencyError`); a later save updates `where { tenantId, version }` and increments.
 */
export class PrismaEmailConnectionRepository implements EmailConnectionRepository {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async find(tenantId: string, tx?: unknown): Promise<StoredEmailConnection | null> {
    const run = (client: TransactionClient) =>
      client.emailConnection.findUnique({ where: { tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.prisma, tenantId, run);
    return row === null ? null : toConnection(row);
  }

  async save(
    tenantId: string,
    connection: EmailConnectionWrite,
    expectedVersion: number | null,
    tx?: unknown,
  ): Promise<number> {
    const data = {
      kind: connection.kind,
      fromEmail: connection.fromEmail,
      sealedCredentials: connection.sealedCredentials,
      secretLast4: connection.secretLast4,
      enabled: connection.enabled,
      status: connection.status,
      lastError: connection.lastError,
      lastErrorAt: connection.lastErrorAt,
      verifiedAt: connection.verifiedAt,
    };
    const run = async (client: TransactionClient): Promise<number> => {
      if (expectedVersion === null) {
        try {
          await client.emailConnection.create({ data: { tenantId, ...data, version: 1 } });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConcurrencyError("Email connection was created concurrently", {
              cause: error,
            });
          }
          throw error;
        }
        return 1;
      }
      const { count } = await client.emailConnection.updateMany({
        where: { tenantId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConcurrencyError("Email connection changed since it was read");
      }
      return expectedVersion + 1;
    };
    if (tx !== undefined && tx !== null) return run(tx as TransactionClient);
    return runInTenantTransaction(this.prisma, tenantId, run);
  }

  async remove(tenantId: string, tx?: unknown): Promise<void> {
    const run = async (client: TransactionClient): Promise<void> => {
      await client.emailConnection.deleteMany({ where: { tenantId } });
    };
    if (tx !== undefined && tx !== null) return run(tx as TransactionClient);
    return runInTenantTransaction(this.prisma, tenantId, run);
  }

  async recordFailure(tenantId: string, message: string, at: Date, tx?: unknown): Promise<void> {
    const run = async (client: TransactionClient): Promise<void> => {
      await client.emailConnection.updateMany({
        where: { tenantId },
        data: { lastError: message, lastErrorAt: at },
      });
    };
    if (tx !== undefined && tx !== null) return run(tx as TransactionClient);
    return runInTenantTransaction(this.prisma, tenantId, run);
  }
}
