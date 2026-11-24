import type { TransactionClient } from "@platform/db";
import type { StaffMutationLock } from "../domain/repositories";

/**
 * Serialises every staff write of one tenant (invite, renew, revoke, accept, change role, set active)
 * with a transaction-scoped Postgres advisory lock taken on the command's unit-of-work transaction, so
 * the actor re-check, the invariants (e.g. "at least one admin") and the writes cannot interleave with
 * another staff command of the same tenant. The lock is released at commit/rollback.
 */
export class PrismaStaffMutationLock implements StaffMutationLock {
  async withTenantStaffLock<T>(tenantId: string, tx: unknown, fn: () => Promise<T>): Promise<T> {
    if (tx === undefined || tx === null)
      throw new Error(
        "PrismaStaffMutationLock.withTenantStaffLock requires the unit of work's transaction client (ADR-0003).",
      );
    const client = tx as TransactionClient;
    await client.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "security.staff:" + tenantId,
    );
    return fn();
  }
}
