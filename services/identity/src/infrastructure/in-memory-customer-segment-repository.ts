import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError } from "@platform/utils";
import { CustomerSegment, type SegmentCondition } from "../domain/customer-segment";
import type { CustomerSegmentRepository } from "../domain/customer-segment-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Snapshot = {
  id: string;
  tenantId: string;
  name: string;
  nameKey: string;
  conditions: readonly SegmentCondition[];
  version: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};
const clone = <T>(value: T): T => structuredClone(value);
const hydrate = (s: Snapshot): CustomerSegment =>
  CustomerSegment.reconstitute(
    UniqueEntityId.from(s.id),
    s.name,
    clone(s.conditions),
    s.version,
    s.createdBy,
    new Date(s.createdAt),
    new Date(s.updatedAt),
  );
export class InMemoryCustomerSegmentRepository implements CustomerSegmentRepository {
  private readonly rows = new Map<string, Snapshot>();
  private readonly locks = new Map<string, Promise<void>>();
  async list(tenantId: string): Promise<readonly CustomerSegment[]> {
    return [...this.rows.values()]
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => (a.nameKey < b.nameKey ? -1 : a.nameKey > b.nameKey ? 1 : 0))
      .map(hydrate);
  }
  async findById(id: string, tenantId: string): Promise<CustomerSegment | null> {
    if (!UUID.test(id)) return null;
    const row = this.rows.get(id.toLowerCase());
    return row?.tenantId === tenantId ? hydrate(row) : null;
  }
  async count(tenantId: string): Promise<number> {
    return [...this.rows.values()].filter((s) => s.tenantId === tenantId).length;
  }
  async save(segment: CustomerSegment, tenantId: string): Promise<number> {
    const id = segment.id.toString().toLowerCase();
    const existing = this.rows.get(id);
    if (
      segment.version !== 0 &&
      (!existing || existing.tenantId !== tenantId || existing.version !== segment.version)
    )
      throw new ConcurrencyError("Segment was modified concurrently");
    if (
      [...this.rows.values()].some(
        (s) => s.tenantId === tenantId && s.nameKey === segment.nameKey && s.id !== id,
      )
    )
      throw new ConflictError("A segment with this name already exists");
    if (segment.version === 0 && existing)
      throw new ConflictError("A segment with this id already exists");
    const version = segment.version + 1;
    this.rows.set(id, {
      id,
      tenantId,
      name: segment.name,
      nameKey: segment.nameKey,
      conditions: clone(segment.conditions),
      version,
      createdBy: segment.createdBy,
      createdAt: new Date(segment.createdAt),
      updatedAt: new Date(segment.updatedAt),
    });
    return version;
  }
  async delete(
    id: string,
    expectedVersion: number,
    tenantId: string,
  ): Promise<"deleted" | "not_found" | "stale"> {
    if (!UUID.test(id)) return "not_found";
    const key = id.toLowerCase();
    const row = this.rows.get(key);
    if (!row || row.tenantId !== tenantId) return "not_found";
    if (row.version !== expectedVersion) return "stale";
    this.rows.delete(key);
    return "deleted";
  }
  async withTenantSegmentsLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(tenantId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(tenantId, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(tenantId) === current) this.locks.delete(tenantId);
    }
  }
}
