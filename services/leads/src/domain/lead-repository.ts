import type { Lead, LeadStatus } from "./lead";

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
  get(tenantId: string, id: string): Promise<Lead | null>;
  /** Optimistic: updates only if the stored version equals lead.version - 1; false otherwise. */
  updateStatus(tenantId: string, lead: Lead): Promise<boolean>;
  /** Newest first (id descending — ids are UUIDv7); `after` = the last id of the previous page; returns first+1 rows max. */
  list(tenantId: string, query: LeadListQuery): Promise<readonly Lead[]>;
}
