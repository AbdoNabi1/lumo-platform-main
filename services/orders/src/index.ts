export { wireOrders } from "./composition";
export type { OrdersWiringDeps, WiredOrders } from "./composition";
export { OrderController } from "./interfaces/order.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Order } from "./domain/order";
export type { OrderStatus } from "./domain/order";
export type { OrderRepository } from "./domain/order-repository";
export {
  PrismaOrderRepository,
  type PrismaOrderRepositoryDeps,
} from "./infrastructure/prisma-order-repository";
export {
  PaymentCapturedConsumer,
  type PaymentCapturedConsumerDeps,
  type PaymentCapturedPayload,
} from "./interfaces/payment-captured.consumer";
export { OrderEventTranslator } from "./infrastructure/order-event-translator";
export {
  MarkOrderPaid,
  type MarkOrderPaidDeps,
  type MarkOrderPaidInput,
} from "./application/mark-order-paid.use-case";
export {
  NoopPaymentTruthShadow,
  type PaymentTruthShadowObservation,
  type PaymentTruthShadowPort,
} from "./application/payment-truth-shadow";
export type {
  InventoryPort,
  NotificationPort,
  PaymentPort,
  PaymentVerificationPort,
  ShippingPort,
} from "./application/ports";
export { ORDERS_PUBLISHED_EVENTS } from "./infrastructure/order-event-translator";
