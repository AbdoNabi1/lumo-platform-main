import {
  runInTenantTransaction,
  runReadScoped,
  type Database,
  type TransactionClient,
} from "@platform/db";
import type { Prisma } from "@prisma/client";

/** One row that holds sealed credentials: its tenant (the write scope) and a unique, sortable key. */
export interface SealedRowRef {
  readonly tenantId: string;
  readonly key: string;
}

/** `resealed`: written; `unchanged`: nothing to re-wrap; `conflict`: the row changed underneath us. */
export type ResealOutcome = "resealed" | "unchanged" | "conflict";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * O15 key rotation, payments side: the one place that walks `payments.merchant_payment_settings`
 * to re-wrap every provider's `sealedCredentials` under the current key. It knows the row layout
 * (`{ "<provider>": { config, sealedCredentials } }`) and nothing about keys: the caller hands in
 * `rewrap`, which returns its input unchanged when a blob needs no work.
 *
 * Two kinds of access, both deliberate:
 *  - {@link listRefs} is a CROSS-TENANT read (the one job that has to visit every merchant); it
 *    selects the tenant ids only and carries a documented exemption in
 *    `scripts/dev/check-prisma-tenant-where.mjs`. It never returns a sealed blob.
 *  - {@link resealRow} reads and writes ONE tenant's row inside that tenant's own scope, and writes
 *    with compare-and-set on `updated_at`: if a merchant saved in the meantime, nothing is written
 *    and the outcome is `conflict` (the caller retries from a fresh read).
 */
export class PrismaPaymentSealedCredentialStore {
  readonly name = "payments";
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async listRefs(after: string | undefined, limit: number): Promise<readonly SealedRowRef[]> {
    const rows = await this.prisma.merchantPaymentSettings.findMany({
      select: { tenantId: true },
      orderBy: { tenantId: "asc" },
      take: limit,
      ...(after === undefined ? {} : { cursor: { tenantId: after }, skip: 1 }),
    });
    return rows.map((row) => ({ tenantId: row.tenantId, key: row.tenantId }));
  }

  async resealRow(
    ref: SealedRowRef,
    rewrap: (sealed: string) => Promise<string>,
  ): Promise<ResealOutcome> {
    const { tenantId } = ref;
    const row = await runReadScoped(this.prisma, tenantId, (client: TransactionClient) =>
      client.merchantPaymentSettings.findUnique({ where: { tenantId } }),
    );
    if (row === null) return "unchanged";
    if (!isPlainObject(row.providerSettings)) {
      throw new Error("Corrupt merchant payment settings: provider settings are not an object");
    }

    let changed = false;
    const next: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, entry] of Object.entries(row.providerSettings)) {
      if (!isPlainObject(entry) || typeof entry["sealedCredentials"] !== "string") {
        throw new Error("Corrupt merchant payment settings: malformed provider entry");
      }
      const sealed = entry["sealedCredentials"];
      const rewrapped = sealed.length === 0 ? sealed : await rewrap(sealed);
      if (rewrapped !== sealed) changed = true;
      next[key] = { ...(entry as Prisma.InputJsonObject), sealedCredentials: rewrapped };
    }
    if (!changed) return "unchanged";

    const { count } = await runInTenantTransaction(this.prisma, tenantId, (client) =>
      client.merchantPaymentSettings.updateMany({
        where: { tenantId, updatedAt: row.updatedAt },
        data: { providerSettings: next },
      }),
    );
    return count === 1 ? "resealed" : "conflict";
  }
}
