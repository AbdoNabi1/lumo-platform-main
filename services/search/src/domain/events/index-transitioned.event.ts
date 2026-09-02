import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type SearchEventFamily = "index" | "document" | "synonyms" | "suggestion" | "query";

export interface IndexTransitionedData {
  readonly indexName: string;
  readonly family: SearchEventFamily;
  readonly action: string;
  readonly ref?: string;
}

/**
 * Raised on every search-index state change (Sprint 5.2) — a two-dimensional `(family, action)`
 * pair, generalizing the single-dimension dynamic-status-mapping technique Notifications/Promotions
 * use, because the report's own event naming (`search.index/document/synonyms/suggestion/query.*`)
 * already carries two segments after the context prefix. The translator maps this to
 * `search.<family>.<action>`.
 */
export class IndexTransitioned extends DomainEvent {
  readonly eventName = "index.transitioned";
  readonly data: IndexTransitionedData;

  constructor(props: DomainEventProps, data: IndexTransitionedData) {
    super(props);
    this.data = data;
  }
}
