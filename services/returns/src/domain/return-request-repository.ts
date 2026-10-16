import type { ReturnRequest } from "./return-request";

/** Persistence port for {@link ReturnRequest}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface ReturnRequestRepository {
  save(returnRequest: ReturnRequest, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<ReturnRequest | null>;
  /** Looks up the return request opened for a given order (Phase A.30 admin Order Detail panel). */
  findByOrderRef(orderRef: string, tenantId: string, tx?: unknown): Promise<ReturnRequest | null>;
}
