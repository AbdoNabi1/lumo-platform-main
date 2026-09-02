import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { NotificationIdInput } from "./notification-lifecycle.use-cases";
import type { NotificationRepository } from "../domain/notification-repository";
import type { Notification } from "../domain/notification";

export interface GetNotificationDeps {
  readonly notifications: NotificationRepository;
}

/** Fetches a single notification by id. */
export class GetNotification implements UseCase<NotificationIdInput, Notification, DomainError> {
  private readonly deps: GetNotificationDeps;

  constructor(deps: GetNotificationDeps) {
    this.deps = deps;
  }

  async execute(input: NotificationIdInput): Promise<Result<Notification, DomainError>> {
    const notification = await this.deps.notifications.findById(input.notificationId);
    return notification === null
      ? err(new NotFoundError("Notification not found"))
      : ok(notification);
  }
}
