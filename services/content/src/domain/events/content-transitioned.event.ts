import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ContentTransitionedData {
  readonly name: string;
  readonly action: string;
}

/** Raised on every content-block lifecycle transition (Sprint 5.4). The translator maps this to `content.content_block.<action>`. */
export class ContentTransitioned extends DomainEvent {
  readonly eventName = "content.transitioned";
  readonly data: ContentTransitionedData;

  constructor(props: DomainEventProps, data: ContentTransitionedData) {
    super(props);
    this.data = data;
  }
}
