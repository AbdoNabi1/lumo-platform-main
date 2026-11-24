import { runInTenantTransaction, type Database, type TransactionClient } from "@platform/db";
import type { OutreachUnitOfWork } from "../domain/repositories";

/** The shop scope each outreach transaction was opened for (the transaction client is the key). */
const scopes = new WeakMap<object, string>();

/** The tenant scope an outreach unit of work bound to `tx`, or `undefined` for a transaction it did not open. */
export function tenantScopeOf(tx: unknown): string | undefined {
  return typeof tx === "object" && tx !== null ? scopes.get(tx) : undefined;
}

/** Records the scope of a transaction that was opened (and `set_config`-ed) elsewhere. */
export function bindTenantScope(tx: object, tenantId: string): void {
  scopes.set(tx, tenantId);
}

export function assertTenantId(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error("an outreach unit of work needs a non-empty tenant id");
  }
}

/**
 * ADR-0014: the production unit of work. `runInTenantTransaction` sets `app.tenant_id` (transaction-local, first
 * statement) before `work` sees the transaction, so every repository call made with `tx` — and the outbox write — runs
 * under the trusted shop's RLS scope. Directory operations switch scope only for themselves (`withPlatformScope`).
 */
export class PrismaOutreachUnitOfWork implements OutreachUnitOfWork {
  constructor(private readonly prisma: Database) {}

  async run<T>(tenantId: string, work: (tx: unknown) => Promise<T>): Promise<T> {
    assertTenantId(tenantId);
    return await runInTenantTransaction(this.prisma, tenantId, (tx) => {
      scopes.set(tx, tenantId);
      return work(tx);
    });
  }
}

const setScope = (tx: TransactionClient, tenantId: string): Promise<number> =>
  tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

/**
 * Runs `fn` with `app.tenant_id` switched to the platform tenant INSIDE the caller's transaction, then restores the
 * shop scope before returning (and on a JS error, best effort: an aborted Postgres transaction rejects every further
 * statement and is rolled back by the caller anyway). Never splits the transaction.
 */
export async function withPlatformScope<T>(
  tx: TransactionClient,
  platformTenantId: string,
  shopTenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await setScope(tx, platformTenantId);
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    try {
      await setScope(tx, shopTenantId);
    } catch {
      // the original failure wins; the transaction is rolled back by whoever owns it
    }
    throw error;
  }
  await setScope(tx, shopTenantId);
  return result;
}
