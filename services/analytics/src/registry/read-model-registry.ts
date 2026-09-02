import type { ReadModelDescriptor } from "../domain/read-model-descriptor";

/**
 * Registered {@link ReadModelDescriptor}s, keyed by canonical id. Unversioned — a read model's
 * shape is expected to be extended, not superseded (a business context adds fields; it does not
 * publish a v2 of a read model it already owns).
 */
export class ReadModelRegistry {
  private readonly descriptors = new Map<string, ReadModelDescriptor>();

  register(descriptor: ReadModelDescriptor): void {
    this.descriptors.set(descriptor.id.value, descriptor);
  }

  get(id: string): ReadModelDescriptor | undefined {
    return this.descriptors.get(id);
  }

  has(id: string): boolean {
    return this.descriptors.has(id);
  }

  list(): readonly ReadModelDescriptor[] {
    return [...this.descriptors.values()];
  }
}
