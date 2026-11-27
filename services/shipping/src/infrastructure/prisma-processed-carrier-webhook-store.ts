import { runInTenantTransaction, runReadScoped, type Database } from "@platform/db";
import type { TransactionClient } from "@platform/db";
import type { ProcessedCarrierWebhookStore } from "../application/ports";

/** ADR-0014: reuse the caller's `tx` if given, else scope the read via `runReadScoped`. */
function readScoped<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  run: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? run(tx as TransactionClient)
    : runReadScoped(prisma, tenantId, run);
}

function writeScoped<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  run: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? run(tx as TransactionClient)
    : runInTenantTransaction(prisma, tenantId, run);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Production `ProcessedCarrierWebhookStore` on `shipping.processed_webhooks` (unique
 * `(tenant_id, carrier, webhook_event_id)`). Given the aggregate's `tx`, the dedupe row commits
 * with the shipment save, so a failed save leaves the event unprocessed (Task 8 amendment F5).
 * A singleton: `tenantId` is a per-call parameter (ADR-0014).
 */
export class PrismaProcessedCarrierWebhookStore implements ProcessedCarrierWebhookStore {
  private readonly prisma: Database;

  constructor(prisma: Database) {
    this.prisma = prisma;
  }

  async hasProcessed(
    carrier: string,
    eventId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    const row = await readScoped(this.prisma, tenantId, tx, (client) =>
      client.processedShippingWebhook.findUnique({
        where: {
          tenantId_carrier_webhookEventId: { tenantId, carrier, webhookEventId: eventId },
        },
        select: { id: true },
      }),
    );
    return row !== null;
  }

  async markProcessed(
    carrier: string,
    eventId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<void> {
    try {
      await writeScoped(this.prisma, tenantId, tx, (client) =>
        client.processedShippingWebhook.create({
          data: { id: crypto.randomUUID(), tenantId, carrier, webhookEventId: eventId },
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) return; // a concurrent or earlier delivery won the insert race
      throw error;
    }
  }
}
