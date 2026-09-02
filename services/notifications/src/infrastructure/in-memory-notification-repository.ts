import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Notification } from "../domain/notification";
import type { NotificationRepository } from "../domain/notification-repository";

export interface InMemoryNotificationRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `NotificationRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly store = new Map<string, Notification>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryNotificationRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(notification: Notification, tx?: unknown): Promise<void> {
    this.store.set(notification.id.toString(), notification);
    await this.outbox.write(notification.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Notification | null> {
    return this.store.get(id) ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Notification | null> {
    for (const notification of this.store.values()) {
      if (notification.idempotencyKey === idempotencyKey) {
        return notification;
      }
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage): Promise<Paginated<Notification>> {
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
