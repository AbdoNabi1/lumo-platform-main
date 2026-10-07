import { runInTenantTransaction, type Database } from "@platform/db";
import type {
  PasswordResetTokenRecord,
  PasswordResetTokenStore,
} from "../application/password-reset";

/** Plan 1C: `security.password_reset_tokens`, every statement tenant-scoped (RLS applies). */
export class PrismaPasswordResetTokenStore implements PasswordResetTokenStore {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async save(record: Omit<PasswordResetTokenRecord, "usedAt">): Promise<void> {
    await runInTenantTransaction(this.prisma, record.tenantId, (client) =>
      client.securityPasswordResetToken.create({ data: { id: crypto.randomUUID(), ...record } }),
    );
  }

  async consume(
    tenantId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetTokenRecord | null> {
    return runInTenantTransaction(this.prisma, tenantId, async (client) => {
      const claimed = await client.securityPasswordResetToken.updateMany({
        where: { tenantId, tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count === 0) return null;
      const row = await client.securityPasswordResetToken.findUnique({
        where: { tenantId_tokenHash: { tenantId, tokenHash } },
      });
      return row === null
        ? null
        : {
            tenantId: row.tenantId,
            tokenHash: row.tokenHash,
            identifier: row.identifier,
            expiresAt: row.expiresAt,
            usedAt: row.usedAt,
          };
    });
  }
}
