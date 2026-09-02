import type { CursorPage, Paginated } from "@platform/types";
import type { Notification } from "./notification";

/** Persistence port for {@link Notification}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface NotificationRepository {
  save(notification: Notification, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Notification | null>;
  /** Looks up a notification by its caller-supplied idempotency key — actively used by `CreateNotification` (unique `(tenant, idempotencyKey)`), not a dormant scaffold. */
  findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<Notification | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Notification>>;
}
