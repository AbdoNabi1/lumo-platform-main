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
export { ShippingZonesController } from "./interfaces/shipping-zones.controller";
export { ShippingZone, ShippingRate, REST_OF_WORLD } from "./domain/shipping-zone";
export type { RateCondition, RateInput, ZoneCountry } from "./domain/shipping-zone";
export { quoteRates, NO_SHIPPING_RATE_ID } from "./domain/quote-rates";
export type { QuoteAddress, QuoteLine, QuotedRate } from "./domain/quote-rates";
export type { ShippingZoneRepository } from "./domain/shipping-zone-repository";
export type { RateView, ZoneView } from "./application/shipping-zones.use-cases";
export type { ShippableCountries } from "./application/quote-shipping.use-cases";
export {
  PrismaShippingZoneRepository,
  type PrismaShippingZoneRepositoryDeps,
} from "./infrastructure/prisma-shipping-zone-repository";
