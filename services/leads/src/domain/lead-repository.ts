import type { Lead, LeadStatus } from "./lead";

/** The pending-tracking window: only rows created strictly before `createdBefore`, oldest first. */
export interface PendingTrackingQuery {
  readonly createdBefore: Date;
  readonly limit: number;
}

export interface LeadListQuery {
  readonly first: number;
  readonly after?: string;
  readonly status?: LeadStatus;
  readonly search?: string;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

/** Every call takes the caller's verified `tenantId` (ADR-0014); the repository is a tenant-agnostic singleton. */
export interface LeadRepository {
  /** `"duplicate"` = a row with the same `(tenantId, submissionKey)` already exists (nothing is written). */
  insert(tenantId: string, lead: Lead): Promise<"inserted" | "duplicate">;
  findBySubmissionKey(tenantId: string, submissionKey: string): Promise<Lead | null>;
  /**
   * Atomic conditional upgrade `suppressed` -> `pending` of the row with this tenant, submission key
   * and session (bumps `version` and `updatedAt`); true only if a row changed. Lets the attempt that
   * won the session claim repair a same-key race where the losing attempt inserted first.
   */
  markPendingIfSuppressed(
    tenantId: string,
    submissionKey: string,
    sessionId: string,
  ): Promise<boolean>;
  get(tenantId: string, id: string): Promise<Lead | null>;
  /** Optimistic: updates only if the stored version equals lead.version - 1; false otherwise. */
  updateStatus(tenantId: string, lead: Lead): Promise<boolean>;
  /**
   * Tracking P2-D9 sweeper read. Which tenants have a `pending` lead created before `createdBefore` (oldest first, at
   * most `limit`). The only cross-tenant read of the repository: it returns tenant ids and nothing else, and every
   * row it then names is read and written in that tenant's own scope.
   */
  listTenantsWithPendingTracking(createdBefore: Date, limit: number): Promise<readonly string[]>;
  /** `pending` leads of this tenant created before the cutoff, oldest first, at most `limit`. */
  listPendingTracking(tenantId: string, query: PendingTrackingQuery): Promise<readonly Lead[]>;
  /**
   * Conditional `pending` -> `sent` | `failed` of one lead of this tenant (sets `updatedAt`, keeps `version`); true only if
   * a row changed. A lead already settled, suppressed, spam or another tenant's is never touched.
   */
  markTracking(tenantId: string, id: string, to: "sent" | "failed", at: Date): Promise<boolean>;
  /** Newest first (id descending — ids are UUIDv7); `after` = the last id of the previous page; returns first+1 rows max. */
  list(tenantId: string, query: LeadListQuery): Promise<readonly Lead[]>;
}
