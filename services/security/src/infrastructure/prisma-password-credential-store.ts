import { runInTenantTransaction, runReadScoped, type Database } from "@platform/db";
import type {
  PasswordCredentialRecord,
  PasswordCredentialStore,
} from "../application/password-credentials";

/**
 * Plan 1B-1: `security.password_credentials`. Every statement runs inside a tenant-scoped
 * transaction (`app.tenant_id` set), so the forced RLS policy applies — same pattern as
 * services/payments/src/infrastructure/prisma-processed-webhook-store.ts.
 */
export class PrismaPasswordCredentialStore implements PasswordCredentialStore {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async find(tenantId: string, identifier: string): Promise<PasswordCredentialRecord | null> {
    const row = await runReadScoped(this.prisma, tenantId, (client) =>
      client.securityPasswordCredential.findUnique({
        where: { tenantId_identifier: { tenantId, identifier } },
      }),
    );
    return row === null
      ? null
      : {
          tenantId: row.tenantId,
          identifier: row.identifier,
          principalExternalId: row.principalExternalId,
          passwordHash: row.passwordHash,
          failedAttempts: row.failedAttempts,
          lockedUntil: row.lockedUntil,
        };
  }

  async findByPrincipal(
    tenantId: string,
    principalExternalId: string,
  ): Promise<PasswordCredentialRecord | null> {
    const row = await runReadScoped(this.prisma, tenantId, (client) =>
      client.securityPasswordCredential.findFirst({ where: { tenantId, principalExternalId } }),
    );
    return row === null
      ? null
      : {
          tenantId: row.tenantId,
          identifier: row.identifier,
          principalExternalId: row.principalExternalId,
          passwordHash: row.passwordHash,
          failedAttempts: row.failedAttempts,
          lockedUntil: row.lockedUntil,
        };
  }

  async save(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly principalExternalId: string;
    readonly passwordHash: string;
  }): Promise<void> {
    await runInTenantTransaction(this.prisma, input.tenantId, (client) =>
      client.securityPasswordCredential.upsert({
        where: { tenantId_identifier: { tenantId: input.tenantId, identifier: input.identifier } },
        create: { id: crypto.randomUUID(), ...input },
        update: {
          principalExternalId: input.principalExternalId,
          passwordHash: input.passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      }),
    );
  }

  async incrementFailures(tenantId: string, identifier: string): Promise<number> {
    return runInTenantTransaction(this.prisma, tenantId, async (client) => {
      const updated = await client.securityPasswordCredential.updateMany({
        where: { tenantId, identifier },
        data: { failedAttempts: { increment: 1 } },
      });
      if (updated.count === 0) return 0;
      const row = await client.securityPasswordCredential.findUnique({
        where: { tenantId_identifier: { tenantId, identifier } },
        select: { failedAttempts: true },
      });
      return row?.failedAttempts ?? 0;
    });
  }

  async lockUntil(tenantId: string, identifier: string, until: Date): Promise<void> {
    await runInTenantTransaction(this.prisma, tenantId, (client) =>
      client.securityPasswordCredential.updateMany({
        where: { tenantId, identifier },
        data: { lockedUntil: until },
      }),
    );
  }

  async recordSuccess(tenantId: string, identifier: string, rehash?: string): Promise<void> {
    await runInTenantTransaction(this.prisma, tenantId, (client) =>
      client.securityPasswordCredential.updateMany({
        where: { tenantId, identifier },
        data: {
          failedAttempts: 0,
          lockedUntil: null,
          ...(rehash === undefined ? {} : { passwordHash: rehash, version: { increment: 1 } }),
        },
      }),
    );
  }
}
