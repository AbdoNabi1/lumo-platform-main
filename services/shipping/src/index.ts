export { wireShipping } from "./composition";
export type { ShippingWiringDeps, WiredShipping } from "./composition";
export { ShippingController } from "./interfaces/shipping.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Shipment } from "./domain/shipment";
export type { ShipmentRepository } from "./domain/shipment-repository";
export {
  PrismaShipmentRepository,
  type PrismaShipmentRepositoryDeps,
} from "./infrastructure/prisma-shipment-repository";
export { SHIPPING_PUBLISHED_EVENTS } from "./infrastructure/shipping-event-translator";
