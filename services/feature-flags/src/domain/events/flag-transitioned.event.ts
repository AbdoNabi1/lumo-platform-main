import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface FlagTransitionedData {
  readonly key: string;
  readonly action: string;
}

/** Raised on every flag state/config change (Sprint 5.3). The translator maps this to `feature_flags.flag.<action>`. */
export class FlagTransitioned extends DomainEvent {
  readonly eventName = "flag.transitioned";
  readonly data: FlagTransitionedData;

  constructor(props: DomainEventProps, data: FlagTransitionedData) {
    super(props);
    this.data = data;
  }
}
