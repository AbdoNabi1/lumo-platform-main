export { wireReturns } from "./composition";
export type { ReturnsWiringDeps, WiredReturns } from "./composition";
export type { PaymentsPort, RefundVerificationPort } from "./application/ports";
export { ReturnsController } from "./interfaces/returns.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { ReturnRequest } from "./domain/return-request";
export type { ReturnRequestRepository } from "./domain/return-request-repository";
export {
  PrismaReturnRequestRepository,
  type PrismaReturnRequestRepositoryDeps,
} from "./infrastructure/prisma-return-request-repository";
export { RETURNS_PUBLISHED_EVENTS } from "./infrastructure/returns-event-translator";
