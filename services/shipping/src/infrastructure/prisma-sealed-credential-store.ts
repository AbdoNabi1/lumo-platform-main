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

const corrupt = (): Error =>
  new Error("Corrupt merchant carrier settings: malformed carrier entry");

/**
 * O15 key rotation, shipping side: the one place that walks `shipping.merchant_carrier_settings` to
 * re-wrap every carrier's sealed values under the current key: `sealedCredentials`,
 * `webhook.sealedSecret` and `webhook.previousSealedSecret`. It knows the row layout
 * (`{ "<carrier>": { config, sealedCredentials, webhook } }`) and nothing about keys: the caller
 * hands in `rewrap`, which returns its input unchanged when a blob needs no work.
 *
 * Two kinds of access, both deliberate:
 *  - {@link listRefs} is a CROSS-TENANT read (the one job that has to visit every merchant); it
 *    selects the tenant ids only and carries a documented exemption in
 *    `scripts/dev/check-prisma-tenant-where.mjs`. It never returns a sealed blob.
 *  - {@link resealRow} reads and writes ONE tenant's row inside that tenant's own scope, and writes
 *    with the row's optimistic `version` (compare-and-set, and bumped like any other write): if a
 *    merchant saved in the meantime nothing is written and the outcome is `conflict`.
 */
export class PrismaShippingSealedCredentialStore {
  readonly name = "shipping";
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async listRefs(after: string | undefined, limit: number): Promise<readonly SealedRowRef[]> {
    const rows = await this.prisma.merchantCarrierSettings.findMany({
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
      client.merchantCarrierSettings.findUnique({ where: { tenantId } }),
    );
    if (row === null) return "unchanged";
    if (!isPlainObject(row.carrierSettings)) {
      throw new Error("Corrupt merchant carrier settings: carrier settings are not an object");
    }

    let changed = false;
    const rewrapValue = async (value: unknown): Promise<string> => {
      if (typeof value !== "string") throw corrupt();
      const rewrapped = value.length === 0 ? value : await rewrap(value);
      if (rewrapped !== value) changed = true;
      return rewrapped;
    };

    const next: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, entry] of Object.entries(row.carrierSettings)) {
      if (!isPlainObject(entry) || !isPlainObject(entry["webhook"])) throw corrupt();
      const webhook: Record<string, Prisma.InputJsonValue> = {
        ...(entry["webhook"] as Prisma.InputJsonObject),
        sealedSecret: await rewrapValue(entry["webhook"]["sealedSecret"]),
      };
      if (entry["webhook"]["previousSealedSecret"] !== undefined) {
        webhook["previousSealedSecret"] = await rewrapValue(
          entry["webhook"]["previousSealedSecret"],
        );
      }
      next[key] = {
        ...(entry as Prisma.InputJsonObject),
        sealedCredentials: await rewrapValue(entry["sealedCredentials"]),
        webhook,
      };
    }
    if (!changed) return "unchanged";

    const { count } = await runInTenantTransaction(this.prisma, tenantId, (client) =>
      client.merchantCarrierSettings.updateMany({
        where: { tenantId, version: row.version },
        data: { carrierSettings: next, version: { increment: 1 } },
      }),
    );
    return count === 1 ? "resealed" : "conflict";
  }
}
