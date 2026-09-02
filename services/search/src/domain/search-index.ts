import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { IndexTransitioned } from "./events/index-transitioned.event";
import { IndexConfig, type SynonymEntry } from "./value-objects/index-config";
import {
  canTransitionIndex,
  IndexStatus,
  type IndexStatusValue,
} from "./value-objects/index-status";

interface SearchIndexProps {
  readonly name: string;
  status: IndexStatus;
  config: IndexConfig;
  documentCount: number;
}

/**
 * Source of truth for the one product search index/config (Sprint 5.2, ADR-0020). Owns indexing
 * only — indexes product **snapshots**, never products themselves (Catalog is the source of truth).
 * The actual index backend (OpenSearch/pgvector) is reached only through `IndexProviderPort`
 * (in-memory adapter shipped; async indexing) — no duplicate index engine.
 */
export class SearchIndex extends AggregateRoot<SearchIndexProps> {
  static create(id: UniqueEntityId, name: string): SearchIndex {
    return new SearchIndex(
      { name, status: IndexStatus.active(), config: IndexConfig.default(), documentCount: 0 },
      id,
    );
  }

  /** Rebuilds a persisted index exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    status: IndexStatus,
    config: IndexConfig,
    documentCount: number,
    version: number,
  ): SearchIndex {
    return new SearchIndex({ name, status, config, documentCount }, id, version);
  }

  /** The generic, validated status transition — every named method below delegates to this. */
  transition(toStatus: IndexStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionIndex(fromStatus, toStatus)) {
      throw new BusinessRuleError(`Cannot transition index from "${fromStatus}" to "${toStatus}"`);
    }
    this.props.status = IndexStatus.from(toStatus);
    this.raise("index", toStatus, eventId, occurredAt);
  }

  rebuild(eventId: string, occurredAt: Date): void {
    this.transition("rebuilding", eventId, occurredAt);
  }

  activate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  disable(eventId: string, occurredAt: Date): void {
    this.transition("disabled", eventId, occurredAt);
  }

  /** Records that a document was upserted via `IndexProviderPort` (approximate count — the provider owns the true document set). */
  recordDocumentUpserted(productRef: string, eventId: string, occurredAt: Date): void {
    this.requireActive();
    this.props.documentCount += 1;
    this.raise("document", "upserted", eventId, occurredAt, productRef);
  }

  /** Records that a document was deleted via `IndexProviderPort`. */
  recordDocumentDeleted(productRef: string, eventId: string, occurredAt: Date): void {
    this.requireActive();
    this.props.documentCount = Math.max(0, this.props.documentCount - 1);
    this.raise("document", "deleted", eventId, occurredAt, productRef);
  }

  addSynonym(
    term: string,
    synonyms: SynonymEntry["synonyms"],
    eventId: string,
    occurredAt: Date,
  ): void {
    this.props.config = this.props.config.withSynonym(term, synonyms);
    this.raise("synonyms", "added", eventId, occurredAt, term);
  }

  removeSynonym(term: string, eventId: string, occurredAt: Date): void {
    this.props.config = this.props.config.withoutSynonym(term);
    this.raise("synonyms", "removed", eventId, occurredAt, term);
  }

  addSuggestion(term: string, eventId: string, occurredAt: Date): void {
    this.props.config = this.props.config.withSuggestion(term);
    this.raise("suggestion", "added", eventId, occurredAt, term);
  }

  /** Logs a search query for analytics (`search.query.logged`) — pure logging, no state mutation. */
  logQuery(term: string, eventId: string, occurredAt: Date): void {
    this.raise("query", "logged", eventId, occurredAt, term);
  }

  private raise(
    family: "index" | "document" | "synonyms" | "suggestion" | "query",
    action: string,
    eventId: string,
    occurredAt: Date,
    ref?: string,
  ): void {
    this.addDomainEvent(
      new IndexTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          indexName: this.props.name,
          family,
          action,
          ref,
        },
      ),
    );
  }

  private requireActive(): void {
    if (this.props.status.value !== "active") {
      throw new BusinessRuleError(
        `Search index is not active (status: ${this.props.status.value})`,
      );
    }
  }

  get name(): string {
    return this.props.name;
  }

  get status(): IndexStatus {
    return this.props.status;
  }

  get config(): IndexConfig {
    return this.props.config;
  }

  get documentCount(): number {
    return this.props.documentCount;
  }
}
