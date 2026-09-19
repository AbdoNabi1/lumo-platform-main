import { runInTenantTransaction, runReadScoped, type Database } from "@platform/db";
import { Prisma } from "@prisma/client";
import type { ProcessedWebhookStore } from "../application/ports";

/**
 * Production `ProcessedWebhookStore` on `payments.processed_webhooks` (Sprint 4.8 schema; C2-2
 * wires the adapter the table has been waiting for). `markProcessed` is a plain INSERT on the
 * `(tenantId, provider, eventId)` unique key, so a concurrent duplicate delivery loses the race and
 * is naturally excluded. `ProcessedWebhookStore.markProcessed` (`../application/ports.ts`) takes no
 * transaction handle — `RecordWebhook` calls it un-transacted, same as `InMemoryProcessedWebhookStore`
 * — so this insert commits outside the intent-save transaction, exactly like the stub it replaces;
 * changing that would be a port signature change, out of scope here (see C2_2_REPORT.md).
 *
 * ADR-0014 (WP-10, T10.3): a singleton — `tenantId` is a per-call parameter, and both the read and
 * the insert run inside a tenant-scoped transaction.
 */
export class PrismaProcessedWebhookStore implements ProcessedWebhookStore {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async hasProcessed(provider: string, eventId: string, tenantId: string): Promise<boolean> {
    const row = await runReadScoped(this.prisma, tenantId, (client) =>
      client.processedWebhook.findUnique({
        where: { tenantId_provider_eventId: { tenantId, provider, eventId } },
        select: { id: true },
      }),
    );
    return row !== null;
  }

  async markProcessed(provider: string, eventId: string, tenantId: string): Promise<void> {
    try {
      await runInTenantTransaction(this.prisma, tenantId, (client) =>
        client.processedWebhook.create({
          data: { id: crypto.randomUUID(), tenantId, provider, eventId },
        }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return; // a concurrent or earlier delivery won the insert race — already marked, not an error
      }
      throw error;
    }
  }
}
