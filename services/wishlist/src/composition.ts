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
import { GetWishlistByCustomer } from "./application/get-wishlist-by-customer.use-case";
import { GetWishlist } from "./application/get-wishlist.use-case";
import { ListWishlists } from "./application/list-wishlists.use-case";
import type { CartPort } from "./application/ports";
import {
  AddWishlistItem,
  AdvanceWishlist,
  CreateWishlist,
  MoveWishlistItemToCart,
  RemoveWishlistItem,
  ShareWishlistItem,
} from "./application/wishlist.use-cases";
import type { WishlistRepository } from "./domain/wishlist-repository";
import { InMemoryCartPort } from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { InMemoryWishlistRepository } from "./infrastructure/in-memory-wishlist-repository";
import { PrismaWishlistRepository } from "./infrastructure/prisma-wishlist-repository";
import {
  WISHLIST_PUBLISHED_EVENTS,
  WishlistEventTranslator,
} from "./infrastructure/wishlist-event-translator";
import { WishlistController } from "./interfaces/wishlist.controller";

export interface WishlistWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Defaults to the in-memory stub until a real cross-context adapter is wired (deferred, G-39). */
  readonly cart?: CartPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaWishlistRepository` + `PrismaUnitOfWork`
   * (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/`wireLicensing`); absent ⇒
   * in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Wishlist table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredWishlist {
  readonly wishlist: WishlistController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `WishlistController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  wishlists: WishlistRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: WishlistWiringDeps,
): WishlistController {
  const cart = deps.cart ?? new InMemoryCartPort();

  const wishlistDeps = { wishlists, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new WishlistController({
    createWishlist: new CreateWishlist(wishlistDeps),
    advanceWishlist: new AdvanceWishlist(wishlistDeps),
    addWishlistItem: new AddWishlistItem(wishlistDeps),
    removeWishlistItem: new RemoveWishlistItem(wishlistDeps),
    shareWishlistItem: new ShareWishlistItem(wishlistDeps),
    moveWishlistItemToCart: new MoveWishlistItemToCart({ ...wishlistDeps, cart }),
    listWishlists: new ListWishlists({ wishlists }),
    getWishlist: new GetWishlist({ wishlists }),
    getWishlistByCustomer: new GetWishlistByCustomer({ wishlists }),
  });
}

/**
 * Composition root for the Wishlist context. Prisma slice (`PrismaWishlistRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireWishlist(deps: WishlistWiringDeps): WiredWishlist {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireWishlist: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new WishlistEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "wishlist",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const wishlists = new PrismaWishlistRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      wishlist: buildController(wishlists, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new WishlistEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "wishlist",
  });
  const context = rootEventContext(deps.idGenerator);

  const wishlists = new InMemoryWishlistRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(wishlists, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of WISHLIST_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    wishlist: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
