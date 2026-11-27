import type { CustomerSegment } from "./customer-segment";

export interface CustomerSegmentRepository {
  list(tenantId: string, tx?: unknown): Promise<readonly CustomerSegment[]>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<CustomerSegment | null>;
  count(tenantId: string, tx?: unknown): Promise<number>;
  save(segment: CustomerSegment, tenantId: string, tx?: unknown): Promise<number>;
  delete(
    id: string,
    expectedVersion: number,
    tenantId: string,
    tx?: unknown,
  ): Promise<"deleted" | "not_found" | "stale">;
  withTenantSegmentsLock<T>(tenantId: string, fn: () => Promise<T>, tx?: unknown): Promise<T>;
}
