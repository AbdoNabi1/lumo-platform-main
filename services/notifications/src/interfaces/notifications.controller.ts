import type {
  CreateNotification,
  CreateNotificationInput,
} from "../application/create-notification.use-case";
import type { GetNotification } from "../application/get-notification.use-case";
import type {
  ListNotifications,
  ListNotificationsInput,
} from "../application/list-notifications.use-case";
import type {
  AdvanceNotification,
  AdvanceNotificationInput,
  NotificationIdInput,
  QueueNotification,
  RetryNotification,
  SendNotification,
} from "../application/notification-lifecycle.use-cases";
import type {
  RecordProviderCallback,
  RecordProviderCallbackInput,
} from "../application/record-provider-callback.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface NotificationsControllerDeps {
  readonly createNotification: CreateNotification;
  readonly queueNotification: QueueNotification;
  readonly sendNotification: SendNotification;
  readonly retryNotification: RetryNotification;
  readonly advanceNotification: AdvanceNotification;
  readonly recordProviderCallback: RecordProviderCallback;
  readonly listNotifications: ListNotifications;
  readonly getNotification: GetNotification;
}

/** Framework-agnostic interface boundary for notifications use-cases (no HTTP server). */
export class NotificationsController {
  private readonly deps: NotificationsControllerDeps;

  constructor(deps: NotificationsControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateNotificationInput): Promise<ControllerResponse> {
    return present(await this.deps.createNotification.execute(input), 201);
  }

  async queue(input: NotificationIdInput): Promise<ControllerResponse> {
    return present(await this.deps.queueNotification.execute(input), 200);
  }

  async send(input: NotificationIdInput): Promise<ControllerResponse> {
    return present(await this.deps.sendNotification.execute(input), 200);
  }

  async retry(input: NotificationIdInput): Promise<ControllerResponse> {
    return present(await this.deps.retryNotification.execute(input), 200);
  }

  async advance(input: AdvanceNotificationInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceNotification.execute(input), 200);
  }

  async callback(input: RecordProviderCallbackInput): Promise<ControllerResponse> {
    return present(await this.deps.recordProviderCallback.execute(input), 200);
  }

  async list(input: ListNotificationsInput): Promise<ControllerResponse> {
    return present(await this.deps.listNotifications.execute(input), 200);
  }

  async get(input: NotificationIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getNotification.execute(input), 200);
  }
}
