import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Notification } from "../domain/notification";
import type { NotificationRepository } from "../domain/notification-repository";
import { NotificationMapper, type NotificationRow } from "./notification.mapper";

export interface PrismaNotificationRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/**
 * Production `NotificationRepository` on the `notifications` schema. Optimistic locking +
 * same-transaction outbox per ADR-0003. Unlike every prior context, `attempts`/`history` are
 * embedded JSONB arrays on the row itself (no separate append-only child table) — the full arrays
 * are rewritten on every save, which is safe because they are only ever appended to in memory
 * before the aggregate is persisted. No contact PII (G-27, ADR-0006).
 */
export class PrismaNotificationRepository implements NotificationRepository {
  private readonly deps: PrismaNotificationRepositoryDeps;

  constructor(deps: PrismaNotificationRepositoryDeps) {
    this.deps = deps;
  }

  async save(notification: Notification, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const notificationId = notification.id.toString();
    const row = NotificationMapper.toRow(notification, tenantId);

    if (notification.version === 0) {
      await client.notification.create({
        data: {
          ...row,
          recipient: row.recipient,
          channels: row.channels,
          template: row.template,
          variables: row.variables,
          policy: row.policy,
          attempts: row.attempts,
          history: row.history,
        },
      });
    } else {
      const updated = await client.notification.updateMany({
        where: { id: notificationId, tenantId, version: notification.version },
        data: {
          channelIndex: row.channelIndex,
          status: row.status,
          attempts: row.attempts,
          history: row.history,
          deliveredAt: row.deliveredAt,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Notification ${notificationId} was modified concurrently (expected version ${notification.version})`,
        );
      }
    }

    await this.deps.outbox.write(notification.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Notification | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.notification.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return NotificationMapper.toDomain(this.toMapperRow(row));
  }

  async findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<Notification | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.notification.findFirst({
      where: { idempotencyKey, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return NotificationMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Notification>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.notification.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => NotificationMapper.toDomain(this.toMapperRow(row))),
      limit,
      (n) => n.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly idempotencyKey: string;
    readonly sourceRef: string;
    readonly recipient: unknown;
    readonly channels: unknown;
    readonly channelIndex: number;
    readonly template: unknown;
    readonly variables: unknown;
    readonly policy: unknown;
    readonly status: string;
    readonly attempts: unknown;
    readonly history: unknown;
    readonly deliveredAt: Date | null;
    readonly version: number;
  }): NotificationRow {
    return {
      ...row,
      recipient: row.recipient as NotificationRow["recipient"],
      channels: row.channels as NotificationRow["channels"],
      template: row.template as NotificationRow["template"],
      variables: row.variables as NotificationRow["variables"],
      policy: row.policy as NotificationRow["policy"],
      attempts: row.attempts as NotificationRow["attempts"],
      history: row.history as NotificationRow["history"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaNotificationRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
