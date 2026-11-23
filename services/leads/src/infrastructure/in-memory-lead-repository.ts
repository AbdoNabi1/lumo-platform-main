import { Lead } from "../domain/lead";
import { leadMatchesSearch } from "../domain/lead-search";
import type { LeadListQuery, LeadRepository } from "../domain/lead-repository";

/**
 * In-memory `LeadRepository`, keyed by `(tenantId, id)` so a cross-tenant leak is visible to every
 * isolation test. Async methods return `Promise.resolve` (no `await`, `require-await`).
 */
export class InMemoryLeadRepository implements LeadRepository {
  private readonly store = new Map<string, Lead>();
  private readonly submissionKeys = new Map<string, string>(); // (tenantId, submissionKey) -> lead id

  private static key(tenantId: string, id: string): string {
    return `${tenantId}\u0000${id}`;
  }

  insert(tenantId: string, lead: Lead): Promise<"inserted" | "duplicate"> {
    const key = InMemoryLeadRepository.key(tenantId, lead.props.id);
    if (this.store.has(key)) {
      return Promise.reject(new Error(`lead ${lead.props.id} already exists`));
    }
    // unique (tenantId, submissionKey); check-and-set is synchronous, so concurrent callers cannot both win
    const submissionKey = InMemoryLeadRepository.key(tenantId, lead.props.submissionKey);
    if (this.submissionKeys.has(submissionKey)) return Promise.resolve("duplicate");
    this.submissionKeys.set(submissionKey, lead.props.id);
    this.store.set(key, lead);
    return Promise.resolve("inserted");
  }

  findBySubmissionKey(tenantId: string, submissionKey: string): Promise<Lead | null> {
    const id = this.submissionKeys.get(InMemoryLeadRepository.key(tenantId, submissionKey));
    return Promise.resolve(
      id === undefined ? null : (this.store.get(InMemoryLeadRepository.key(tenantId, id)) ?? null),
    );
  }

  markPendingIfSuppressed(
    tenantId: string,
    submissionKey: string,
    sessionId: string,
  ): Promise<boolean> {
    // synchronous check-and-set: concurrent callers cannot both flip the row
    const id = this.submissionKeys.get(InMemoryLeadRepository.key(tenantId, submissionKey));
    if (id === undefined) return Promise.resolve(false);
    const key = InMemoryLeadRepository.key(tenantId, id);
    const stored = this.store.get(key);
    if (
      stored === undefined ||
      stored.props.sessionId !== sessionId ||
      stored.props.trackingStatus !== "suppressed"
    ) {
      return Promise.resolve(false);
    }
    this.store.set(
      key,
      Lead.restore({
        ...stored.props,
        trackingStatus: "pending",
        version: stored.props.version + 1,
        updatedAt: new Date(),
      }),
    );
    return Promise.resolve(true);
  }

  get(tenantId: string, id: string): Promise<Lead | null> {
    return Promise.resolve(this.store.get(InMemoryLeadRepository.key(tenantId, id)) ?? null);
  }

  updateStatus(tenantId: string, lead: Lead): Promise<boolean> {
    const key = InMemoryLeadRepository.key(tenantId, lead.props.id);
    const stored = this.store.get(key);
    if (stored === undefined || stored.props.version !== lead.props.version - 1) {
      return Promise.resolve(false);
    }
    this.store.set(key, lead);
    return Promise.resolve(true);
  }

  list(tenantId: string, query: LeadListQuery): Promise<readonly Lead[]> {
    const prefix = `${tenantId}\u0000`;
    const rows = [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, lead]) => lead)
      .filter((lead) => matches(lead, query))
      .sort((a, b) => (a.props.id < b.props.id ? 1 : a.props.id > b.props.id ? -1 : 0));
    const after = query.after;
    const window = after === undefined ? rows : rows.filter((lead) => lead.props.id < after);
    return Promise.resolve(window.slice(0, query.first + 1));
  }
}

function matches(lead: Lead, query: LeadListQuery): boolean {
  const p = lead.props;
  if (query.status !== undefined && p.status !== query.status) return false;
  if (query.createdFrom !== undefined && p.createdAt < query.createdFrom) return false;
  if (query.createdTo !== undefined && p.createdAt > query.createdTo) return false;
  return query.search === undefined || leadMatchesSearch(p, query.search);
}
