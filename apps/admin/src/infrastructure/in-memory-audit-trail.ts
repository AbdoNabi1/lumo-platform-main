import type { AuditEvent, AuditTrail } from "@platform/contracts";

/**
 * In-memory `AuditTrail` for local development and tests — append-only, never pruned. The
 * production adapter (Phase 2) appends through the transactional outbox as
 * `audit.entry.recorded` into 7-year archival storage (doc 20 §14, ADR-0009).
 */
export class InMemoryAuditTrail implements AuditTrail {
  private readonly entries: AuditEvent[] = [];

  record(event: AuditEvent): Promise<void> {
    this.entries.push(event);
    return Promise.resolve();
  }

  /** Test/inspection helper — a snapshot of all recorded entries. */
  snapshot(): readonly AuditEvent[] {
    return [...this.entries];
  }
}
