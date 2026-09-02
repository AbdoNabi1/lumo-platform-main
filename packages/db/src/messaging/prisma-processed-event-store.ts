import { Prisma, type PrismaClient } from "@prisma/client";
import type { ProcessedEventStore } from "@platform/messaging";
import type { TransactionClient } from "../transaction";

/**
 * Production `ProcessedEventStore` on `platform.inbox_processed_events` (ADR-0005). Scoped to one
 * `consumerGroup`; `recordIfNew` is a plain INSERT racing on the composite primary key — the
 * unique-violation loser returns `false`, which makes the check atomic by construction. Pass the
 * handler's transaction client as `tx` to commit the marker with the handler's side effects
 * (exactly-once effect).
 */
export class PrismaProcessedEventStore implements ProcessedEventStore {
  private readonly prisma: PrismaClient;
  private readonly consumerGroup: string;

  constructor(prisma: PrismaClient, consumerGroup: string) {
    this.prisma = prisma;
    this.consumerGroup = consumerGroup;
  }

  async has(messageId: string): Promise<boolean> {
    const row = await this.prisma.processedEvent.findUnique({
      where: {
        consumerGroup_messageId: { consumerGroup: this.consumerGroup, messageId },
      },
      select: { messageId: true },
    });
    return row !== null;
  }

  async recordIfNew(messageId: string, processedAt: string, tx?: unknown): Promise<boolean> {
    const client = (tx as TransactionClient | undefined) ?? this.prisma;
    try {
      await client.processedEvent.create({
        data: {
          consumerGroup: this.consumerGroup,
          messageId,
          processedAt: new Date(processedAt),
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false; // a concurrent or earlier delivery won the insert race
      }
      throw error;
    }
  }
}
