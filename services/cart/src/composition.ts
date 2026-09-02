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
import { AbandonCart } from "./application/abandon-cart.use-case";
import { AddItem } from "./application/add-item.use-case";
import {
  ClearCart,
  ExpireCart,
  LockCart,
  RestoreCart,
  SaveCartForLater,
  UnlockCart,
} from "./application/cart-lifecycle.use-cases";
import { ChangeItemQuantity } from "./application/change-item-quantity.use-case";
import { CheckOutCart } from "./application/check-out-cart.use-case";
import { CreateCart } from "./application/create-cart.use-case";
import { GetCart } from "./application/get-cart.use-case";
import { GetCurrentCart } from "./application/get-current-cart.use-case";
import { ListCarts } from "./application/list-carts.use-case";
import { AssignCartCustomer } from "./application/assign-cart-customer.use-case";
import { MergeGuestCart } from "./application/merge-cart.use-case";
import { RemoveItem } from "./application/remove-item.use-case";
import { ReplaceVariant } from "./application/replace-variant.use-case";
import type { CartRepository } from "./domain/cart-repository";
import { CartEventTranslator } from "./infrastructure/cart-event-translator";
import { InMemoryCartRepository } from "./infrastructure/in-memory-cart-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaCartRepository } from "./infrastructure/prisma-cart-repository";
import { CartController } from "./interfaces/cart.controller";

export interface CartWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaCartRepository` + `PrismaUnitOfWork`
   * (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/`wireInventory`); absent ⇒
   * in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Cart table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredCart {
  readonly cart: CartController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `CartController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  carts: CartRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: CartWiringDeps,
): CartController {
  return new CartController({
    createCart: new CreateCart({ carts, unitOfWork, idGenerator: deps.idGenerator }),
    getCart: new GetCart({ carts }),
    getCurrentCart: new GetCurrentCart({ carts }),
    addItem: new AddItem({ carts, unitOfWork, idGenerator: deps.idGenerator }),
    removeItem: new RemoveItem({ carts, unitOfWork }),
    changeItemQuantity: new ChangeItemQuantity({ carts, unitOfWork }),
    checkOutCart: new CheckOutCart({
      carts,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    abandonCart: new AbandonCart({
      carts,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    replaceVariant: new ReplaceVariant({ carts, unitOfWork, idGenerator: deps.idGenerator }),
    assignCartCustomer: new AssignCartCustomer({ carts, unitOfWork }),
    mergeGuestCart: new MergeGuestCart({
      carts,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    lockCart: new LockCart({ carts, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock }),
    unlockCart: new UnlockCart({ carts, unitOfWork }),
    saveCartForLater: new SaveCartForLater({
      carts,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    restoreCart: new RestoreCart({ carts, unitOfWork }),
    expireCart: new ExpireCart({
      carts,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    clearCart: new ClearCart({ carts, unitOfWork }),
    listCarts: new ListCarts({ carts }),
  });
}

/**
 * Composition root for the Cart context. Prisma slice (`PrismaCartRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireCart(deps: CartWiringDeps): WiredCart {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireCart: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new CartEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "cart",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const carts = new PrismaCartRepository({ prisma: deps.prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      cart: buildController(carts, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new CartEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "cart",
  });
  const context = rootEventContext(deps.idGenerator);

  const carts = new InMemoryCartRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(carts, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  bus.subscribe("cart.cart.checked_out.v1", sink);
  bus.subscribe("cart.cart.abandoned.v1", sink);
  bus.subscribe("cart.cart.merged.v1", sink);
  bus.subscribe("cart.cart.locked.v1", sink);
  bus.subscribe("cart.cart.saved.v1", sink);
  bus.subscribe("cart.cart.expired.v1", sink);

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    cart: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
