export { wireLoyalty } from "./composition";
export type { LoyaltyWiringDeps, WiredLoyalty } from "./composition";
export { LoyaltyController } from "./interfaces/loyalty.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { LoyaltyAccount } from "./domain/loyalty-account";
export type { LoyaltyAccountRepository } from "./domain/loyalty-account-repository";
export { RewardTier } from "./domain/value-objects/reward-tier";
export {
  PrismaLoyaltyAccountRepository,
  type PrismaLoyaltyAccountRepositoryDeps,
} from "./infrastructure/prisma-loyalty-account-repository";
export { LOYALTY_PUBLISHED_EVENTS } from "./infrastructure/loyalty-event-translator";
// Task 17b (C-2): the runtime worker earns loyalty points on `orders.order.paid` by calling
// `EarnPoints` directly (application layer only — never the controller), composing the Prisma
// repository against `core.prisma` itself. `DEFAULT_TIERS` is re-exported rather than duplicated in
// `apps/runtime` on purpose: the tier ladder is a persistence-affecting input
// (`PrismaLoyaltyAccountRepository` rehydrates every row against it), so a second copy could drift
// from the one every existing account was written with.
export { LoyaltyEventTranslator } from "./infrastructure/loyalty-event-translator";
export { DEFAULT_TIERS as DEFAULT_LOYALTY_TIERS } from "./composition";
export {
  EarnPoints,
  type AccountStatusOutput,
  type LedgerInput,
  type LoyaltyDeps,
} from "./application/loyalty.use-cases";
