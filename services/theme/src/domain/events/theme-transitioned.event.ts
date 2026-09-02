import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ThemeTransitionedData {
  readonly name: string;
  readonly action: string;
}

/** Raised on every theme lifecycle transition (Sprint 5.4). The translator maps this to `theme.theme.<action>`. */
export class ThemeTransitioned extends DomainEvent {
  readonly eventName = "theme.transitioned";
  readonly data: ThemeTransitionedData;

  constructor(props: DomainEventProps, data: ThemeTransitionedData) {
    super(props);
    this.data = data;
  }
}
