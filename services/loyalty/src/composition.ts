import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { GetAccount } from "./application/get-account.use-case";
import { GetAccountByCustomer } from "./application/get-account-by-customer.use-case";
import { ListAccounts } from "./application/list-accounts.use-case";
import {
  AdvanceAccount,
  CompleteReferral,
  EarnPoints,
  OpenAccount,
  RecordCashback,
  RedeemReward,
  SpendPoints,
} from "./application/loyalty.use-cases";
import type { LoyaltyAccountRepository } from "./domain/loyalty-account-repository";
import { InMemoryLoyaltyAccountRepository } from "./infrastructure/in-memory-loyalty-account-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  LOYALTY_PUBLISHED_EVENTS,
  LoyaltyEventTranslator,
} from "./infrastructure/loyalty-event-translator";
import { PrismaLoyaltyAccountRepository } from "./infrastructure/prisma-loyalty-account-repository";
import { LoyaltyController } from "./interfaces/loyalty.controller";
import { RewardTier } from "./domain/value-objects/reward-tier";

export interface LoyaltyWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** The reward-tier ladder; defaults to a standard bronze/silver/gold ladder. */
  readonly tiers?: readonly RewardTier[];
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaLoyaltyAccountRepository` +
   * `PrismaUnitOfWork`; absent ⇒ in-memory, unchanged. ADR-0014 (WP-10, T10.3): the repository
   * built here is a tenant-agnostic singleton — no `tenantId` at composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredLoyalty {
  readonly loyalty: LoyaltyController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/**
 * Composition-time default reward-tier ladder. Not named at file-level by any primary source — a
 * documented composition default, held here rather than invented inside the domain package itself
 * (same convention as the admin app's `DEFAULT_FINANCE_POSTING_ACCOUNTS`).
 */
export const DEFAULT_TIERS: readonly RewardTier[] = [
  RewardTier.create("bronze", 0),
  RewardTier.create("silver", 500),
  RewardTier.create("gold", 2_000),
];

/** Builds the `LoyaltyController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  accounts: LoyaltyAccountRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  tiers: readonly RewardTier[],
  deps: LoyaltyWiringDeps,
): LoyaltyController {
  const loyaltyDeps = {
    accounts,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    tiers,
  };

  return new LoyaltyController({
    openAccount: new OpenAccount(loyaltyDeps),
    advanceAccount: new AdvanceAccount(loyaltyDeps),
    earnPoints: new EarnPoints(loyaltyDeps),
    spendPoints: new SpendPoints(loyaltyDeps),
    recordCashback: new RecordCashback(loyaltyDeps),
    redeemReward: new RedeemReward(loyaltyDeps),
    completeReferral: new CompleteReferral(loyaltyDeps),
    listAccounts: new ListAccounts({ accounts }),
    getAccount: new GetAccount({ accounts }),
    getAccountByCustomer: new GetAccountByCustomer({ accounts }),
  });
}

/**
 * Composition root for the Loyalty context. Prisma slice (`PrismaLoyaltyAccountRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireLoyalty(deps: LoyaltyWiringDeps): WiredLoyalty {
  const tiers = deps.tiers ?? DEFAULT_TIERS;

  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new LoyaltyEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "loyalty",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time any more (see LoyaltyWiringDeps'
    // doc comment) — the repository built below takes tenantId per call instead.
    const context = rootEventContext(deps.idGenerator);
    const accounts = new PrismaLoyaltyAccountRepository({
      prisma: deps.prisma,
      outbox,
      context,
      tiers,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      loyalty: buildController(accounts, unitOfWork, tiers, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new LoyaltyEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "loyalty",
  });
  const context = rootEventContext(deps.idGenerator);

  const accounts = new InMemoryLoyaltyAccountRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(accounts, unitOfWork, tiers, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of LOYALTY_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    loyalty: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
