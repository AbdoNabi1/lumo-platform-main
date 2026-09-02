export { wireNotifications } from "./composition";
export type { NotificationsWiringDeps, WiredNotifications } from "./composition";
export { NotificationsController } from "./interfaces/notifications.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Notification } from "./domain/notification";
export type { NotificationRepository } from "./domain/notification-repository";
export {
  PrismaNotificationRepository,
  type PrismaNotificationRepositoryDeps,
} from "./infrastructure/prisma-notification-repository";
export { NOTIFICATIONS_PUBLISHED_EVENTS } from "./infrastructure/notifications-event-translator";
// Task 17b (C-2): the runtime worker opens an order-confirmation notification on
// `orders.order.paid` by calling `CreateNotification` directly (application layer only — never the
// controller), composing the Prisma repository against `core.prisma` itself.
export { NotificationsEventTranslator } from "./infrastructure/notifications-event-translator";
export {
  CreateNotification,
  type CreateNotificationDeps,
  type CreateNotificationInput,
  type NotificationStatusOutput,
} from "./application/create-notification.use-case";
