import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import type { InMemoryOrderRepository } from "./in-memory-order-repository";

export interface InMemoryOrderAnnotationRepositoryDeps {
  /** The order store whose rows the annotations sit beside (the archive "column" lives there). */
  readonly orders: Pick<InMemoryOrderRepository, "hasOrder" | "archivedAtOf" | "writeArchivedAt">;
}

/** In-memory {@link OrderAnnotationRepository}, mirroring `PrismaOrderAnnotationRepository`. */
export class InMemoryOrderAnnotationRepository implements OrderAnnotationRepository {
  private readonly orders: InMemoryOrderAnnotationRepositoryDeps["orders"];

  constructor(deps: InMemoryOrderAnnotationRepositoryDeps) {
    this.orders = deps.orders;
  }

  async setArchived(
    orderIds: readonly string[],
    archivedAt: Date | null,
    tenantId: string,
  ): Promise<readonly string[]> {
    const changed: string[] = [];
    for (const orderId of new Set(orderIds)) {
      if (!this.orders.hasOrder(orderId, tenantId)) continue;
      const isArchived = this.orders.archivedAtOf(orderId, tenantId) !== null;
      if (isArchived === (archivedAt !== null)) continue;
      this.orders.writeArchivedAt(orderId, tenantId, archivedAt);
      changed.push(orderId);
    }
    return changed;
  }

  async annotationsOf(
    orderIds: readonly string[],
    tenantId: string,
  ): Promise<ReadonlyMap<string, OrderAnnotations>> {
    const found = new Map<string, OrderAnnotations>();
    for (const orderId of new Set(orderIds)) {
      if (this.orders.hasOrder(orderId, tenantId)) {
        found.set(orderId, { archivedAt: this.orders.archivedAtOf(orderId, tenantId) });
      }
    }
    return found;
  }
}
