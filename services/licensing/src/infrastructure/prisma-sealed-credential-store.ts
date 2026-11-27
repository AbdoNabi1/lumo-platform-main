import {
  runInTenantTransaction,
  runReadScoped,
  type Database,
  type TransactionClient,
} from "@platform/db";

/** One row that holds a sealed credential: its tenant (the write scope) and a unique, sortable key. */
export interface SealedRowRef {
  readonly tenantId: string;
  readonly key: string;
}

/** `resealed`: written; `unchanged`: nothing to re-wrap; `conflict`: the row changed underneath us. */
export type ResealOutcome = "resealed" | "unchanged" | "conflict";

/**
 * O15 key rotation, billing side. The card token Morbeh charges to renew a merchant
 * (`licensing.billing_payment_methods.sealed_token`) is sealed with the PAYMENTS credential vault, so
 * it sits under `PAYMENT_CREDENTIALS_KEK_REF` too and must be re-wrapped with the payments blobs
 * before the previous key is retired. This class knows the column and nothing about keys: the
 * caller hands in `rewrap`, which returns its input unchanged when a blob needs no work.
 *
 *  - {@link listRefs} is a CROSS-TENANT read (the rows belong to the platform tenant, but the
 *    job must not assume which one): it selects `id` and `tenant_id` only, for rows that hold a
 *    token, and carries a documented exemption in `scripts/dev/check-prisma-tenant-where.mjs`.
 *  - {@link resealRow} reads and writes ONE row inside its own tenant scope, compare-and-set on the
 *    row's optimistic `version` (bumped like any other write): a concurrent change makes it
 *    `conflict`, never a lost update.
 */
export class PrismaBillingSealedCredentialStore {
  readonly name = "billing";
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async listRefs(after: string | undefined, limit: number): Promise<readonly SealedRowRef[]> {
    const rows = await this.prisma.billingPaymentMethod.findMany({
      where: { sealedToken: { not: null } },
      select: { id: true, tenantId: true },
      orderBy: { id: "asc" },
      take: limit,
      ...(after === undefined ? {} : { cursor: { id: after }, skip: 1 }),
    });
    return rows.map((row) => ({ tenantId: row.tenantId, key: row.id }));
  }

  async resealRow(
    ref: SealedRowRef,
    rewrap: (sealed: string) => Promise<string>,
  ): Promise<ResealOutcome> {
    const { tenantId, key: id } = ref;
    const row = await runReadScoped(this.prisma, tenantId, (client: TransactionClient) =>
      client.billingPaymentMethod.findFirst({ where: { id, tenantId } }),
    );
    if (row === null || row.sealedToken === null || row.sealedToken.length === 0) {
      return "unchanged";
    }
    const rewrapped = await rewrap(row.sealedToken);
    if (rewrapped === row.sealedToken) return "unchanged";

    const { count } = await runInTenantTransaction(this.prisma, tenantId, (client) =>
      client.billingPaymentMethod.updateMany({
        where: { id, tenantId, version: row.version },
        data: { sealedToken: rewrapped, version: { increment: 1 } },
      }),
    );
    return count === 1 ? "resealed" : "conflict";
  }
}
