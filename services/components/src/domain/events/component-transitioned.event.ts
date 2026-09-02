import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ComponentTransitionedData {
  readonly key: string;
  readonly action: string;
}

/** Raised on every component-definition lifecycle transition (Sprint 5.4). The translator maps this to `components.component_definition.<action>`. */
export class ComponentTransitioned extends DomainEvent {
  readonly eventName = "components.transitioned";
  readonly data: ComponentTransitionedData;

  constructor(props: DomainEventProps, data: ComponentTransitionedData) {
    super(props);
    this.data = data;
  }
}
