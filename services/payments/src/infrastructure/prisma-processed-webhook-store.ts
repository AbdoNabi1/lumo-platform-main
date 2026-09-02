import { Prisma, type PrismaClient } from "@prisma/client";
import type { ProcessedWebhookStore } from "../application/ports";

/**
 * Production `ProcessedWebhookStore` on `payments.processed_webhooks` (Sprint 4.8 schema; C2-2
 * wires the adapter the table has been waiting for). `markProcessed` is a plain INSERT on the
 * `(tenantId, provider, eventId)` unique key, so a concurrent duplicate delivery loses the race and
 * is naturally excluded. `ProcessedWebhookStore.markProcessed` (`../application/ports.ts`) takes no
 * transaction handle — `RecordWebhook` calls it un-transacted, same as `InMemoryProcessedWebhookStore`
 * — so this insert commits outside the intent-save transaction, exactly like the stub it replaces;
 * changing that would be a port signature change, out of scope here (see C2_2_REPORT.md).
 */
export class PrismaProcessedWebhookStore implements ProcessedWebhookStore {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string;

  constructor(prisma: PrismaClient, tenantId: string) {
    this.prisma = prisma;
    this.tenantId = tenantId;
  }

  async hasProcessed(provider: string, eventId: string): Promise<boolean> {
    const row = await this.prisma.processedWebhook.findUnique({
      where: { tenantId_provider_eventId: { tenantId: this.tenantId, provider, eventId } },
      select: { id: true },
    });
    return row !== null;
  }

  async markProcessed(provider: string, eventId: string): Promise<void> {
    try {
      await this.prisma.processedWebhook.create({
        data: { id: crypto.randomUUID(), tenantId: this.tenantId, provider, eventId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return; // a concurrent or earlier delivery won the insert race — already marked, not an error
      }
      throw error;
    }
  }
}
