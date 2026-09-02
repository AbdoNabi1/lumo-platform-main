import type { PrismaClient } from "@prisma/client";
import type { IdGenerator } from "@platform/contracts";
import type { DeadLetterEntry, DeadLetterStore } from "@platform/messaging";

/**
 * Production `DeadLetterStore` on `platform.dead_letters`. Preserves the original bytes and
 * headers verbatim (byte-identical replay, port contract). Scoped to one `consumerGroup` so the
 * same message dead-lettering in two groups yields two rows. Alerting hooks ride the broker
 * sprint's observability wiring.
 */
export class PrismaDeadLetterStore implements DeadLetterStore {
  private readonly prisma: PrismaClient;
  private readonly consumerGroup: string;
  private readonly idGenerator: IdGenerator;

  constructor(prisma: PrismaClient, consumerGroup: string, idGenerator: IdGenerator) {
    this.prisma = prisma;
    this.consumerGroup = consumerGroup;
    this.idGenerator = idGenerator;
  }

  async add(entry: DeadLetterEntry): Promise<void> {
    await this.prisma.deadLetter.create({
      data: {
        id: this.idGenerator.generate(),
        messageId: entry.messageId,
        consumerGroup: this.consumerGroup,
        topic: entry.topic,
        value: new Uint8Array(entry.value),
        headers: { ...entry.headers },
        attempts: entry.attempts,
        error: entry.error,
        failedAt: new Date(entry.failedAt),
      },
    });
  }
}
