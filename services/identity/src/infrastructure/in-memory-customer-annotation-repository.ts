import {
  sortTags,
  type CustomerAnnotationRepository,
  type CustomerAnnotations,
  type CustomerTag,
} from "../domain/customer-annotations";
import type { CustomerRepository } from "../domain/customer-repository";

export class InMemoryCustomerAnnotationRepository implements CustomerAnnotationRepository {
  private readonly store = new Map<string, { note: string | null; tags: CustomerTag[] }>();
  constructor(private readonly deps: { customers: Pick<CustomerRepository, "findById"> }) {}
  private key(customerId: string, tenantId: string): string {
    return JSON.stringify([tenantId, customerId]);
  }
  async annotationsOf(
    customerIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, CustomerAnnotations>> {
    const result = new Map<string, CustomerAnnotations>();
    for (const id of new Set(customerIds)) {
      if ((await this.deps.customers.findById(id, tenantId, tx)) === null) continue;
      const stored = this.store.get(this.key(id, tenantId));
      result.set(id, {
        note: stored?.note ?? null,
        tags: sortTags((stored?.tags ?? []).map((tag) => tag.tag)),
      });
    }
    return result;
  }
  async setNote(
    customerId: string,
    note: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    if ((await this.deps.customers.findById(customerId, tenantId, tx)) === null) return false;
    const key = this.key(customerId, tenantId);
    this.store.set(key, { note, tags: this.store.get(key)?.tags ?? [] });
    return true;
  }
  async replaceTags(
    customerId: string,
    tags: readonly CustomerTag[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly string[] | null> {
    if ((await this.deps.customers.findById(customerId, tenantId, tx)) === null) return null;
    const key = this.key(customerId, tenantId);
    this.store.set(key, {
      note: this.store.get(key)?.note ?? null,
      tags: tags.map((tag) => ({ ...tag })),
    });
    return sortTags(tags.map((tag) => tag.tag));
  }
}
