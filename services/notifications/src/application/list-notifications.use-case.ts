import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { NotificationRepository } from "../domain/notification-repository";
import type { Notification } from "../domain/notification";

export interface ListNotificationsInput extends CursorPage {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListNotificationsDeps {
  readonly notifications: NotificationRepository;
}

/** Cursor-paginated notification listing. */
export class ListNotifications implements UseCase<
  ListNotificationsInput,
  Paginated<Notification>,
  DomainError
> {
  private readonly deps: ListNotificationsDeps;

  constructor(deps: ListNotificationsDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListNotificationsInput,
  ): Promise<Result<Paginated<Notification>, DomainError>> {
    const { tenantId, ...page } = input;
    return ok(await this.deps.notifications.list(page, tenantId));
  }
}
