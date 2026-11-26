export { DEFAULT_PLATFORM_FROM, wireNotifications } from "./composition";
export type {
  NotificationsMessagingDeps,
  NotificationsWiringDeps,
  WiredNotifications,
} from "./composition";
export { NotificationSettingsController } from "./interfaces/notification-settings.controller";
export type {
  EmailDeliveryPort,
  OutgoingMail,
  RecipientContact,
  RecipientResolverPort,
  StoreProfile,
  StoreProfilePort,
} from "./application/messaging-ports";
export {
  chooseLocale,
  isTemplateKey,
  isTemplateLocale,
  TEMPLATE_CATALOGUE,
  TEMPLATE_KEYS,
  TEMPLATE_LOCALES,
} from "./domain/messaging/template-catalogue";
export type { TemplateKey, TemplateLocale } from "./domain/messaging/template-catalogue";
export {
  emailDomain,
  isFreeMailDomain,
  isValidEmail,
  resolveSender,
} from "./domain/messaging/sender-resolution";
export { escapeHtml, renderTemplate, formatMoney } from "./domain/messaging/template-renderer";
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
